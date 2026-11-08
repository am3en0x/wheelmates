// Pure game math. No I/O and no clock: every function takes the numbers it needs, so tests can pin every rule.

export const UPGRADES = {
  wheel: { name: 'Wheel', max: 30, cost: (n) => Math.round(30 * 1.33 ** (n - 1)) },
  bottle: { name: 'Water bottle', max: 30, cost: (n) => Math.round(50 * 1.3 ** (n - 1)) },
  bedding: { name: 'Bedding', max: 20, cost: (n) => Math.round(100 * 1.4 ** (n - 1)) },
  pantry: { name: 'Pantry', max: 30, cost: (n) => Math.round(pantryGain(n) * (6 + (18 * (n - 1)) / 29)) },
  stash: { name: 'Seed stash', max: 9, cost: (n) => Math.round(300 * 1.8 ** (n - 1)) },
  sneakers: { name: 'Sneakers', max: 10, cost: (n) => Math.round(2000 * 1.6 ** (n - 1)) },
}
export const KEYS = Object.keys(UPGRADES)

export function pantryGain(n) {
  return Math.round(40 * 1.18 ** (n - 1))
}
export function seedsPerHourAt(level) {
  let sum = 0
  for (let n = 1; n <= level; n++) sum += pantryGain(n)
  return sum
}
export const nextCost = (key, level) => (level >= UPGRADES[key].max ? null : UPGRADES[key].cost(level + 1))

export function stats(levels) {
  const l = (k) => levels[k] || 0
  return {
    tapPower: 1 + l('wheel'),
    energyMax: 500 + 100 * l('bottle'),
    regenPerSec: 1 + 0.25 * l('bedding'),
    seedsPerHour: seedsPerHourAt(l('pantry')),
    offlineCapHours: 3 + l('stash'),
    sneakers: Math.round(l('sneakers') * 10) / 100,
  }
}

export const energyAt = (energy, energyAtMs, regenPerSec, energyMax, nowMs) =>
  Math.min(energyMax, energy + (regenPerSec * Math.max(0, nowMs - energyAtMs)) / 1000)

export const TAPS_PER_SEC = 15
export const tapWindowSec = (lastBatchMs, nowMs) =>
  lastBatchMs == null ? 2 : Math.min(4, Math.max(0.5, (nowMs - lastBatchMs) / 1000))

// How many of `count` taps a batch may spend, and what they pay.
export function settleTaps({ count, energy, windowSec, tapPower, multiplier, holderBonus }) {
  const accepted = Math.max(0, Math.min(count, Math.floor(energy), Math.floor(TAPS_PER_SEC * windowSec)))
  return { accepted, seeds: Math.floor(accepted * tapPower * multiplier * (1 + holderBonus)) }
}

export const BASE_MULTIPLIER = { offair: 1, still: 1, running: 2, zoomies: 3 }
export const passiveMultiplier = (phase) => (phase === 'running' || phase === 'zoomies' ? 1.5 : 1)
export function liveMultiplier(phase, sneakers) {
  const base = BASE_MULTIPLIER[phase] || 1
  return base > 1 ? Math.round((base + sneakers) * 100) / 100 : 1
}

export const chestSeeds = (s) => Math.floor(50 + s.seedsPerHour / 2 + 20 * s.tapPower)
export const CHEST_TTL_MS = 24 * 3600e3
export const MAX_OPEN_CHESTS = 10

export const HOLDER_CAP = 0.5
export function holderBonus(tokens) {
  const eq = (tokens || []).reduce((a, t) => a + Number(t.basePower || 0) / 1000, 0)
  return { equivalents: Math.round(eq * 100) / 100, bonus: Math.min(HOLDER_CAP, Math.round(eq * 10) / 100) }
}

export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)
export function nextStreak(lastClaimedOn, nowMs) {
  const today = utcDay(nowMs)
  if (lastClaimedOn === today) return null
  return { today, continues: lastClaimedOn === utcDay(nowMs - 86400e3) }
}
export const dailyReward = (streak, bonus) => Math.floor(100 * Math.min(streak, 7) * (1 + bonus))

export const REF_FRIENDS = 10
export const REF_SHARE = 0.05
export const REF_SEASON_CAP = 20000
export function referralCut(seeds, inviteRank, earnedThisSeason) {
  if (!inviteRank || inviteRank > REF_FRIENDS) return 0
  return Math.max(0, Math.min(Math.floor(seeds * REF_SHARE), REF_SEASON_CAP - earnedThisSeason))
}

// ISO week of a UTC instant, e.g. 2026-W46. Round 1 of a season is Monday 00:00 UTC.
export function seasonKey(ms) {
  const d = new Date(ms)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3)
  const isoYear = t.getUTCFullYear()
  const jan4 = new Date(Date.UTC(isoYear, 0, 4))
  const week = 1 + Math.round(((t - jan4) / 86400e3 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

// Passive income between fromMs and toMs at seedsPerHour, capped to the last capHours, with the phase log's passive
// multiplier on each segment. `segments` are {at, mult} rows sorted ascending, the first being the row in effect at
// the window's start when there is one; time before the first row counts at x1. Returns a float.
export function passiveSeeds(seedsPerHour, fromMs, toMs, capHours, segments) {
  const start = Math.max(fromMs, toMs - capHours * 3600e3)
  if (!(seedsPerHour > 0) || toMs <= start) return 0
  const rows = segments && segments.length ? segments : [{ at: start, mult: 1 }]
  let total = 0
  if (rows[0].at > start) total += ((Math.min(toMs, rows[0].at) - start) / 3600e3) * seedsPerHour
  for (let i = 0; i < rows.length; i++) {
    const a = Math.max(start, rows[i].at)
    const b = Math.min(toMs, i + 1 < rows.length ? rows[i + 1].at : toMs)
    if (b > a) total += ((b - a) / 3600e3) * seedsPerHour * rows[i].mult
  }
  return total
}
