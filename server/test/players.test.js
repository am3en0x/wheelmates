import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.js'
import { createGame, GameError } from '../src/players.js'

const A = '0x90f79bf6eb2c4f870365e785982e1f101e93b906'
const B = '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65'
const H = 3600e3

function world(opts = {}) {
  const db = openDb(':memory:')
  let t = Date.parse('2026-11-09T12:00:00Z') // a Monday
  let snap = { phase: 'still', base: 1, rpm: 0, speedKmh: 0, todayKm: 1, block: 2000, progress: 0.5, observedAt: t, apiAt: t }
  const live = { snapshot: () => snap }
  const squeek = { account: async () => opts.account || { ok: true, data: { status: 'available', tokens: [] } } }
  const game = createGame({ db, live, squeek, now: () => t, siteUrl: 'https://wm.test/' })
  db.prepare('INSERT INTO phase_log (at, phase, mult) VALUES (?, ?, ?)').run(t - 10 * H, 'still', 1)
  const logPhase = (phase, mult) => db.prepare('INSERT OR REPLACE INTO phase_log (at, phase, mult) VALUES (?, ?, ?)').run(t, phase, mult)
  const tapsAt = (addr, count, extra = {}) => game.taps(addr, { count, clientTs: t, batchId: extra.batchId || `b${t}${Math.random()}`, token: extra.token || 'tok-' + addr, ...extra })
  return { db, game, live, tick: (ms) => { t += ms }, now: () => t, setPhase: (phase, base) => { snap = { ...snap, phase, base }; logPhase(phase, base > 1 ? 1.5 : 1) }, tapsAt }
}
const err = (fn, code) => { try { fn(); assert.fail('expected ' + code) } catch (e) { assert.ok(e instanceof GameError, String(e)); assert.equal(e.code, code) } }
const plain = (rows) => rows.map((r) => ({ ...r }))

test('a new player: defaults, referral code, me heartbeat', () => {
  const { game } = world()
  const me = game.me(A)
  assert.equal(me.seeds, 0)
  assert.equal(me.energy, 500)
  assert.equal(me.tapPower, 1)
  assert.equal(me.season, '2026-W46')
  assert.equal(me.referral.code.length, 8)
  assert.equal(me.referral.link, 'https://wm.test/?ref=' + me.referral.code)
  assert.deepEqual(me.chests, [])
  assert.equal(me.dailyClaimable, true)
  assert.equal(me.live.multiplier, 1)
})

test('taps spend energy and pay with the live multiplier and the holder bonus', () => {
  const w = world()
  w.game.me(A)
  let r = w.tapsAt(A, 25)
  assert.deepEqual([r.accepted, r.seeds, r.energy], [25, 25, 475])
  w.tick(2000)
  w.setPhase('running', 2)
  r = w.tapsAt(A, 30)
  assert.deepEqual([r.accepted, r.seeds, r.multiplier], [30, 60, 2])
  w.db.prepare('UPDATE players SET holder_bonus = 0.22 WHERE address = ?').run(A)
  w.tick(2000)
  r = w.tapsAt(A, 10)
  assert.equal(r.seeds, Math.floor(10 * 2 * 1.22))
})

test('tap guards: count, clock skew, too fast, stale session, energy, idempotent batch id', () => {
  const w = world()
  w.game.me(A)
  err(() => w.tapsAt(A, 0), 'bad_count')
  err(() => w.tapsAt(A, 61), 'bad_count')
  err(() => w.game.taps(A, { count: 5, clientTs: w.now() - 6000, batchId: 'x', token: 't' }), 'clock_skew')
  const first = w.tapsAt(A, 30, { batchId: 'same', token: 'tok' })
  assert.deepEqual(w.tapsAt(A, 30, { batchId: 'same', token: 'tok' }), first)
  err(() => w.tapsAt(A, 5), 'too_fast')
  w.tick(31 * 60e3)
  err(() => w.tapsAt(A, 5), 'stale_session')
  w.game.me(A)
  // energy is 500 - 30 + regen, capped at 500: a 60-tap batch over a 4 s window accepts 60
  assert.equal(w.tapsAt(A, 60).accepted, 60)
  // then the pool runs dry: only the regen since the last batch is left
  w.db.prepare('UPDATE players SET energy = 0.5 WHERE address = ?').run(A)
  w.tick(2000)
  assert.equal(w.tapsAt(A, 30).accepted, 2)
})

