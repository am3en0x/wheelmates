import { keccak256, toUtf8Bytes, isAddress } from 'ethers'
import * as R from './rules.js'

export class GameError extends Error {
  constructor(status, code, detail) {
    super(code)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

const BAD_WORDS = ['fuck', 'shit', 'nigg', 'cunt', 'nazi', 'hitler', 'rape', 'faggot']
const NAME_RE = /^[A-Za-z0-9_ ]{3,20}$/
export const refCode = (address) => keccak256(toUtf8Bytes(address.toLowerCase())).slice(2, 10)

// The game. Every public method runs in one SQLite transaction, settles the player first (passive income, season,
// chests, energy) and then applies its own change. `live.snapshot()` is the poller's view of the hamster.
export function createGame({ db, live, squeek, now = Date.now, siteUrl = '' }) {
  const S = (sql) => db.prepare(sql)
  const st = {
    player: S('SELECT * FROM players WHERE address = ?'),
    byRef: S('SELECT address FROM players WHERE ref_code = ?'),
    create: S(`INSERT INTO players (address, ref_code, season, energy, energy_at, last_seen_at, chest_cursor, created_at, inviter, invite_rank)
      VALUES (?, ?, ?, 500, ?, ?, ?, ?, ?, ?)`),
    save: S(`UPDATE players SET name = ?, name_changed_at = ?, seeds = ?, season_seeds = ?, season = ?, energy = ?, energy_at = ?,
      last_seen_at = ?, me_at = ?, last_batch_at = ?, chest_cursor = ?, streak = ?, daily_claimed_on = ?,
      referral_season_seeds = ?, referral_earned = ? WHERE address = ?`),
    setHolder: S('UPDATE players SET holder_bonus = ?, holder_equivalents = ?, holder_checked_at = ? WHERE address = ?'),
    levels: S('SELECT key, level FROM upgrades WHERE address = ?'),
    setLevel: S('INSERT INTO upgrades (address, key, level) VALUES (?, ?, ?) ON CONFLICT(address, key) DO UPDATE SET level = excluded.level'),
    countInvites: S('SELECT COUNT(*) AS n FROM players WHERE inviter = ?'),
    friends: S('SELECT address, name, invite_rank FROM players WHERE inviter = ? ORDER BY invite_rank'),
    addEarned: S('INSERT INTO referral_earnings (inviter, friend, seeds) VALUES (?, ?, ?) ON CONFLICT(inviter, friend) DO UPDATE SET seeds = seeds + excluded.seeds'),
    logBefore: S('SELECT at, mult FROM phase_log WHERE at <= ? ORDER BY at DESC LIMIT 1'),
    logBetween: S('SELECT at, mult FROM phase_log WHERE at > ? AND at <= ? ORDER BY at'),
    blocksSince: S('SELECT block, at FROM blocks WHERE at > ? AND at < ? AND at > ? ORDER BY at'),
    openChests: S('SELECT id, block, seeds, expires_at FROM chests WHERE address = ? AND claimed_at IS NULL AND expires_at > ? ORDER BY created_at, id'),
    insertChest: S('INSERT INTO chests (address, block, seeds, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    dropChest: S('DELETE FROM chests WHERE id = ?'),
    chest: S('SELECT id, seeds FROM chests WHERE id = ? AND address = ? AND claimed_at IS NULL AND expires_at > ?'),
    claimChest: S('UPDATE chests SET claimed_at = ? WHERE id = ?'),
    archive: S('INSERT INTO season_results (season, address, seeds) VALUES (?, ?, ?) ON CONFLICT(season, address) DO UPDATE SET seeds = excluded.seeds'),
    nameTaken: S('SELECT address FROM players WHERE lower(name) = lower(?) AND address != ?'),
    batch: S('SELECT response FROM tap_batches WHERE token = ? AND batch_id = ?'),
    saveBatch: S('INSERT OR IGNORE INTO tap_batches (token, batch_id, response, at) VALUES (?, ?, ?, ?)'),
    leadersSeason: S('SELECT address, name, season_seeds AS seeds, holder_bonus FROM players WHERE season = ? ORDER BY season_seeds DESC, address LIMIT ?'),
    leadersAll: S('SELECT address, name, seeds, holder_bonus FROM players ORDER BY seeds DESC, address LIMIT ?'),
    rankSeason: S('SELECT COUNT(*) + 1 AS r FROM players WHERE season = ? AND season_seeds > ?'),
    rankAll: S('SELECT COUNT(*) + 1 AS r FROM players WHERE seeds > ?'),
    adoptPlayer: S('UPDATE players SET address = ? WHERE address = ?'),
    adoptUpgrades: S('UPDATE upgrades SET address = ? WHERE address = ?'),
    adoptChests: S('UPDATE chests SET address = ? WHERE address = ?'),
    adoptInviter: S('UPDATE players SET inviter = ? WHERE inviter = ?'),
    adoptEarnInviter: S('UPDATE referral_earnings SET inviter = ? WHERE inviter = ?'),
    adoptEarnFriend: S('UPDATE referral_earnings SET friend = ? WHERE friend = ?'),
    hasLevels: S('SELECT COUNT(*) AS n FROM upgrades WHERE address = ?'),
    deletePlayer: S('DELETE FROM players WHERE address = ?'),
    hk: [
      S('DELETE FROM sessions WHERE expires_at < ?'),
      S('DELETE FROM nonces WHERE expires_at < ?'),
      S('DELETE FROM chests WHERE (claimed_at IS NOT NULL OR expires_at < ?) AND created_at < ?'),
      S('DELETE FROM tap_batches WHERE at < ?'),
      S('DELETE FROM phase_log WHERE at < ? AND at < (SELECT MAX(at) FROM phase_log)'),
    ],
  }

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  const levelsOf = (address) => Object.fromEntries(st.levels.all(address).map((r) => [r.key, r.level]))
  const save = (p) => st.save.run(p.name, p.name_changed_at, p.seeds, p.season_seeds, p.season, p.energy, p.energy_at, p.last_seen_at, p.me_at,
    p.last_batch_at, p.chest_cursor, p.streak, p.daily_claimed_on, p.referral_season_seeds, p.referral_earned, p.address)

  // The player row, created on first sight. A valid ref code of another player makes that player the inviter.
  function getOrCreate(address, ref) {
    address = String(address).toLowerCase()
    const found = st.player.get(address)
    if (found) return found
    const t = now()
    let inviter = null
    let rank = null
    if (ref) {
      const inv = st.byRef.get(String(ref).toLowerCase())
      if (inv && inv.address !== address) {
        inviter = inv.address
        rank = st.countInvites.get(inviter).n + 1
      }
    }
    st.create.run(address, refCode(address), R.seasonKey(t), t, t, t, t, inviter, rank)
    return st.player.get(address)
  }

  function rollSeason(p, t) {
    const season = R.seasonKey(t)
    if (p.season === season) return
    st.archive.run(p.season, p.address, Math.floor(p.season_seeds))
    p.season = season
    p.season_seeds = 0
    p.referral_season_seeds = 0
  }

  // Credits what time has brought: the season roll, passive income (into the current season), the chests for blocks
  // found while the player was around, and energy. Mutates p.
  function settle(p, t, s) {
    rollSeason(p, t)
    if (s.seedsPerHour > 0 && t > p.last_seen_at) {
      const start = Math.max(p.last_seen_at, t - s.offlineCapHours * 3600e3)
      const before = st.logBefore.get(start)
      const rows = (before ? [before] : []).concat(st.logBetween.all(start, t))
      const gain = R.passiveSeeds(s.seedsPerHour, p.last_seen_at, t, s.offlineCapHours, rows)
      p.seeds += gain
      p.season_seeds += gain
    }
    const amount = R.chestSeeds(s)
    for (const b of st.blocksSince.all(p.chest_cursor, p.last_seen_at + R.CHEST_TTL_MS, t - R.CHEST_TTL_MS)) {
      st.insertChest.run(p.address, b.block, amount, t, b.at + R.CHEST_TTL_MS)
    }
    p.chest_cursor = t
    const open = st.openChests.all(p.address, t)
    for (let i = 0; i < open.length - R.MAX_OPEN_CHESTS; i++) st.dropChest.run(open[i].id)
    p.energy = R.energyAt(p.energy, p.energy_at, s.regenPerSec, s.energyMax, t)
    p.energy_at = t
    p.last_seen_at = t
  }

  function view(p, s, t) {
    const levels = levelsOf(p.address)
    const costs = Object.fromEntries(R.KEYS.map((k) => [k, R.nextCost(k, levels[k] || 0)]))
    const streakNext = R.nextStreak(p.daily_claimed_on, t)
    const snap = live.snapshot()
    return {
      address: p.address,
      name: p.name,
      seeds: Math.floor(p.seeds),
      seasonSeeds: Math.floor(p.season_seeds),
      season: p.season,
      energy: Math.floor(p.energy),
      energyMax: s.energyMax,
      regenPerSec: s.regenPerSec,
      tapPower: s.tapPower,
      seedsPerHour: s.seedsPerHour,
      offlineCapHours: s.offlineCapHours,
      sneakers: s.sneakers,
      upgrades: levels,
      costs,
      holderBonus: p.holder_bonus,
      holderEquivalents: p.holder_equivalents,
      streak: p.streak,
      dailyClaimable: streakNext !== null,
      dailyReward: R.dailyReward((streakNext && streakNext.continues ? p.streak : 0) + 1, p.holder_bonus),
      chests: st.openChests.all(p.address, t).map((c) => ({ id: c.id, block: c.block, seeds: c.seeds, expiresAt: c.expires_at })),
      referral: {
        code: p.ref_code,
        link: siteUrl + '?ref=' + p.ref_code,
        friends: st.friends.all(p.address).map((f) => ({ address: f.address, name: f.name, counts: f.invite_rank <= R.REF_FRIENDS })),
        earned: Math.floor(p.referral_earned),
        seasonEarned: Math.floor(p.referral_season_seeds),
      },
      rank: { season: st.rankSeason.get(p.season, p.season_seeds).r, all: st.rankAll.get(p.seeds).r },
      live: { ...snap, multiplier: R.liveMultiplier(snap.phase, s.sneakers) },
    }
  }

  // The inviter's cut of seeds a friend earned from taps or chests.
  function payInviter(friend, seeds, t) {
    if (!friend.inviter || seeds <= 0) return
    const inv = st.player.get(friend.inviter)
    if (!inv) return
    rollSeason(inv, t)
    const cut = R.referralCut(seeds, friend.invite_rank, inv.referral_season_seeds)
    if (cut > 0) {
      inv.seeds += cut
      inv.season_seeds += cut
      inv.referral_season_seeds += cut
      inv.referral_earned += cut
      st.addEarned.run(inv.address, friend.address, cut)
    }
    save(inv)
  }

  const touch = (address, ref) => tx(() => { getOrCreate(address, ref) })

  function me(address) {
    return tx(() => {
      const t = now()
      const p = getOrCreate(address)
      const s = R.stats(levelsOf(p.address))
      settle(p, t, s)
      p.me_at = t
      save(p)
      return view(p, s, t)
    })
  }

  function taps(address, { count, clientTs, batchId, token }) {
    return tx(() => {
      const t = now()
      if (!batchId) throw new GameError(400, 'bad_batch')
      const prev = st.batch.get(token, batchId)
      if (prev) return JSON.parse(prev.response)
      if (!Number.isInteger(count) || count < 1 || count > 60) throw new GameError(400, 'bad_count')
      if (!Number.isFinite(clientTs) || Math.abs(clientTs - t) > 5000) throw new GameError(400, 'clock_skew')
      const p = getOrCreate(address)
      if (p.me_at == null || t - p.me_at > 30 * 60e3) throw new GameError(409, 'stale_session')
      if (p.last_batch_at != null && t - p.last_batch_at < 900) throw new GameError(429, 'too_fast')
      const s = R.stats(levelsOf(p.address))
      settle(p, t, s)
      const multiplier = R.liveMultiplier(live.snapshot().phase, s.sneakers)
      const { accepted, seeds } = R.settleTaps({ count, energy: p.energy, windowSec: R.tapWindowSec(p.last_batch_at, t), tapPower: s.tapPower, multiplier, holderBonus: p.holder_bonus })
      p.energy -= accepted
      p.seeds += seeds
      p.season_seeds += seeds
      p.last_batch_at = t
      save(p)
      payInviter(p, seeds, t)
      const res = { accepted, seeds, energy: Math.floor(p.energy), seasonSeeds: Math.floor(p.season_seeds), total: Math.floor(p.seeds), multiplier }
      st.saveBatch.run(token, batchId, JSON.stringify(res), t)
      return res
    })
  }

  function upgrade(address, key) {
    return tx(() => {
      if (!R.UPGRADES[key]) throw new GameError(400, 'bad_key')
      const t = now()
      const p = getOrCreate(address)
      const levels = levelsOf(p.address)
      settle(p, t, R.stats(levels))
      const cost = R.nextCost(key, levels[key] || 0)
      if (cost === null) throw new GameError(409, 'max_level')
      if (Math.floor(p.seeds) < cost) throw new GameError(409, 'insufficient_seeds', { cost, seeds: Math.floor(p.seeds) })
      p.seeds -= cost
      levels[key] = (levels[key] || 0) + 1
      st.setLevel.run(p.address, key, levels[key])
      save(p)
      return view(p, R.stats(levels), t)
    })
  }

  function claimChest(address, { id, all }) {
    return tx(() => {
      const t = now()
      const p = getOrCreate(address)
      const s = R.stats(levelsOf(p.address))
      settle(p, t, s)
      const targets = all ? st.openChests.all(p.address, t) : [st.chest.get(Number(id), p.address, t)].filter(Boolean)
      if (!targets.length) throw new GameError(404, 'no_chest')
      let got = 0
      for (const c of targets) {
        st.claimChest.run(t, c.id)
        got += c.seeds
      }
      p.seeds += got
      p.season_seeds += got
      save(p)
      payInviter(p, got, t)
      return view(p, s, t)
    })
  }

  function daily(address) {
    return tx(() => {
      const t = now()
      const p = getOrCreate(address)
      const s = R.stats(levelsOf(p.address))
      settle(p, t, s)
      const next = R.nextStreak(p.daily_claimed_on, t)
      if (!next) throw new GameError(409, 'already_claimed')
      p.streak = next.continues ? p.streak + 1 : 1
      p.daily_claimed_on = next.today
      const reward = R.dailyReward(p.streak, p.holder_bonus)
      p.seeds += reward
      p.season_seeds += reward
      save(p)
      return view(p, s, t)
    })
  }

  function setName(address, name) {
    return tx(() => {
      const t = now()
      const p = getOrCreate(address)
      name = String(name || '').trim().replace(/\s+/g, ' ')
      if (!NAME_RE.test(name) || BAD_WORDS.some((w) => name.toLowerCase().includes(w))) throw new GameError(400, 'invalid_name')
      if (p.name_changed_at && t - p.name_changed_at < 86400e3) throw new GameError(429, 'name_cooldown')
      if (st.nameTaken.get(name, p.address)) throw new GameError(409, 'name_taken')
      const s = R.stats(levelsOf(p.address))
      settle(p, t, s)
      p.name = name
      p.name_changed_at = t
      save(p)
      return view(p, s, t)
    })
  }

  // A guest's progress moves to a wallet that has none of its own (a row with no seeds, no season seeds and no
  // upgrades counts as none). The guest keeps its referral code, so invite links shared as a guest keep working.
  function adopt(guest, address) {
    return tx(() => {
      address = String(address).toLowerCase()
      if (!String(guest).startsWith('guest-') || !isAddress(address)) return false
      if (!st.player.get(guest)) return false
      const existing = st.player.get(address)
      if (existing) {
        if (existing.seeds > 0 || existing.season_seeds > 0 || st.hasLevels.get(address).n > 0) return false
        st.deletePlayer.run(address)
      }
      st.adoptPlayer.run(address, guest)
      st.adoptUpgrades.run(address, guest)
      st.adoptChests.run(address, guest)
      st.adoptInviter.run(address, guest)
      st.adoptEarnInviter.run(address, guest)
      st.adoptEarnFriend.run(address, guest)
      return true
    })
  }

  // Squeek holdings from Squeekchain's account API, at most every ten minutes; a failed read keeps the last value.
  // Guests have no wallet, so nothing to read.
  async function refreshHolder(address) {
    if (!isAddress(String(address))) return
    const p = st.player.get(String(address).toLowerCase())
    if (!p || now() - p.holder_checked_at < 10 * 60e3) return
    const r = await squeek.account(p.address)
    if (!r.ok || !r.data || r.data.status !== 'available') return
    const { bonus, equivalents } = R.holderBonus(r.data.tokens)
    st.setHolder.run(bonus, equivalents, now(), p.address)
  }

  function leaderboard(scope, limit) {
    const n = Math.max(1, Math.min(100, Number(limit) || 100))
    const season = R.seasonKey(now())
    const all = scope === 'all'
    const rows = all ? st.leadersAll.all(n) : st.leadersSeason.all(season, n)
    return { season, scope: all ? 'all' : 'season', rows: rows.map((r, i) => ({ rank: i + 1, address: r.address, name: r.name, seeds: Math.floor(r.seeds), holder: r.holder_bonus > 0 })) }
  }

  const liveView = () => { const snap = live.snapshot(); return { ...snap, multiplier: R.liveMultiplier(snap.phase, 0) } }
  function health() {
    const snap = live.snapshot()
    return { ok: true, api: snap.apiAt != null && now() - snap.apiAt < 120_000 ? 'ok' : 'stale', lastReadingAt: snap.observedAt, db: 'ok' }
  }
  function housekeeping() {
    const t = now()
    const [sessions, nonces, chests, batches, log] = st.hk
    sessions.run(t)
    nonces.run(t)
    chests.run(t, t - 7 * 86400e3)
    batches.run(t - 86400e3)
    log.run(t - 14 * 86400e3)
  }

  return { touch, me, taps, upgrade, claimChest, daily, setName, adopt, refreshHolder, leaderboard, liveView, health, housekeeping }
}