test('upgrades cost seeds, raise stats, and refuse beyond the balance or the max', () => {
  const w = world()
  w.game.me(A)
  w.db.prepare('UPDATE players SET seeds = 100 WHERE address = ?').run(A)
  err(() => w.game.upgrade(A, 'nope'), 'bad_key')
  const me = w.game.upgrade(A, 'wheel')
  assert.equal(me.tapPower, 2)
  assert.equal(me.seeds, 70)
  assert.equal(me.costs.wheel, 40)
  err(() => w.game.upgrade(A, 'pantry'), 'insufficient_seeds')
  w.db.prepare("INSERT INTO upgrades (address, key, level) VALUES (?, 'stash', 9)").run(A)
  err(() => w.game.upgrade(A, 'stash'), 'max_level')
})

test('passive income follows the phase log and the offline cap, and lands in the current season', () => {
  const w = world()
  w.game.me(A)
  w.db.prepare("INSERT INTO upgrades (address, key, level) VALUES (?, 'pantry', 1)").run(A) // 40 seeds/hour
  w.tick(H)
  assert.equal(w.game.me(A).seeds, 40)
  w.setPhase('running', 2)
  w.tick(H)
  w.setPhase('still', 1)
  w.tick(H)
  assert.equal(w.game.me(A).seeds, 40 + 60 + 40)
  // away for a week across the Monday: only 3 hours count and they go to the new season
  w.tick(7 * 24 * H)
  const me = w.game.me(A)
  assert.equal(me.seeds, 140 + 120)
  assert.equal(me.season, '2026-W47')
  assert.equal(me.seasonSeeds, 120)
  assert.deepEqual(plain(w.db.prepare('SELECT season, seeds FROM season_results WHERE address = ?').all(A)), [{ season: '2026-W46', seeds: 140 }])
})

test('chests: lazy, only for blocks found while the player was around, capped at 10, claim one or all', () => {
  const w = world()
  w.game.me(A)
  const block = (id, at) => w.db.prepare('INSERT INTO blocks (event_id, block, blocks, at) VALUES (?, ?, 1, ?)').run(id, 2000 + Number(id), at)
  block(1, w.now() - 60_000) // before the player existed: no chest
  w.tick(H)
  block(2, w.now() - 1000)
  w.tick(60_000)
  let me = w.game.me(A)
  assert.equal(me.chests.length, 1)
  assert.equal(me.chests[0].seeds, 70)
  // a block one hour after the last visit counts, and the chest lives 24 hours after its block
  block(3, w.now() + H)
  w.tick(20 * H)
  me = w.game.me(A)
  assert.deepEqual(me.chests.map((c) => c.block), [2002, 2003])
  // a block more than a day after the last visit gives nothing; the old chests have expired by then
  block(4, w.now() + 30 * H)
  w.tick(31 * H)
  me = w.game.me(A)
  assert.deepEqual(me.chests, [])
  // thirteen blocks in a row leave the ten newest chests
  block(5, w.now() + 1)
  for (let i = 10; i < 22; i++) block(i, w.now() + i)
  w.tick(60_000)
  me = w.game.me(A)
  assert.equal(me.chests.length, 10)
  assert.equal(me.chests[0].block, 2012)
  const before = me.seeds
  me = w.game.claimChest(A, { id: me.chests[0].id })
  assert.equal(me.seeds, before + 70)
  assert.equal(me.chests.length, 9)
  me = w.game.claimChest(A, { all: true })
  assert.equal(me.seeds, before + 70 * 10)
  err(() => w.game.claimChest(A, { all: true }), 'no_chest')
})

test('daily streak', () => {
  const w = world()
  w.game.me(A)
  let me = w.game.daily(A)
  assert.deepEqual([me.streak, me.seeds, me.dailyClaimable], [1, 100, false])
  err(() => w.game.daily(A), 'already_claimed')
  w.tick(24 * H)
  me = w.game.daily(A)
  assert.deepEqual([me.streak, me.seeds], [2, 300])
  w.tick(49 * H)
  me = w.game.daily(A)
  assert.deepEqual([me.streak, me.seeds], [1, 400])
})

test('friends: 5% of taps and chests from the first ten, capped per season, nothing from passive or daily', () => {
  const w = world()
  const inviter = w.game.me(A)
  w.game.touch(B, inviter.referral.code)
  w.game.me(B)
  w.tapsAt(B, 20)
  assert.equal(w.game.me(A).seeds, 1)
  assert.equal(w.game.me(A).referral.friends.length, 1)
  assert.equal(w.game.me(A).referral.earned, 1)
  w.game.daily(B)
  assert.equal(w.game.me(A).seeds, 1)
  // an eleventh friend earns nothing
  w.db.prepare('UPDATE players SET invite_rank = 11 WHERE address = ?').run(B)
  w.tick(2000)
  w.tapsAt(B, 20)
  assert.equal(w.game.me(A).seeds, 1)
  // the season cap
  w.db.prepare('UPDATE players SET invite_rank = 1 WHERE address = ?').run(B)
  w.db.prepare('UPDATE players SET referral_season_seeds = 19999 WHERE address = ?').run(A)
  w.tick(2000)
  w.tapsAt(B, 20)
  assert.equal(w.game.me(A).seeds, 2)
  w.tick(2000)
  w.tapsAt(B, 20)
  assert.equal(w.game.me(A).seeds, 2)
})

test('names: valid, unique, cooldown', () => {
  const w = world()
  w.game.me(A); w.game.me(B)
  err(() => w.game.setName(A, 'ab'), 'invalid_name')
  err(() => w.game.setName(A, 'bad fuck'), 'invalid_name')
  assert.equal(w.game.setName(A, 'Squeek Fan').name, 'Squeek Fan')
  err(() => w.game.setName(B, 'squeek fan'), 'name_taken')
  err(() => w.game.setName(A, 'Other'), 'name_cooldown')
  w.tick(25 * H)
  assert.equal(w.game.setName(A, 'Other').name, 'Other')
})

test('holder bonus from the account API, kept on failure, refreshed every ten minutes', async () => {
  let answer = { ok: true, data: { status: 'available', tokens: [{ basePower: '2200' }, { basePower: '1000' }] } }
  const w = world({ get account() { return answer } })
  w.game.me(A)
  await w.game.refreshHolder(A)
  assert.deepEqual([w.game.me(A).holderBonus, w.game.me(A).holderEquivalents], [0.32, 3.2])
  answer = { ok: false }
  w.tick(11 * 60e3)
  await w.game.refreshHolder(A)
  assert.equal(w.game.me(A).holderBonus, 0.32)
})

test('leaderboard and ranks', () => {
  const w = world()
  w.game.me(A); w.game.me(B)
  w.db.prepare('UPDATE players SET seeds = 500, season_seeds = 500 WHERE address = ?').run(A)
  w.db.prepare('UPDATE players SET seeds = 900, season_seeds = 100, name = ? WHERE address = ?').run('Bee', B)
  const season = w.game.leaderboard('season', 10)
  assert.equal(season.season, '2026-W46')
  assert.deepEqual(season.rows.map((r) => [r.rank, r.address, r.seeds]), [[1, A, 500], [2, B, 100]])
  const all = w.game.leaderboard('all', 1)
  assert.deepEqual(all.rows.map((r) => [r.rank, r.name, r.seeds]), [[1, 'Bee', 900]])
  assert.deepEqual(w.game.me(A).rank, { season: 1, all: 2 })
})

test('live view and health', () => {
  const w = world()
  assert.equal(w.game.liveView().multiplier, 1)
  w.setPhase('zoomies', 3)
  assert.equal(w.game.liveView().multiplier, 3)
  assert.equal(w.game.health().api, 'ok')
  w.tick(3 * 60e3)
  assert.equal(w.game.health().api, 'stale')
  assert.equal(w.game.health().ok, true)
})

test('housekeeping removes expired sessions, old chests, old batches and old log rows but keeps the last one', () => {
  const w = world()
  const t = w.now()
  w.db.prepare('INSERT INTO sessions (token, address, expires_at, created_at) VALUES (?, ?, ?, ?)').run('old', A, t - 1, t - 2)
  w.db.prepare('INSERT INTO sessions (token, address, expires_at, created_at) VALUES (?, ?, ?, ?)').run('new', A, t + 1, t)
  w.db.prepare('INSERT INTO tap_batches (token, batch_id, response, at) VALUES (?, ?, ?, ?)').run('x', 'y', '{}', t - 2 * 24 * H)
  w.db.prepare('INSERT INTO phase_log (at, phase, mult) VALUES (?, ?, ?)').run(t - 20 * 24 * H, 'still', 1)
  w.game.housekeeping()
  assert.deepEqual(plain(w.db.prepare('SELECT token FROM sessions').all()), [{ token: 'new' }])
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM tap_batches').get().n, 0)
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM phase_log').get().n, 1)
})
