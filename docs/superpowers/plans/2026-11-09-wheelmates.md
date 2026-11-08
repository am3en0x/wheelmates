# Wheelmates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-authoritative tap game around the live Squeektoshi: seeds for taps, a multiplier when the real hamster runs, chests when Squeek blocks are found, cage upgrades, a holder bonus, friends, a daily streak and weekly leaderboards.

**Architecture:** `server/` is Node 22 with `node:http` and `node:sqlite`; pure rules in `rules.js`, the hamster phase machine in `phase.js`, a poller writing `phase_log` and `blocks`, `players.js` doing every credit inside one SQLite transaction, `auth.js` for signed-message sessions, `api.js` routing. `web/` is a static page (canvas cage, four tabs) that only talks to the server. Every file under a `**File:**` line is complete; execution copies it verbatim.

**Tech Stack:** Node 22.17 (`node:sqlite`, `node:test`), `ethers` v6 (signature verification), plain HTML/CSS/JS, Pillow for the pixel art, systemd + Caddy for hosting.

**Spec:** `docs/superpowers/specs/2026-11-09-wheelmates-design.md`

## Global Constraints

- Server dependencies: only `ethers`. Node pinned `22.17.x` (`.nvmrc`, `engines`); start with `--no-warnings=ExperimentalWarning`.
- The site never calls Squeekchain; it reads the server's `/live`. The server reads `/v1/status` every 5 s, `/v1/events?category=all&limit=40` every 15 s, `/v1/accounts/{address}` at most every 10 minutes per player.
- All seeds, energy, multipliers, chests are computed on the server; the client reports tap counts with `clientTs` and `batchId`.
- Numbers are the spec's: energy 500 base, regen 1/s, 15 taps/s cap, multipliers 1/2/3 + sneakers, passive ×1.5 while running, chest `50 + seedsPerHour/2 + 20×tapPower`, holder `min(0.5, 0.1×Σ basePower/1000)`, daily `100×min(streak,7)×(1+bonus)`, referral 5% from the first 10 friends and at most 20,000 a season, seasons = ISO weeks (UTC).
- English UI and comments; commits in English ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. The game is original: no other tapper's name, art or mechanics.

## File map

| File | Responsibility |
| --- | --- |
| `package.json`, `.nvmrc`, `.gitignore`, `LICENSE` | root scripts, Node pin, ignores, MIT |
| `server/package.json`, `server/src/rules.js` | pure game math |
| `server/src/db.js` | schema and `openDb` |
| `server/src/phase.js`, `squeek.js`, `poller.js` | readings, phase machine, API client, the poller |
| `server/src/players.js` | the game: settle, taps, upgrades, chests, daily, name, referral, leaderboard, housekeeping |
| `server/src/auth.js`, `api.js`, `index.js` | sessions, HTTP routing, boot |
| `server/test/*.test.js`, `server/test/fixtures/*.json` | tests |
| `tools/art.py`, `web/img/*.png` | pixel art |
| `web/index.html`, `about.html`, `config.js`, `css/game.css`, `js/*.js`, `fonts/` | the site |
| `deploy/wheelmates.service`, `deploy/Caddyfile`, `deploy/deploy.sh` | hosting |
| `README.md`, `docs/IMD_JOB.md` | handoff |

---

### Task 1: Scaffold and the pure rules

**Files:** Create `package.json`, `.nvmrc`, `.gitignore`, `LICENSE`, `server/package.json`, `server/src/rules.js`, `server/test/rules.test.js`.

**Interfaces — Produces:** everything exported by `rules.js`: `UPGRADES`, `KEYS`, `pantryGain(n)`, `seedsPerHourAt(level)`, `nextCost(key, level)`, `stats(levels)`, `energyAt(...)`, `TAPS_PER_SEC`, `tapWindowSec(lastBatchMs, nowMs)`, `settleTaps({count, energy, windowSec, tapPower, multiplier, holderBonus})`, `BASE_MULTIPLIER`, `passiveMultiplier(phase)`, `liveMultiplier(phase, sneakers)`, `chestSeeds(stats)`, `CHEST_TTL_MS`, `MAX_OPEN_CHESTS`, `holderBonus(tokens)`, `utcDay(ms)`, `nextStreak(lastClaimedOn, nowMs)`, `dailyReward(streak, bonus)`, `REF_FRIENDS`, `REF_SHARE`, `REF_SEASON_CAP`, `referralCut(seeds, inviteRank, earnedThisSeason)`, `seasonKey(ms)`, `passiveSeeds(seedsPerHour, fromMs, toMs, capHours, segments)`.

- [ ] **Step 1: Scaffold and failing tests**

**File:** `package.json`
```json
{
  "name": "wheelmates",
  "private": true,
  "type": "module",
  "engines": { "node": "22.17.x" },
  "scripts": {
    "test": "cd server && npm test",
    "start": "cd server && npm start",
    "art": "python tools/art.py",
    "site": "python -m http.server 8080 -d web"
  }
}
```

**File:** `.nvmrc`
```
22.17.0
```

**File:** `.gitignore`
```
node_modules/
*.sqlite
*.sqlite-wal
*.sqlite-shm
.playwright-mcp/
tmp/
```

**File:** `LICENSE`
```
MIT License

Copyright (c) 2026 Wheelmates contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**File:** `server/package.json`
```json
{
  "name": "wheelmates-server",
  "private": true,
  "type": "module",
  "engines": { "node": "22.17.x" },
  "scripts": {
    "start": "node --no-warnings=ExperimentalWarning src/index.js",
    "test": "node --no-warnings=ExperimentalWarning --test \"test/*.test.js\""
  },
  "dependencies": {
    "ethers": "^6.13.0"
  }
}
```

**File:** `server/test/rules.test.js`
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as R from '../src/rules.js'

test('upgrade costs match the spec table', () => {
  assert.equal(R.UPGRADES.wheel.cost(1), 30)
  assert.equal(R.UPGRADES.wheel.cost(15), 2162)
  assert.equal(R.UPGRADES.wheel.cost(30), 117171)
  assert.equal(R.UPGRADES.bottle.cost(30), 100769)
  assert.equal(R.UPGRADES.bedding.cost(20), 59763)
  assert.equal(R.UPGRADES.pantry.cost(1), 240)
  assert.equal(R.UPGRADES.pantry.cost(15), 5964)
  assert.equal(R.UPGRADES.pantry.cost(30), 116640)
  assert.equal(R.UPGRADES.stash.cost(9), 33060)
  assert.equal(R.UPGRADES.sneakers.cost(10), 137439)
  assert.equal(R.seedsPerHourAt(30), 31639)
})

test('every pantry level pays back in 6 to 24 hours and nothing costs over 150,000', () => {
  for (let n = 1; n <= 30; n++) {
    const hours = R.UPGRADES.pantry.cost(n) / R.pantryGain(n)
    assert.ok(hours >= 5.9 && hours <= 24.1, `pantry ${n}: ${hours}`)
  }
  for (const k of R.KEYS) for (let n = 1; n <= R.UPGRADES[k].max; n++) assert.ok(R.UPGRADES[k].cost(n) <= 150000, `${k} ${n}`)
})

test('stats from levels, next cost and max level', () => {
  assert.deepEqual(R.stats({}), { tapPower: 1, energyMax: 500, regenPerSec: 1, seedsPerHour: 0, offlineCapHours: 3, sneakers: 0 })
  const s = R.stats({ wheel: 3, bottle: 2, bedding: 4, pantry: 2, stash: 9, sneakers: 10 })
  assert.deepEqual(s, { tapPower: 4, energyMax: 700, regenPerSec: 2, seedsPerHour: 87, offlineCapHours: 12, sneakers: 1 })
  assert.equal(R.nextCost('wheel', 0), 30)
  assert.equal(R.nextCost('stash', 9), null)
})

test('energy regenerates to the cap', () => {
  assert.equal(R.energyAt(100, 0, 1, 500, 60_000), 160)
  assert.equal(R.energyAt(490, 0, 2, 500, 60_000), 500)
  assert.equal(R.energyAt(10, 5000, 1, 500, 1000), 10)
})

test('tap batches: energy, rate window and pay', () => {
  assert.equal(R.tapWindowSec(null, 0), 2)
  assert.equal(R.tapWindowSec(0, 2000), 2)
  assert.equal(R.tapWindowSec(0, 100), 0.5)
  assert.equal(R.tapWindowSec(0, 60_000), 4)
  assert.deepEqual(R.settleTaps({ count: 60, energy: 500, windowSec: 2, tapPower: 1, multiplier: 1, holderBonus: 0 }), { accepted: 30, seeds: 30 })
  assert.deepEqual(R.settleTaps({ count: 10, energy: 3.9, windowSec: 2, tapPower: 2, multiplier: 1, holderBonus: 0 }), { accepted: 3, seeds: 6 })
  assert.deepEqual(R.settleTaps({ count: 10, energy: 500, windowSec: 2, tapPower: 3, multiplier: 2.3, holderBonus: 0.22 }), { accepted: 10, seeds: 84 })
  assert.deepEqual(R.settleTaps({ count: 5, energy: 0, windowSec: 2, tapPower: 1, multiplier: 1, holderBonus: 0 }), { accepted: 0, seeds: 0 })
})

test('multipliers', () => {
  assert.equal(R.liveMultiplier('still', 0.5), 1)
  assert.equal(R.liveMultiplier('offair', 0.5), 1)
  assert.equal(R.liveMultiplier('running', 0), 2)
  assert.equal(R.liveMultiplier('running', 0.3), 2.3)
  assert.equal(R.liveMultiplier('zoomies', 1), 4)
  assert.equal(R.passiveMultiplier('running'), 1.5)
  assert.equal(R.passiveMultiplier('still'), 1)
})

test('chest seeds and holder bonus', () => {
  assert.equal(R.chestSeeds(R.stats({})), 70)
  assert.equal(R.chestSeeds({ seedsPerHour: 941, tapPower: 11 }), 740)
  assert.deepEqual(R.holderBonus([{ basePower: '2200' }]), { equivalents: 2.2, bonus: 0.22 })
  assert.deepEqual(R.holderBonus([{ basePower: '1000' }, { basePower: '4840' }]), { equivalents: 5.84, bonus: 0.5 })
  assert.deepEqual(R.holderBonus([]), { equivalents: 0, bonus: 0 })
})

test('daily streak', () => {
  const now = Date.parse('2026-11-09T12:00:00Z')
  assert.deepEqual(R.nextStreak(null, now), { today: '2026-11-09', continues: false })
  assert.deepEqual(R.nextStreak('2026-11-08', now), { today: '2026-11-09', continues: true })
  assert.deepEqual(R.nextStreak('2026-11-07', now), { today: '2026-11-09', continues: false })
  assert.equal(R.nextStreak('2026-11-09', now), null)
  assert.equal(R.dailyReward(1, 0), 100)
  assert.equal(R.dailyReward(9, 0), 700)
  assert.equal(R.dailyReward(3, 0.22), 366)
})

test('referral cut: first ten friends, 20,000 a season', () => {
  assert.equal(R.referralCut(1000, 1, 0), 50)
  assert.equal(R.referralCut(1000, 10, 19_980), 20)
  assert.equal(R.referralCut(1000, 10, 20_000), 0)
  assert.equal(R.referralCut(1000, 11, 0), 0)
  assert.equal(R.referralCut(1000, null, 0), 0)
})

test('seasons are ISO weeks', () => {
  assert.equal(R.seasonKey(Date.parse('2026-11-09T00:00:00Z')), '2026-W46')
  assert.equal(R.seasonKey(Date.parse('2026-11-08T23:59:59Z')), '2026-W45')
  assert.equal(R.seasonKey(Date.parse('2026-01-01T00:00:00Z')), '2026-W01')
  assert.equal(R.seasonKey(Date.parse('2025-12-29T00:00:00Z')), '2026-W01')
  assert.equal(R.seasonKey(Date.parse('2027-01-03T12:00:00Z')), '2026-W53')
})

test('passive income integrates the phase log and respects the offline cap', () => {
  const H = 3600e3
  assert.equal(R.passiveSeeds(0, 0, H, 3, []), 0)
  assert.equal(R.passiveSeeds(60, 0, H, 3, []), 60)
  assert.equal(R.passiveSeeds(60, 0, 10 * H, 3, []), 180)
  // running for the middle hour of three at x1.5
  const rows = [{ at: 0, mult: 1 }, { at: H, mult: 1.5 }, { at: 2 * H, mult: 1 }]
  assert.equal(R.passiveSeeds(60, 0, 3 * H, 12, rows), 210)
  // the window starts inside a x1.5 segment
  assert.equal(R.passiveSeeds(60, 1.5 * H, 3 * H, 12, [{ at: H, mult: 1.5 }, { at: 2 * H, mult: 1 }]), 105)
  // no row before the start: that stretch counts at x1
  assert.equal(R.passiveSeeds(60, 0, 2 * H, 12, [{ at: H, mult: 1.5 }]), 150)
})
```

- [ ] **Step 2: Run** `cd server && npm test` — expected FAIL: cannot find `src/rules.js`.

- [ ] **Step 3: Implement**

**File:** `server/src/rules.js`
```js
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
```

- [ ] **Step 4: Run** `cd server && npm install && npm test` — expected: all pass.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Add the game rules and the project scaffold"`.

---

### Task 2: Database, readings, phase machine, API client and the poller

**Files:** Create `server/src/db.js`, `server/src/phase.js`, `server/src/squeek.js`, `server/src/poller.js`, `server/test/phase.test.js`, `server/test/poller.test.js`, `server/test/fixtures/status-active.json`, `server/test/fixtures/events.json`.

**Interfaces — Produces:** `openDb(path) -> DatabaseSync` with the schema; `toReading(json, atMs) -> {at, online, rpm, speedKmh, todayKm, block, progress}`; `createPhaseMachine({zoomiesKmh, offAirMs}) -> {push(reading) -> phase, phase, last}`; `createSqueek({base, fetchImpl, timeoutMs}) -> {status(), events(), account(address)}` each resolving `{ok, data?, retryAfter?}`; `createPoller({db, squeek, now, log, statusMs, eventsMs}) -> {start(), stop(), snapshot(), pollStatus(), pollEvents(), fillGap()}` where `snapshot()` is `{phase, base, rpm, speedKmh, todayKm, block, progress, observedAt, apiAt}`.

- [ ] **Step 1: Fixtures and failing tests**

**File:** `server/test/fixtures/status-active.json`
```json
{
  "measurement": { "freshness": "online", "coreStatus": "ACTIVE", "rpmMilli": 77005, "speedMmPerSecond": 1127, "distanceMm": 3455808 },
  "builder": { "status": "available", "anchor": { "blockHeight": "2366", "blockProgress": "143705150", "settledThroughRound": "166" } }
}
```

**File:** `server/test/fixtures/events.json`
```json
{
  "status": "available",
  "events": [
    { "id": "e9", "type": "system.settlement_completed", "occurredAt": "2026-11-07T18:30:36.000Z", "payload": { "settledThroughRound": "568", "workAdded": "412", "completedBlockCount": "2", "lastCompletedBlock": "2001", "blockHeight": "2001" } },
    { "id": "e8", "type": "system.settlement_completed", "occurredAt": "2026-11-07T18:20:36.000Z", "payload": { "settledThroughRound": "567", "workAdded": "0", "completedBlockCount": "0", "lastCompletedBlock": null, "blockHeight": "1999" } },
    { "id": "e7", "type": "account.sqk_staked", "occurredAt": "2026-11-07T18:18:24.000Z", "payload": { "account": "0x61d608d04985759a9aa282e9733a1a126a073e13", "amountBaseUnits": "4301142000000000000000" } }
  ]
}
```

**File:** `server/test/phase.test.js`
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toReading, createPhaseMachine } from '../src/phase.js'

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)))
const R = (s, rpm, kmh = rpm ? 3 : 0, online = true) => ({ at: s * 1000, online, rpm, speedKmh: kmh })

test('a status answer becomes a reading', () => {
  const r = toReading(fixture('status-active.json'), 7)
  assert.equal(r.at, 7)
  assert.equal(r.online, true)
  assert.equal(r.rpm, 77.005)
  assert.ok(Math.abs(r.speedKmh - 4.0572) < 1e-9)
  assert.equal(r.todayKm, 3.455808)
  assert.equal(r.block, 2366)
  assert.ok(Math.abs(r.progress - 0.14370515) < 1e-12)
  const off = toReading({}, 1)
  assert.deepEqual([off.online, off.rpm, off.todayKm, off.block], [false, 0, null, null])
})

test('running needs two moving polls; the first one keeps the old phase', () => {
  const m = createPhaseMachine()
  assert.equal(m.push(R(0, 0)), 'still')
  assert.equal(m.push(R(5, 70)), 'still')
  assert.equal(m.push(R(10, 70)), 'running')
  assert.equal(m.push(R(15, 0)), 'still')
})

test('zoomies needs two fast polls and drops back to running when he slows', () => {
  const m = createPhaseMachine({ zoomiesKmh: 4.5 })
  m.push(R(0, 70, 3)); m.push(R(5, 70, 3))
  assert.equal(m.push(R(10, 90, 5)), 'running')
  assert.equal(m.push(R(15, 90, 5)), 'zoomies')
  assert.equal(m.push(R(20, 80, 4)), 'running')
})

test('off air after two minutes without an online reading, back to still on the first good one', () => {
  const m = createPhaseMachine()
  assert.equal(m.push(R(0, 0, 0, false)), 'offair')
  m.push(R(5, 70)); m.push(R(10, 70))
  assert.equal(m.phase, 'running')
  assert.equal(m.push(R(60, 0, 0, false)), 'running')
  assert.equal(m.push(R(131, 0, 0, false)), 'offair')
  assert.equal(m.push(R(135, 70)), 'still')
  assert.equal(m.push(R(140, 70)), 'running')
})
```

**File:** `server/test/poller.test.js`
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { openDb } from '../src/db.js'
import { createPoller } from '../src/poller.js'

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)))
const active = fixture('status-active.json')
const idle = { measurement: { freshness: 'online', rpmMilli: 0, speedMmPerSecond: 0, distanceMm: 100000 }, builder: { anchor: { blockHeight: '2366', blockProgress: '1', settledThroughRound: '166' } } }

function harness(answers) {
  const db = openDb(':memory:')
  let t = 1_000_000
  const squeek = { status: async () => answers.status(), events: async () => answers.events() }
  const poller = createPoller({ db, squeek, now: () => t, log: { error() {} } })
  return { db, poller, tick: (ms) => { t += ms }, now: () => t }
}

test('fillGap writes an off-air row after downtime and a first row on an empty log', () => {
  const { db, poller, tick } = harness({})
  poller.fillGap()
  assert.deepEqual(db.prepare('SELECT phase, mult FROM phase_log').all(), [{ phase: 'offair', mult: 1 }])
  db.prepare('INSERT INTO phase_log (at, phase, mult) VALUES (?, ?, ?)').run(1_000_000 + 60_000, 'running', 1.5)
  tick(600_000)
  poller.fillGap()
  const rows = db.prepare('SELECT at, phase, mult FROM phase_log ORDER BY at').all()
  assert.deepEqual(rows[rows.length - 1], { at: 1_000_000 + 65_000, phase: 'offair', mult: 1 })
})

test('status polls move the snapshot and log phase changes once', async () => {
  let answer = idle
  const { db, poller, tick } = harness({ status: () => ({ ok: true, data: answer }) })
  poller.fillGap()
  await poller.pollStatus()
  assert.equal(poller.snapshot().phase, 'still')
  answer = active
  tick(5000); await poller.pollStatus()
  assert.equal(poller.snapshot().phase, 'still')
  assert.equal(poller.snapshot().rpm, 77.005)
  tick(5000); await poller.pollStatus()
  assert.equal(poller.snapshot().phase, 'running')
  assert.equal(poller.snapshot().base, 2)
  tick(5000); await poller.pollStatus()
  assert.deepEqual(db.prepare('SELECT phase, mult FROM phase_log ORDER BY at').all(), [
    { phase: 'offair', mult: 1 }, { phase: 'still', mult: 1 }, { phase: 'running', mult: 1.5 },
  ])
  assert.equal(poller.snapshot().apiAt, 1_015_000)
})

test('a failed status poll keeps the numbers and goes off air after two minutes', async () => {
  let ok = true
  const { poller, tick } = harness({ status: () => (ok ? { ok: true, data: active } : { ok: false }) })
  poller.fillGap()
  await poller.pollStatus(); tick(5000); await poller.pollStatus()
  ok = false
  tick(5000); await poller.pollStatus()
  assert.equal(poller.snapshot().phase, 'running')
  assert.equal(poller.snapshot().todayKm, 3.455808)
  tick(130_000); await poller.pollStatus()
  assert.equal(poller.snapshot().phase, 'offair')
  assert.equal(poller.snapshot().rpm, 0)
  assert.equal(poller.snapshot().todayKm, 3.455808)
})

test('event polls record settlements with blocks, once per event id', async () => {
  const { db, poller } = harness({ events: () => ({ ok: true, data: fixture('events.json') }) })
  await poller.pollEvents(); await poller.pollEvents()
  assert.deepEqual(db.prepare('SELECT event_id, block, blocks, at FROM blocks').all(), [
    { event_id: 'e9', block: 2001, blocks: 2, at: Date.parse('2026-11-07T18:30:36.000Z') },
  ])
})
```

- [ ] **Step 2: Run** `cd server && npm test` — expected FAIL: modules missing.

- [ ] **Step 3: Implement**

**File:** `server/src/db.js`
```js
import { DatabaseSync } from 'node:sqlite'

// One SQLite file. Times are Unix milliseconds; seeds are REAL so passive fractions survive between requests and
// are floored only for display and spending.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  address TEXT PRIMARY KEY,
  ref_code TEXT NOT NULL,
  name TEXT,
  name_changed_at INTEGER,
  seeds REAL NOT NULL DEFAULT 0,
  season_seeds REAL NOT NULL DEFAULT 0,
  season TEXT NOT NULL,
  energy REAL NOT NULL,
  energy_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  me_at INTEGER,
  last_batch_at INTEGER,
  chest_cursor INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  inviter TEXT,
  invite_rank INTEGER,
  holder_bonus REAL NOT NULL DEFAULT 0,
  holder_equivalents REAL NOT NULL DEFAULT 0,
  holder_checked_at INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  daily_claimed_on TEXT,
  referral_season_seeds REAL NOT NULL DEFAULT 0,
  referral_earned REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS players_ref ON players (ref_code);
CREATE INDEX IF NOT EXISTS players_season ON players (season, season_seeds);
CREATE INDEX IF NOT EXISTS players_seeds ON players (seeds);
CREATE INDEX IF NOT EXISTS players_inviter ON players (inviter);
CREATE TABLE IF NOT EXISTS upgrades (address TEXT NOT NULL, key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (address, key));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, address TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, address TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blocks (event_id TEXT PRIMARY KEY, block INTEGER NOT NULL, blocks INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS blocks_at ON blocks (at);
CREATE TABLE IF NOT EXISTS chests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, block INTEGER NOT NULL, seeds INTEGER NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS chests_open ON chests (address, claimed_at, expires_at);
CREATE TABLE IF NOT EXISTS tap_batches (token TEXT NOT NULL, batch_id TEXT NOT NULL, response TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (token, batch_id));
CREATE TABLE IF NOT EXISTS phase_log (at INTEGER PRIMARY KEY, phase TEXT NOT NULL, mult REAL NOT NULL);
CREATE TABLE IF NOT EXISTS season_results (season TEXT NOT NULL, address TEXT NOT NULL, seeds INTEGER NOT NULL, PRIMARY KEY (season, address));
CREATE TABLE IF NOT EXISTS referral_earnings (inviter TEXT NOT NULL, friend TEXT NOT NULL, seeds REAL NOT NULL, PRIMARY KEY (inviter, friend));
`

export function openDb(path) {
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA)
  return db
}
```

**File:** `server/src/phase.js`
```js
// A /v1/status answer as numbers, and the phase machine the poller runs on them.
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

export function toReading(json, at) {
  const m = (json && json.measurement) || {}
  const anchor = (json && json.builder && json.builder.anchor) || {}
  const online = m.freshness === 'online'
  const distance = num(m.distanceMm)
  const progress = num(anchor.blockProgress)
  return {
    at,
    online,
    rpm: online ? (num(m.rpmMilli) ?? 0) / 1000 : 0,
    speedKmh: online ? (num(m.speedMmPerSecond) ?? 0) * 0.0036 : 0,
    todayKm: distance === null ? null : distance / 1e6,
    block: num(anchor.blockHeight),
    progress: progress === null ? null : progress / 1e9,
  }
}

// Phases: offair (no online reading for offAirMs), still, running (moving on two polls in a row), zoomies (at or over
// zoomiesKmh on two polls in a row). A single moving poll never changes the phase; a single slow poll ends zoomies.
export function createPhaseMachine({ zoomiesKmh = 4.5, offAirMs = 120_000 } = {}) {
  let phase = 'offair'
  let lastOnline = null
  let moveStreak = 0
  let fastStreak = 0
  let last = null
  return {
    push(r) {
      if (!r.online) {
        if (lastOnline === null || r.at - lastOnline >= offAirMs) phase = 'offair'
        moveStreak = 0
        fastStreak = 0
        return phase
      }
      lastOnline = r.at
      last = r
      const moving = r.rpm > 0
      const fast = moving && r.speedKmh >= zoomiesKmh
      moveStreak = moving ? moveStreak + 1 : 0
      fastStreak = fast ? fastStreak + 1 : 0
      if (!moving) phase = 'still'
      else if (fastStreak >= 2) phase = 'zoomies'
      else if (moveStreak >= 2) phase = 'running'
      else if (phase === 'offair') phase = 'still'
      return phase
    },
    get phase() { return phase },
    get last() { return last },
  }
}
```

**File:** `server/src/squeek.js`
```js
// Squeekchain's public API, read with a timeout. A body with "status": "unavailable" is not an answer.
export function createSqueek({ base = 'https://api.squeekchain.com/v1', fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  async function get(path) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(base + path, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'wheelmates/1.0' } })
      if (res.status === 429 || res.status === 503) return { ok: false, retryAfter: Number(res.headers.get('retry-after')) || 10 }
      if (!res.ok) return { ok: false }
      const data = await res.json()
      if (data && data.status === 'unavailable') return { ok: false, unavailable: true }
      return { ok: true, data }
    } catch {
      return { ok: false }
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    status: () => get('/status'),
    events: () => get('/events?category=all&limit=40'),
    account: (address) => get('/accounts/' + address),
  }
}
```

**File:** `server/src/poller.js`
```js
import { toReading, createPhaseMachine } from './phase.js'
import { passiveMultiplier, BASE_MULTIPLIER } from './rules.js'

// Reads the wheel every few seconds and the event feed every 15 s. Keeps a snapshot for /live and the tap
// multiplier, writes every phase change to phase_log (for passive income), and records settlements with blocks.
export function createPoller({ db, squeek, now = Date.now, log = console, statusMs = 5000, eventsMs = 15000 }) {
  const machine = createPhaseMachine()
  const st = {
    last: db.prepare('SELECT at, phase, mult FROM phase_log ORDER BY at DESC LIMIT 1'),
    log: db.prepare('INSERT OR REPLACE INTO phase_log (at, phase, mult) VALUES (?, ?, ?)'),
    block: db.prepare('INSERT OR IGNORE INTO blocks (event_id, block, blocks, at) VALUES (?, ?, ?, ?)'),
  }
  let snap = { phase: 'offair', base: 1, rpm: 0, speedKmh: 0, todayKm: null, block: null, progress: null, observedAt: null, apiAt: null }
  let timers = []

  // The log never has a gap: downtime is written as off air 5 s after the last row.
  function fillGap() {
    const t = now()
    const last = st.last.get()
    if (!last) st.log.run(t, 'offair', 1)
    else if (t - last.at > 10_000) st.log.run(last.at + 5000, 'offair', 1)
  }

  async function pollStatus() {
    const r = await squeek.status()
    const t = now()
    const reading = toReading(r.ok ? r.data : {}, t)
    const before = machine.phase
    const phase = machine.push(reading)
    snap = {
      phase,
      base: BASE_MULTIPLIER[phase],
      rpm: reading.online ? reading.rpm : 0,
      speedKmh: reading.online ? reading.speedKmh : 0,
      todayKm: reading.todayKm ?? snap.todayKm,
      block: reading.block ?? snap.block,
      progress: reading.progress ?? snap.progress,
      observedAt: reading.online ? t : snap.observedAt,
      apiAt: r.ok ? t : snap.apiAt,
    }
    if (phase !== before) st.log.run(t, phase, passiveMultiplier(phase))
  }

  async function pollEvents() {
    const r = await squeek.events()
    if (!r.ok || !r.data || !Array.isArray(r.data.events)) return
    for (const e of r.data.events) {
      if (!e || e.type !== 'system.settlement_completed' || typeof e.id !== 'string') continue
      const p = e.payload || {}
      const n = Number(p.completedBlockCount || 0)
      if (!n) continue
      st.block.run(e.id, Number(p.lastCompletedBlock ?? p.blockHeight), n, Date.parse(e.occurredAt) || now())
    }
  }

  const safe = (fn) => () => fn().catch((e) => log.error('poller', e.message))
  function start() {
    fillGap()
    safe(pollStatus)()
    safe(pollEvents)()
    timers = [setInterval(safe(pollStatus), statusMs), setInterval(safe(pollEvents), eventsMs)]
    for (const tm of timers) tm.unref?.()
  }
  function stop() {
    for (const tm of timers) clearInterval(tm)
    timers = []
  }
  return { start, stop, snapshot: () => snap, pollStatus, pollEvents, fillGap }
}
```

- [ ] **Step 4: Run** `cd server && npm test` — expected: all pass.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Add the database, the wheel phase machine and the poller"`.

---

### Task 3: The game and sign-in

**Files:** Create `server/src/players.js`, `server/src/auth.js`, `server/test/players.test.js`, `server/test/auth.test.js`.

**Interfaces — Produces:** `GameError(status, code, detail)`; `refCode(address)`; `createGame({db, live, squeek, now, siteUrl}) -> {touch(address, ref), me(address), taps(address, {count, clientTs, batchId, token}), upgrade(address, key), claimChest(address, {id, all}), daily(address), setName(address, name), refreshHolder(address), leaderboard(scope, limit), liveView(), health(), housekeeping()}`; `createAuth({db, now}) -> {nonce(address), verify(address, signature), session(token), logout(token)}`.

- [ ] **Step 1: Failing tests**

**File:** `server/test/players.test.js`
```js
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
  assert.deepEqual(w.db.prepare('SELECT season, seeds FROM season_results WHERE address = ?').all(A), [{ season: '2026-W46', seeds: 140 }])
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
  // away for two days, a block one hour after the last visit still counts, one two days later does not
  block(3, w.now() + H)
  block(4, w.now() + 47 * H)
  w.tick(48 * H)
  me = w.game.me(A)
  assert.deepEqual(me.chests.map((c) => c.block), [2004])
  // twelve blocks in a row leave ten chests
  for (let i = 10; i < 22; i++) block(i, w.now() + i)
  w.tick(60_000)
  me = w.game.me(A)
  assert.equal(me.chests.length, 10)
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
  assert.deepEqual(w.db.prepare('SELECT token FROM sessions').all(), [{ token: 'new' }])
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM tap_batches').get().n, 0)
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM phase_log').get().n, 1)
})
```

**File:** `server/test/auth.test.js`
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet } from 'ethers'
import { openDb } from '../src/db.js'
import { createAuth } from '../src/auth.js'
import { GameError } from '../src/players.js'

function harness() {
  const db = openDb(':memory:')
  let t = 1_700_000_000_000
  return { db, auth: createAuth({ db, now: () => t }), tick: (ms) => { t += ms } }
}
const wallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const err = (fn, code) => { try { fn(); assert.fail('expected ' + code) } catch (e) { assert.ok(e instanceof GameError, String(e)); assert.equal(e.code, code) } }

test('nonce, sign, verify, session', async () => {
  const { auth, tick } = harness()
  err(() => auth.nonce('nope'), 'bad_address')
  const { nonce, message } = auth.nonce(wallet.address)
  assert.equal(nonce.length, 32)
  assert.ok(message.startsWith('Wheelmates sign-in\nAddress: ' + wallet.address + '\nNonce: ' + nonce))
  assert.ok(message.endsWith('No gas, no transaction. Testnet game, seeds have no value.'))
  const sig = await wallet.signMessage(message)
  const s = auth.verify(wallet.address, sig)
  assert.equal(s.address, wallet.address.toLowerCase())
  assert.equal(auth.session(s.token), wallet.address.toLowerCase())
  err(() => auth.verify(wallet.address, sig), 'nonce_expired')
  tick(31 * 86400e3)
  assert.equal(auth.session(s.token), null)
})

test('wrong signer, garbage signature, expired nonce', async () => {
  const { auth, tick } = harness()
  const other = Wallet.createRandom()
  let { message } = auth.nonce(wallet.address)
  err(() => auth.verify(wallet.address, 'garbage'), 'bad_signature')
  ;({ message } = auth.nonce(wallet.address))
  const sig = await other.signMessage(message)
  err(() => auth.verify(wallet.address, sig), 'bad_signature')
  ;({ message } = auth.nonce(wallet.address))
  const good = await wallet.signMessage(message)
  tick(11 * 60e3)
  err(() => auth.verify(wallet.address, good), 'nonce_expired')
})

test('logout ends the session', async () => {
  const { auth } = harness()
  const { message } = auth.nonce(wallet.address)
  const s = auth.verify(wallet.address, await wallet.signMessage(message))
  auth.logout(s.token)
  assert.equal(auth.session(s.token), null)
})
```

- [ ] **Step 2: Run** `cd server && npm test` — expected FAIL: modules missing.

- [ ] **Step 3: Implement**

**File:** `server/src/players.js`
```js
import { keccak256, toUtf8Bytes } from 'ethers'
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

  // Squeek holdings from Squeekchain's account API, at most every ten minutes; a failed read keeps the last value.
  async function refreshHolder(address) {
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

  return { touch, me, taps, upgrade, claimChest, daily, setName, refreshHolder, leaderboard, liveView, health, housekeeping }
}
```

**File:** `server/src/auth.js`
```js
import { randomBytes } from 'node:crypto'
import { isAddress, verifyMessage } from 'ethers'
import { GameError } from './players.js'

export const NONCE_TTL_MS = 10 * 60e3
export const SESSION_TTL_MS = 30 * 86400e3

// Sign-in with a plain signed message (EIP-191): no gas, no transaction, no chain. A session is a random bearer token.
export function createAuth({ db, now = Date.now }) {
  const st = {
    purge: db.prepare('DELETE FROM nonces WHERE expires_at < ?'),
    insert: db.prepare('INSERT INTO nonces (nonce, address, message, expires_at) VALUES (?, ?, ?, ?)'),
    latest: db.prepare('SELECT message FROM nonces WHERE address = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1'),
    drop: db.prepare('DELETE FROM nonces WHERE address = ?'),
    session: db.prepare('INSERT INTO sessions (token, address, expires_at, created_at) VALUES (?, ?, ?, ?)'),
    find: db.prepare('SELECT address, expires_at FROM sessions WHERE token = ?'),
    logout: db.prepare('DELETE FROM sessions WHERE token = ?'),
  }
  function nonce(address) {
    if (!isAddress(address)) throw new GameError(400, 'bad_address')
    const t = now()
    st.purge.run(t)
    const n = randomBytes(16).toString('hex')
    const message = `Wheelmates sign-in\nAddress: ${address}\nNonce: ${n}\nIssued: ${new Date(t).toISOString()}\nNo gas, no transaction. Testnet game, seeds have no value.`
    st.insert.run(n, address.toLowerCase(), message, t + NONCE_TTL_MS)
    return { nonce: n, message }
  }
  function verify(address, signature) {
    if (!isAddress(address)) throw new GameError(400, 'bad_address')
    const t = now()
    const addr = address.toLowerCase()
    const row = st.latest.get(addr, t)
    if (!row) throw new GameError(401, 'nonce_expired')
    let signer
    try {
      signer = verifyMessage(row.message, signature).toLowerCase()
    } catch {
      throw new GameError(401, 'bad_signature')
    }
    if (signer !== addr) throw new GameError(401, 'bad_signature')
    st.drop.run(addr)
    const token = randomBytes(32).toString('hex')
    st.session.run(token, addr, t + SESSION_TTL_MS, t)
    return { token, address: addr, expiresAt: t + SESSION_TTL_MS }
  }
  function session(token) {
    if (!token) return null
    const row = st.find.get(token)
    return row && row.expires_at > now() ? row.address : null
  }
  return { nonce, verify, session, logout: (token) => { if (token) st.logout.run(token) } }
}
```

- [ ] **Step 4: Run** `cd server && npm test` — expected: all pass.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Add the game logic and signed-message sessions"`.

---

### Task 4: HTTP API and boot

**Files:** Create `server/src/api.js`, `server/src/index.js`, `server/test/api.test.js`.

**Interfaces — Produces:** `createServer({auth, game, origins, now, log}) -> http.Server`; routes per the spec.

- [ ] **Step 1: Failing test**

**File:** `server/test/api.test.js`
```js
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet } from 'ethers'
import { openDb } from '../src/db.js'
import { createGame } from '../src/players.js'
import { createAuth } from '../src/auth.js'
import { createServer } from '../src/api.js'

const db = openDb(':memory:')
const snap = { phase: 'running', base: 2, rpm: 70, speedKmh: 3.7, todayKm: 2, block: 2000, progress: 0.4, observedAt: Date.now(), apiAt: Date.now() }
const live = { snapshot: () => snap }
const squeek = { account: async () => ({ ok: true, data: { status: 'available', tokens: [{ basePower: '1000' }] } }) }
const game = createGame({ db, live, squeek, siteUrl: 'http://site/' })
const auth = createAuth({ db })
const server = createServer({ auth, game, origins: ['http://site'], log: { error() {} } })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
after(() => server.close())

const wallet = Wallet.createRandom()
const call = (path, { method = 'GET', body, token } = {}) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: 'http://site', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, json: await r.json(), headers: r.headers }))

test('public routes and CORS', async () => {
  const live = await call('/live')
  assert.equal(live.status, 200)
  assert.equal(live.json.multiplier, 2)
  assert.equal(live.headers.get('access-control-allow-origin'), 'http://site')
  assert.equal((await call('/healthz')).json.ok, true)
  assert.equal((await call('/leaderboard?scope=season')).json.season.length, 8)
  assert.equal((await call('/nope')).status, 404)
  assert.equal((await call('/me')).status, 401)
})

test('sign in, play, upgrade, daily, name, logout', async () => {
  const { json: n } = await call('/auth/nonce', { method: 'POST', body: { address: wallet.address } })
  const signature = await wallet.signMessage(n.message)
  const v = await call('/auth/verify', { method: 'POST', body: { address: wallet.address, signature } })
  assert.equal(v.status, 200)
  const token = v.json.token
  let me = await call('/me', { token })
  assert.equal(me.status, 200)
  assert.equal(me.json.holderBonus, 0.1)
  const taps = await call('/taps', { method: 'POST', token, body: { count: 20, clientTs: Date.now(), batchId: 'b1' } })
  assert.equal(taps.status, 200)
  assert.deepEqual([taps.json.accepted, taps.json.seeds], [20, 44])
  const bad = await call('/taps', { method: 'POST', token, body: { count: 20, clientTs: Date.now() - 9000, batchId: 'b2' } })
  assert.deepEqual([bad.status, bad.json.error], [400, 'clock_skew'])
  const poor = await call('/upgrade', { method: 'POST', token, body: { key: 'sneakers' } })
  assert.deepEqual([poor.status, poor.json.error, poor.json.detail.cost], [409, 'insufficient_seeds', 2000])
  const up = await call('/upgrade', { method: 'POST', token, body: { key: 'wheel' } })
  assert.equal(up.json.tapPower, 2)
  const daily = await call('/daily', { method: 'POST', token })
  assert.equal(daily.json.streak, 1)
  const name = await call('/name', { method: 'POST', token, body: { name: 'Tester One' } })
  assert.equal(name.json.name, 'Tester One')
  const out = await call('/auth/logout', { method: 'POST', token })
  assert.equal(out.status, 200)
  me = await call('/me', { token })
  assert.deepEqual([me.status, me.json.error], [401, 'session_expired'])
})

test('bad json and oversized bodies', async () => {
  const r = await fetch(base + '/auth/nonce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })
  assert.equal(r.status, 400)
  const big = await fetch(base + '/auth/nonce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: 'x'.repeat(20000) }) })
  assert.equal(big.status, 413)
})
```

- [ ] **Step 2: Run** `cd server && npm test` — expected FAIL: `api.js` missing.

- [ ] **Step 3: Implement**

**File:** `server/src/api.js`
```js
import http from 'node:http'
import { GameError } from './players.js'

// The HTTP door: JSON in and out, CORS for the site's origins, 20 requests a second per IP, bearer sessions.
export function createServer({ auth, game, origins = [], now = Date.now, log = console }) {
  const buckets = new Map()
  function allow(ip) {
    const t = now()
    const b = buckets.get(ip) || { tokens: 20, at: t }
    b.tokens = Math.min(20, b.tokens + ((t - b.at) / 1000) * 20)
    b.at = t
    const ok = b.tokens >= 1
    if (ok) b.tokens -= 1
    buckets.set(ip, b)
    if (buckets.size > 10_000) buckets.clear()
    return ok
  }
  function send(res, status, body, extra = {}) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra })
    res.end(JSON.stringify(body))
  }
  function cors(req, res) {
    const o = req.headers.origin
    if (!o || !(origins.includes(o) || origins.includes('*'))) return
    res.setHeader('access-control-allow-origin', o)
    res.setHeader('vary', 'origin')
    res.setHeader('access-control-allow-headers', 'content-type, authorization')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-max-age', '600')
  }
  function body(req) {
    return new Promise((resolve, reject) => {
      let s = ''
      req.on('data', (c) => {
        s += c
        if (s.length > 10_000) {
          reject(new GameError(413, 'too_large'))
          req.destroy()
        }
      })
      req.on('end', () => {
        try {
          resolve(s ? JSON.parse(s) : {})
        } catch {
          reject(new GameError(400, 'bad_json'))
        }
      })
      req.on('error', reject)
    })
  }
  const bearer = (req) => {
    const h = req.headers.authorization || ''
    return h.startsWith('Bearer ') ? h.slice(7) : null
  }

  async function handle(req, res) {
    cors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
    if (!allow(ip)) return send(res, 429, { error: 'rate_limited' }, { 'retry-after': '1' })
    const url = new URL(req.url, 'http://x')
    const route = req.method + ' ' + url.pathname
    try {
      if (route === 'GET /live') return send(res, 200, game.liveView())
      if (route === 'GET /healthz') return send(res, 200, game.health())
      if (route === 'GET /leaderboard') return send(res, 200, game.leaderboard(url.searchParams.get('scope'), url.searchParams.get('limit')))
      if (route === 'POST /auth/nonce') {
        const b = await body(req)
        return send(res, 200, auth.nonce(String(b.address || '')))
      }
      if (route === 'POST /auth/verify') {
        const b = await body(req)
        const s = auth.verify(String(b.address || ''), String(b.signature || ''))
        game.touch(s.address, b.ref)
        return send(res, 200, s)
      }
      if (route === 'POST /auth/logout') {
        auth.logout(bearer(req))
        return send(res, 200, { ok: true })
      }
      const token = bearer(req)
      const address = auth.session(token)
      if (!address) return send(res, 401, { error: token ? 'session_expired' : 'unauthorized' })
      if (route === 'GET /me') {
        await game.refreshHolder(address)
        return send(res, 200, game.me(address))
      }
      if (route === 'POST /taps') {
        const b = await body(req)
        return send(res, 200, game.taps(address, { count: b.count, clientTs: Number(b.clientTs), batchId: String(b.batchId || ''), token }))
      }
      if (route === 'POST /upgrade') {
        const b = await body(req)
        return send(res, 200, game.upgrade(address, String(b.key || '')))
      }
      if (route === 'POST /chest/claim') {
        const b = await body(req)
        return send(res, 200, game.claimChest(address, { id: b.id, all: b.all === true }))
      }
      if (route === 'POST /daily') return send(res, 200, game.daily(address))
      if (route === 'POST /name') {
        const b = await body(req)
        return send(res, 200, game.setName(address, b.name))
      }
      return send(res, 404, { error: 'not_found' })
    } catch (e) {
      if (e instanceof GameError) return send(res, e.status, { error: e.code, ...(e.detail ? { detail: e.detail } : {}) }, e.status === 429 ? { 'retry-after': '1' } : {})
      log.error('api', e)
      return send(res, 500, { error: 'internal' })
    }
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      log.error('api', e)
      try { send(res, 500, { error: 'internal' }) } catch {}
    })
  })
}
```

**File:** `server/src/index.js`
```js
import { openDb } from './db.js'
import { createSqueek } from './squeek.js'
import { createPoller } from './poller.js'
import { createGame } from './players.js'
import { createAuth } from './auth.js'
import { createServer } from './api.js'

// Boot: one SQLite file, the poller, the game, the HTTP door on localhost (Caddy fronts it in production).
const cfg = {
  port: Number(process.env.PORT || 8790),
  host: process.env.HOST || '127.0.0.1',
  db: process.env.WHEELMATES_DB || './wheelmates.sqlite',
  origins: (process.env.WHEELMATES_ORIGINS || 'http://localhost:8080,http://127.0.0.1:8080').split(',').map((s) => s.trim()).filter(Boolean),
  site: process.env.WHEELMATES_SITE || 'http://localhost:8080/',
}
const db = openDb(cfg.db)
const squeek = createSqueek()
const poller = createPoller({ db, squeek })
const game = createGame({ db, live: poller, squeek, siteUrl: cfg.site })
const auth = createAuth({ db })
poller.start()
game.housekeeping()
setInterval(() => game.housekeeping(), 3600e3).unref()
createServer({ auth, game, origins: cfg.origins }).listen(cfg.port, cfg.host, () => {
  console.log(`wheelmates api on http://${cfg.host}:${cfg.port}, db ${cfg.db}, origins ${cfg.origins.join(' ')}`)
})
```

- [ ] **Step 4: Run** `cd server && npm test` — expected: all pass. Then `npm start` for a moment: it prints the listen line and `/live` answers with the real hamster.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Add the HTTP API and the server entry point"`.

---

### Task 5: Pixel art and the site

**Files:** Create `tools/art.py`, `web/img/*.png` (generated), `web/fonts/*` (copied), `web/index.html`, `web/about.html`, `web/config.js`, `web/css/game.css`, `web/js/api.js`, `web/js/wallet.js`, `web/js/cage.js`, `web/js/app.js`.

**Interfaces — Consumes:** the API from Task 4. The client sends `Authorization: Bearer <token>` from `localStorage['wm.token']`.

- [ ] **Step 1: Draw the art**

**File:** `tools/art.py`
```python
"""Draws Wheelmates' pixel art into web/img. Own drawings: a side-view cage, a wheel in 8 frames, a tan hamster running
(4 frames) and napping, a seed, a chest and six item icons. Run: python tools/art.py"""
from pathlib import Path
from PIL import Image, ImageDraw
import math

OUT = Path(__file__).resolve().parent.parent / "web" / "img"
OUT.mkdir(parents=True, exist_ok=True)

BG = (13, 13, 18)
WALL = (26, 26, 34)
BAR = (92, 92, 106)
BAR_HI = (130, 130, 146)
FLOOR = (46, 36, 26)
BED = (196, 170, 122)
BED_DK = (160, 136, 94)
BED_LT = (222, 200, 156)
FUR = (217, 160, 102)
FUR_DK = (170, 118, 66)
FUR_LT = (240, 206, 160)
CREAM = (246, 234, 206)
PINK = (236, 140, 150)
EYE = (20, 16, 14)
RIM = (201, 201, 212)
RIM_DK = (120, 120, 134)
SPOKE = (160, 160, 172)
ORANGE = (246, 166, 59)
SEED_A = (90, 70, 50)
SEED_B = (236, 226, 196)
WOOD = (120, 80, 44)
WOOD_DK = (84, 54, 28)
GOLD = (236, 190, 70)
STEEL = (150, 160, 180)
BLUE = (120, 180, 230)
GREEN = (110, 180, 110)


def new(w, h, color=(0, 0, 0, 0)):
    return Image.new("RGBA", (w, h), color)


def px(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((x, y), c if len(c) == 4 else c + (255,))


def rect(im, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px(im, x, y, c)


def cage():
    im = new(180, 120, BG + (255,))
    rect(im, 0, 0, 179, 99, WALL)
    for x in range(6, 180, 12):  # bars
        rect(im, x, 0, x, 99, BAR)
        px(im, x + 1, 0, BAR_HI)
        for y in range(0, 100, 7):
            px(im, x, y, BAR_HI)
    rect(im, 0, 100, 179, 119, FLOOR)
    rect(im, 0, 100, 179, 103, BED_DK)
    rect(im, 0, 104, 179, 112, BED)
    for i in range(0, 180, 5):  # bedding texture
        px(im, i, 104 + (i * 7) % 8, BED_LT)
        px(im, (i + 3) % 180, 106 + (i * 3) % 6, BED_DK)
    # water bottle on the right
    rect(im, 158, 40, 170, 78, STEEL)
    rect(im, 160, 42, 168, 70, BLUE)
    rect(im, 163, 79, 165, 90, STEEL)
    px(im, 164, 91, BLUE)
    # food bowl on the left
    rect(im, 10, 96, 30, 103, WOOD)
    rect(im, 12, 94, 28, 96, SEED_B)
    for x in range(13, 28, 3):
        px(im, x, 94, SEED_A)
    im.save(OUT / "cage.png")


def wheel_frames():
    for f in range(8):
        im = new(64, 64)
        d = ImageDraw.Draw(im)
        cx = cy = 31.5
        d.ellipse((4, 4, 59, 59), outline=RIM, width=3)
        d.ellipse((8, 8, 55, 55), outline=RIM_DK, width=1)
        for s in range(6):
            a = math.radians(s * 60 + f * 7.5)
            d.line((cx, cy, cx + 25 * math.cos(a), cy + 25 * math.sin(a)), fill=SPOKE, width=2)
        d.ellipse((27, 27, 36, 36), fill=ORANGE)
        d.ellipse((30, 30, 33, 33), fill=RIM)
        im.save(OUT / f"wheel-{f}.png")


def hamster_run(frame):
    im = new(32, 24)
    # body: a plump ellipse, head to the right
    body = [(6, 10, 25, 20), (6, 11, 25, 21), (6, 9, 25, 19), (6, 11, 25, 21)][frame]
    ImageDraw.Draw(im).ellipse(body, fill=FUR)
    ImageDraw.Draw(im).ellipse((20, 8, 29, 17), fill=FUR)  # head
    rect(im, 10, 16, 20, 19, CREAM)  # belly
    rect(im, 8, 11, 12, 13, FUR_DK)  # back shade
    px(im, 23, 7, FUR_DK); px(im, 24, 6, FUR); px(im, 22, 8, PINK)  # ear
    px(im, 26, 11, EYE); px(im, 27, 11, EYE)
    px(im, 29, 13, PINK)  # nose
    px(im, 24, 14, FUR_LT); px(im, 25, 14, FUR_LT)  # cheek
    # legs alternate
    legs = [((10, 20, 11, 22), (18, 20, 19, 22)), ((9, 20, 10, 23), (19, 20, 20, 21)), ((11, 20, 12, 21), (17, 20, 18, 23)), ((12, 20, 13, 22), (16, 20, 17, 22))][frame]
    for l in legs:
        rect(im, *l, PINK)
    px(im, 5, 12, FUR_DK)  # tail nub
    im.save(OUT / f"hamster-run-{frame}.png")


def hamster_nap():
    im = new(32, 24)
    ImageDraw.Draw(im).ellipse((6, 9, 27, 22), fill=FUR)
    rect(im, 10, 17, 22, 20, CREAM)
    rect(im, 8, 11, 14, 13, FUR_DK)
    px(im, 23, 8, FUR_DK); px(im, 22, 9, PINK)
    rect(im, 24, 13, 26, 13, EYE)  # closed eye
    px(im, 28, 15, PINK)
    for i, (x, y) in enumerate([(29, 6), (30, 3), (31, 0)]):
        px(im, x, y, (160, 170, 210))
    im.save(OUT / "hamster-nap.png")


def seed():
    im = new(8, 8)
    ImageDraw.Draw(im).ellipse((1, 0, 6, 7), fill=SEED_A)
    rect(im, 3, 1, 4, 6, SEED_B)
    im.save(OUT / "seed.png")


def chest():
    im = new(20, 16)
    rect(im, 1, 5, 18, 14, WOOD)
    rect(im, 1, 2, 18, 5, WOOD_DK)
    rect(im, 1, 9, 18, 9, WOOD_DK)
    rect(im, 8, 7, 11, 11, GOLD)
    px(im, 9, 9, WOOD_DK); px(im, 10, 9, WOOD_DK)
    im.save(OUT / "chest.png")


def icons():
    def wheel_icon(im):
        ImageDraw.Draw(im).ellipse((1, 1, 14, 14), outline=RIM, width=2)
        rect(im, 7, 7, 8, 8, ORANGE)
    def bottle(im):
        rect(im, 5, 1, 10, 11, STEEL); rect(im, 6, 2, 9, 9, BLUE); rect(im, 7, 12, 8, 14, STEEL)
    def bedding(im):
        rect(im, 1, 8, 14, 14, BED); rect(im, 1, 6, 14, 8, BED_DK)
        for x in range(2, 14, 3): px(im, x, 9 + x % 3, BED_LT)
    def pantry(im):
        rect(im, 2, 2, 13, 13, WOOD); rect(im, 3, 3, 12, 7, SEED_B)
        for x in range(4, 12, 2): px(im, x, 5, SEED_A)
    def stash(im):
        rect(im, 1, 4, 14, 14, WOOD_DK); rect(im, 2, 5, 13, 13, WOOD); rect(im, 6, 1, 9, 4, WOOD_DK)
        px(im, 7, 9, GOLD); px(im, 8, 9, GOLD)
    def sneakers(im):
        rect(im, 1, 8, 14, 12, (236, 236, 240)); rect(im, 1, 12, 14, 13, ORANGE); rect(im, 8, 5, 13, 8, (236, 236, 240))
        px(im, 10, 6, ORANGE); px(im, 12, 6, ORANGE)
    for name, fn in [("wheel", wheel_icon), ("bottle", bottle), ("bedding", bedding), ("pantry", pantry), ("stash", stash), ("sneakers", sneakers)]:
        im = new(16, 16)
        fn(im)
        im.save(OUT / f"icon-{name}.png")


if __name__ == "__main__":
    cage()
    wheel_frames()
    for f in range(4):
        hamster_run(f)
    hamster_nap()
    seed()
    chest()
    icons()
    print("drew", len(list(OUT.glob("*.png"))), "images into", OUT)
```

Run `python tools/art.py` and `cp C:/Users/user/squeek-odometer/dist/fonts/* web/fonts/`. Open a couple of the PNGs at 4x and fix anything that does not read (the hamster must read as a hamster facing right).

- [ ] **Step 2: The site**

**File:** `web/config.js`
```js
// The API origin. The deploy writes the production value here.
window.WM = { api: 'http://127.0.0.1:8790' }
```

**File:** `web/css/game.css`
```css
@font-face { font-family: "IBM Plex Mono"; font-weight: 400; font-display: swap; src: url(../fonts/ibm-plex-mono-400.woff2) format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 500; font-display: swap; src: url(../fonts/ibm-plex-mono-500.woff2) format("woff2"); }
@font-face { font-family: "Barlow Condensed"; font-weight: 700; font-display: swap; src: url(../fonts/barlow-condensed-700.woff2) format("woff2"); }

:root {
  --page: #000; --panel: #0d0d12; --sunk: #16161d; --line: #22222b; --line-strong: #30303b;
  --ink: #f3f3f6; --text: #cfcfd8; --muted: #8d8d9b; --accent: #f6a63b; --on-accent: #120d05; --good: #7fe08a; --bad: #ff8573; --run: #7fe08a; --zoom: #ffd166;
  --mono: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace; --head: "Barlow Condensed", "Arial Narrow", system-ui, sans-serif;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--page); color: var(--text); font: 400 15px/1.5 var(--mono); -webkit-font-smoothing: antialiased; }
body { min-height: 100dvh; display: flex; flex-direction: column; -webkit-tap-highlight-color: transparent; }
a { color: var(--accent); }
h1, h2, h3 { font-family: var(--head); font-weight: 700; text-transform: uppercase; color: var(--ink); line-height: 0.95; margin: 0; }
.label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.num { font-variant-numeric: tabular-nums; }
[hidden] { display: none !important; }
img.px, canvas { image-rendering: pixelated; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 0 16px; border-radius: 6px; border: 1px solid var(--line-strong); background: transparent; color: var(--ink); font: 500 12px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; text-decoration: none; }
.btn.solid { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn.small { min-height: 34px; padding: 0 12px; font-size: 11px; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* top bar: the live hamster */
.top { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: rgb(0 0 0 / 0.9); border-bottom: 1px solid var(--line); backdrop-filter: blur(6px); }
.live { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.live canvas { width: 28px; height: 28px; flex: none; }
.live .state { display: grid; line-height: 1.2; min-width: 0; }
.live .state b { font: 700 16px/1 var(--head); text-transform: uppercase; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.live .state span { font-size: 11px; color: var(--muted); white-space: nowrap; }
.live .mult { font: 700 20px/1 var(--head); color: var(--accent); padding: 4px 8px; border: 1px solid var(--line-strong); border-radius: 6px; flex: none; }
.live.running .mult { color: var(--run); border-color: var(--run); }
.live.zoomies .mult { color: var(--zoom); border-color: var(--zoom); }

main { flex: 1; width: 100%; max-width: 520px; margin: 0 auto; padding: 12px 12px 84px; }
.tab { display: none; }
.tab.on { display: block; }

/* cage tab */
.counters { display: flex; justify-content: space-between; align-items: end; margin-bottom: 10px; }
.counters strong { display: block; font: 700 36px/1 var(--head); color: var(--ink); }
.counters .right { text-align: right; }
.counters .right strong { font-size: 22px; color: var(--text); }
.cage-wrap { position: relative; border-radius: 10px; overflow: hidden; border: 1px solid var(--line-strong); background: #0d0d12; touch-action: manipulation; user-select: none; }
#cage { display: block; width: 100%; height: auto; cursor: pointer; }
.banner { position: absolute; left: 8px; top: 8px; padding: 4px 8px; border-radius: 4px; background: rgb(0 0 0 / 0.65); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); pointer-events: none; }
.banner.hot { color: var(--run); }
.chest-btn { position: absolute; right: 8px; bottom: 8px; display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; background: rgb(0 0 0 / 0.7); border: 1px solid var(--accent); color: var(--ink); font: 500 12px/1 var(--mono); cursor: pointer; }
.chest-btn img { width: 20px; height: 16px; }
.energy { margin-top: 10px; }
.energy .bar { height: 10px; border-radius: 5px; background: var(--sunk); overflow: hidden; }
.energy .fill { height: 100%; width: 100%; background: var(--accent); transition: width 0.3s linear; }
.energy .row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-top: 4px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.msg { min-height: 1.4em; margin: 10px 0 0; font-size: 13px; color: var(--muted); }
.msg.bad { color: var(--bad); }
.msg.good { color: var(--good); }

/* lists */
.card { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--panel); margin-bottom: 10px; }
.item { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: center; }
.item img { width: 32px; height: 32px; }
.item h3 { font-size: 18px; }
.item .effect { font-size: 12px; color: var(--muted); }
.item .lvl { font-size: 11px; color: var(--accent); letter-spacing: 0.1em; }
.item .btn { min-width: 96px; }
.cost { display: inline-flex; align-items: center; gap: 4px; }
.cost img { width: 10px; height: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
td, th { padding: 8px 6px; border-top: 1px solid var(--line); text-align: left; }
th { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
td.r, th.r { text-align: right; }
tr.me td { color: var(--accent); }
.seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: 6px; overflow: hidden; margin-bottom: 10px; }
.seg button { border: 0; background: transparent; color: var(--muted); padding: 8px 14px; font: 500 11px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; }
.seg button.on { background: var(--sunk); color: var(--ink); }
.copy { display: flex; gap: 8px; }
.copy input { flex: 1; min-width: 0; height: 36px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 6px; background: #0b0b0e; color: var(--text); font: 400 12px var(--mono); }
.hero-text { padding: 20px 0 6px; }
.hero-text h1 { font-size: 40px; }
.hero-text p { margin: 8px 0 0; color: var(--muted); font-size: 13px; }

/* bottom tabs */
.tabs { position: fixed; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: repeat(4, 1fr); background: rgb(0 0 0 / 0.92); border-top: 1px solid var(--line); backdrop-filter: blur(6px); padding-bottom: env(safe-area-inset-bottom); }
.tabs button { border: 0; background: transparent; color: var(--muted); padding: 12px 4px 10px; font: 500 11px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; }
.tabs button.on { color: var(--accent); box-shadow: inset 0 2px 0 var(--accent); }

/* about */
.doc { max-width: 680px; margin: 0 auto; padding: 24px 16px 60px; }
.doc h1 { font-size: 44px; margin-bottom: 12px; }
.doc h2 { font-size: 26px; margin: 28px 0 10px; }
.doc p, .doc li { font-size: 14px; }
.doc .fine { font-size: 12px; color: var(--muted); }
```

**File:** `web/js/api.js`
```js
// The server. One token in localStorage; every error is {status, code, detail}.
const KEY = 'wm.token'
export const api = {
  token: () => { try { return localStorage.getItem(KEY) } catch { return null } },
  setToken(t) { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY) } catch {} },
  async call(path, { method = 'GET', body } = {}) {
    const headers = { 'content-type': 'application/json' }
    const token = api.token()
    if (token) headers.authorization = 'Bearer ' + token
    let res
    try {
      res = await fetch(window.WM.api + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    } catch {
      throw { status: 0, code: 'offline' }
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401) api.setToken(null)
      throw { status: res.status, code: json.error || 'error', detail: json.detail }
    }
    return json
  },
}
```

**File:** `web/js/wallet.js`
```js
import { api } from './api.js'

// Connect: ask the wallet for an account, fetch a nonce, sign the plain message, get a session. No chain switch.
export async function connect(ref) {
  const eth = window.ethereum
  if (!eth) throw { code: 'no_wallet' }
  const [account] = await eth.request({ method: 'eth_requestAccounts' })
  const { message } = await api.call('/auth/nonce', { method: 'POST', body: { address: account } })
  const hex = '0x' + Array.from(new TextEncoder().encode(message)).map((b) => b.toString(16).padStart(2, '0')).join('')
  const signature = await eth.request({ method: 'personal_sign', params: [hex, account] })
  const s = await api.call('/auth/verify', { method: 'POST', body: { address: account, signature, ref } })
  api.setToken(s.token)
  return s
}

export async function disconnect() {
  try { await api.call('/auth/logout', { method: 'POST' }) } catch {}
  api.setToken(null)
}

export const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '')
```

**File:** `web/js/cage.js`
```js
// The cage on a canvas: background, a wheel that spins with the real hamster and every tap, a running or napping
// hamster, and "+N" seeds floating up. Logical size 360 x 240, drawn pixelated.
const W = 360
const H = 240
const load = (name) => { const im = new Image(); im.src = `img/${name}.png`; return im }
const IMG = {
  cage: load('cage'),
  wheel: Array.from({ length: 8 }, (_, i) => load(`wheel-${i}`)),
  run: Array.from({ length: 4 }, (_, i) => load(`hamster-run-${i}`)),
  nap: load('hamster-nap'),
  seed: load('seed'),
}

export function createCage(canvas) {
  const ctx = canvas.getContext('2d')
  canvas.width = W
  canvas.height = H
  ctx.imageSmoothingEnabled = false
  const state = { angle: 0, rpm: 0, kick: 0, asleep: true, floats: [], last: performance.now() }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches

  function frame(now) {
    const dt = Math.min(0.1, (now - state.last) / 1000)
    state.last = now
    // wheel: the hamster's real rpm plus the player's pushes, which wind down
    const degPerSec = state.rpm * 6 + state.kick
    state.kick = Math.max(0, state.kick - state.kick * 2.2 * dt - 20 * dt)
    if (!still) state.angle = (state.angle + degPerSec * dt) % 360
    draw(now)
    requestAnimationFrame(frame)
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H)
    if (IMG.cage.complete) ctx.drawImage(IMG.cage, 0, 0, W, H)
    const spinning = state.rpm > 0 || state.kick > 15
    const idx = Math.floor(((state.angle % 60) / 60) * 8) % 8
    const wheel = IMG.wheel[idx]
    if (wheel.complete) ctx.drawImage(wheel, 116, 52, 128, 128)
    const ham = spinning ? IMG.run[Math.floor(now / (spinning && state.rpm > 60 ? 70 : 110)) % 4] : IMG.nap
    if (ham.complete) ctx.drawImage(ham, spinning ? 148 : 60, spinning ? 120 : 176, 64, 48)
    state.floats = state.floats.filter((f) => now - f.at < 900)
    ctx.font = '700 22px "Barlow Condensed", sans-serif'
    ctx.textAlign = 'center'
    for (const f of state.floats) {
      const k = (now - f.at) / 900
      ctx.globalAlpha = 1 - k
      ctx.fillStyle = f.hot ? '#ffd166' : '#f3e9cc'
      ctx.fillText('+' + f.n, f.x, f.y - k * 60)
      if (IMG.seed.complete) ctx.drawImage(IMG.seed, f.x + 18, f.y - 16 - k * 60, 16, 16)
    }
    ctx.globalAlpha = 1
  }

  requestAnimationFrame(frame)
  return {
    setLive({ rpm, phase }) {
      state.rpm = rpm || 0
      state.asleep = !(phase === 'running' || phase === 'zoomies')
    },
    tap(x, y, n, hot) {
      state.kick = Math.min(900, state.kick + 140)
      state.floats.push({ x: Math.max(30, Math.min(W - 30, x)), y: Math.max(40, Math.min(H - 20, y)), n, hot, at: performance.now() })
    },
  }
}
```

**File:** `web/js/app.js`
```js
import { api } from './api.js'
import { connect, disconnect, short } from './wallet.js'
import { createCage } from './cage.js'

const $ = (id) => document.getElementById(id)
const fmt = (n) => Math.floor(n).toLocaleString('en-US')
const UPGRADE_TEXT = {
  wheel: (s) => `Tap power ${s.tapPower}`,
  bottle: (s) => `Energy ${s.energyMax}`,
  bedding: (s) => `Regen ${s.regenPerSec}/s`,
  pantry: (s) => `${s.seedsPerHour} seeds/hour`,
  stash: (s) => `Keeps ${s.offlineCapHours} h while away`,
  sneakers: (s) => `+${s.sneakers.toFixed(1)} when he runs`,
}
const NAMES = { wheel: 'Wheel', bottle: 'Water bottle', bedding: 'Bedding', pantry: 'Pantry', stash: 'Seed stash', sneakers: 'Sneakers' }

const cage = createCage($('cage'))
let me = null
let live = { phase: 'offair', rpm: 0, multiplier: 1 }
let pending = 0
let shownSeeds = 0
let shownEnergy = 0
let energyAt = performance.now()
const ref = new URLSearchParams(location.search).get('ref') || undefined

// ---------------------------------------------------------------- live hamster
async function pollLive() {
  try {
    live = await api.call('/live')
  } catch {
    live = { ...live, phase: 'offair', rpm: 0, multiplier: 1 }
  }
  const el = $('live')
  el.className = 'live ' + live.phase
  const words = { offair: 'is off air', still: 'took a break', running: 'is running', zoomies: 'has the zoomies' }[live.phase] || 'tuning in'
  $('liveText').textContent = 'Squeektoshi ' + words
  $('liveSub').textContent = live.todayKm != null ? `${live.todayKm.toFixed(2)} km today · ${live.speedKmh.toFixed(1)} km/h · block ${fmt(live.block || 0)}` : 'Squeekchain is quiet'
  $('liveMult').textContent = '×' + (me ? me.live.multiplier : live.multiplier)
  $('banner').textContent = live.phase === 'running' || live.phase === 'zoomies' ? 'He is running: taps pay ×' + (me ? me.live.multiplier : live.multiplier) : live.phase === 'offair' ? 'Off air' : 'Napping: taps pay ×1'
  $('banner').classList.toggle('hot', live.phase === 'running' || live.phase === 'zoomies')
  cage.setLive(live)
  drawMiniWheel()
}

let miniAngle = 0
function drawMiniWheel() {
  const c = $('liveWheel')
  const ctx = c.getContext('2d')
  c.width = c.height = 28
  ctx.clearRect(0, 0, 28, 28)
  ctx.strokeStyle = '#9a9aa6'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(14, 14, 11, 0, 6.2832); ctx.stroke()
  ctx.strokeStyle = live.rpm > 0 ? '#f3e9cc' : '#5c5c6a'
  for (let s = 0; s < 3; s++) {
    const a = ((s * 120 + miniAngle) * Math.PI) / 180
    ctx.beginPath(); ctx.moveTo(14, 14); ctx.lineTo(14 + 9 * Math.cos(a), 14 + 9 * Math.sin(a)); ctx.stroke()
  }
}
setInterval(() => { if (live.rpm > 0) { miniAngle = (miniAngle + live.rpm * 0.6) % 360; drawMiniWheel() } }, 100)

// ---------------------------------------------------------------- the player
function render() {
  const signed = Boolean(me)
  $('connect').textContent = signed ? short(me.address) : 'Connect wallet'
  $('signout').hidden = !signed
  $('daily').hidden = !signed || !me.dailyClaimable
  if (signed) $('daily').textContent = `Daily bonus +${me.dailyReward}`
  $('chestBtn').hidden = !signed || !me.chests.length
  if (signed && me.chests.length) $('chestCount').textContent = `${me.chests.length} chest${me.chests.length > 1 ? 's' : ''}: +${fmt(me.chests.reduce((a, c) => a + c.seeds, 0))}`
  shownSeeds = signed ? me.seeds : 0
  shownEnergy = signed ? me.energy : 500
  energyAt = performance.now()
  $('seeds').textContent = fmt(shownSeeds)
  $('seasonSeeds').textContent = signed ? fmt(me.seasonSeeds) : '0'
  $('rank').textContent = signed ? `#${me.rank.season} this week` : 'This week'
  $('liveMult').textContent = '×' + (signed ? me.live.multiplier : live.multiplier)
  renderUpgrades()
  renderFriends()
}

function tickEnergy() {
  if (!me) return
  const e = Math.min(me.energyMax, shownEnergy + (me.regenPerSec * (performance.now() - energyAt)) / 1000)
  $('energyFill').style.width = (100 * e) / me.energyMax + '%'
  $('energyText').textContent = `${Math.floor(e)} / ${me.energyMax}`
}
setInterval(tickEnergy, 250)

function renderUpgrades() {
  const box = $('upgrades')
  box.textContent = ''
  if (!me) { box.innerHTML = '<p class="msg">Connect your wallet to build the cage.</p>'; return }
  for (const key of Object.keys(NAMES)) {
    const level = me.upgrades[key] || 0
    const cost = me.costs[key]
    const card = document.createElement('div')
    card.className = 'card item'
    card.innerHTML = `<img class="px" src="img/icon-${key}.png" alt=""><div><div class="lvl">Level ${level}</div><h3>${NAMES[key]}</h3><div class="effect">${UPGRADE_TEXT[key](me)}</div></div>
      <button class="btn ${cost !== null && me.seeds >= cost ? 'solid' : ''}" data-key="${key}" ${cost === null || me.seeds < cost ? 'disabled' : ''}>${cost === null ? 'Max' : `<span class="cost"><img src="img/seed.png" alt="">${fmt(cost)}</span>`}</button>`
    box.append(card)
  }
}

function renderFriends() {
  if (!me) { $('friends').innerHTML = '<p class="msg">Connect your wallet to get your invite link.</p>'; return }
  const list = me.referral.friends.map((f) => `<tr><td>${f.name || short(f.address)}</td><td class="r">${f.counts ? '5%' : '—'}</td></tr>`).join('')
  $('friends').innerHTML = `<div class="card"><div class="label">Your invite link</div><div class="copy"><input readonly value="${me.referral.link}" aria-label="Invite link"><button class="btn small" id="copyRef">Copy</button></div>
    <p class="msg">You get 5% of what your first ten friends earn from taps and chests, up to 20,000 seeds a week. They lose nothing.</p></div>
    <div class="card"><div class="label">Friends · earned ${fmt(me.referral.earned)}</div><table><tbody>${list || '<tr><td class="msg">Nobody yet.</td></tr>'}</tbody></table></div>`
  $('copyRef').onclick = async () => { try { await navigator.clipboard.writeText(me.referral.link); $('copyRef').textContent = 'Copied' } catch { $('copyRef').textContent = 'Select' } }
}

async function loadLeaders(scope) {
  const data = await api.call('/leaderboard?scope=' + scope)
  $('leadersTitle').textContent = scope === 'all' ? 'All time' : 'Week ' + data.season
  $('leaders').innerHTML = `<table><thead><tr><th>#</th><th>Player</th><th class="r">Seeds</th></tr></thead><tbody>${data.rows
    .map((r) => `<tr class="${me && r.address === me.address ? 'me' : ''}"><td>${r.rank}</td><td>${r.name || short(r.address)}${r.holder ? ' ·' : ''}</td><td class="r num">${fmt(r.seeds)}</td></tr>`)
    .join('') || '<tr><td colspan="3" class="msg">Nobody yet. Be the first.</td></tr>'}</tbody></table>`
}

// ---------------------------------------------------------------- taps
function onTap(e) {
  if (!me) { say('Connect your wallet to play.'); return }
  const now = performance.now()
  const energy = Math.min(me.energyMax, shownEnergy + (me.regenPerSec * (now - energyAt)) / 1000)
  if (energy < 1) { say('Out of energy: it comes back 1 per second.'); return }
  shownEnergy = energy - 1
  energyAt = now
  const hot = me.live.multiplier > 1
  const gain = Math.floor(me.tapPower * me.live.multiplier * (1 + me.holderBonus))
  pending += 1
  shownSeeds += gain
  $('seeds').textContent = fmt(shownSeeds)
  const r = $('cage').getBoundingClientRect()
  const p = e.touches ? e.touches[0] : e
  cage.tap(((p.clientX - r.left) / r.width) * 360, ((p.clientY - r.top) / r.height) * 240, gain, hot)
}
$('cage').addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(e) })

let batchTimer = null
async function flush() {
  if (!me || pending === 0) return
  const count = Math.min(60, pending)
  pending -= count
  try {
    const r = await api.call('/taps', { method: 'POST', body: { count, clientTs: Date.now(), batchId: crypto.randomUUID() } })
    shownSeeds = r.total
    shownEnergy = r.energy
    energyAt = performance.now()
    me.seeds = r.total
    me.seasonSeeds = r.seasonSeeds
    me.live.multiplier = r.multiplier
    $('seeds').textContent = fmt(shownSeeds)
    $('seasonSeeds').textContent = fmt(me.seasonSeeds)
    renderUpgrades()
  } catch (err) {
    if (err.code === 'stale_session') await refresh()
    else if (err.code === 'too_fast') pending += count
    else if (err.status === 401) { me = null; render(); say('Session ended. Connect again.', 'bad') }
  }
}
batchTimer = setInterval(flush, 2000)
document.addEventListener('visibilitychange', () => { if (document.hidden) flush() })

// ---------------------------------------------------------------- actions
function say(text, kind = '') { const m = $('msg'); m.textContent = text; m.className = 'msg ' + kind }

async function refresh() {
  if (!api.token()) { me = null; render(); return }
  try { me = await api.call('/me') } catch (e) { me = null; if (e.code !== 'offline') api.setToken(null) }
  render()
}

$('connect').onclick = async () => {
  if (me) return
  try {
    await connect(ref)
    await refresh()
    say('Connected. Tap the cage.', 'good')
  } catch (e) {
    say(e.code === 'no_wallet' ? 'No wallet found. Install MetaMask or open this page in a wallet browser.' : e.code === 4001 || e.code === 'ACTION_REJECTED' ? 'Signature cancelled.' : 'Could not sign in: ' + (e.code || e.message || e), 'bad')
  }
}
$('signout').onclick = async () => { await disconnect(); me = null; render() }
$('daily').onclick = async () => { try { me = await api.call('/daily', { method: 'POST' }); render(); say(`Daily bonus taken. Streak ${me.streak}.`, 'good') } catch (e) { say('Already taken today.', 'bad') } }
$('chestBtn').onclick = async () => { try { me = await api.call('/chest/claim', { method: 'POST', body: { all: true } }); render(); say('Chests opened.', 'good') } catch { await refresh() } }
$('upgrades').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-key]')
  if (!b) return
  try { me = await api.call('/upgrade', { method: 'POST', body: { key: b.dataset.key } }); render(); say(`${NAMES[b.dataset.key]} is level ${me.upgrades[b.dataset.key]}.`, 'good') } catch (err) { say(err.code === 'insufficient_seeds' ? 'Not enough seeds yet.' : 'Could not buy that.', 'bad') }
})
$('nameForm').onsubmit = async (e) => {
  e.preventDefault()
  try { me = await api.call('/name', { method: 'POST', body: { name: $('nameInput').value } }); render(); say('Name saved.', 'good') } catch (err) { say({ name_taken: 'That name is taken.', name_cooldown: 'You can change your name once a day.', invalid_name: '3 to 20 letters, digits, spaces or _.' }[err.code] || 'Could not save.', 'bad') }
}
for (const b of document.querySelectorAll('.tabs button')) {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b))
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab))
    if (b.dataset.tab === 'leaders') loadLeaders(document.querySelector('.seg button.on').dataset.scope)
  }
}
for (const b of document.querySelectorAll('.seg button')) b.onclick = () => { document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b)); loadLeaders(b.dataset.scope) }

// ---------------------------------------------------------------- boot
pollLive()
setInterval(pollLive, 5000)
refresh()
setInterval(refresh, 10 * 60e3)
if (window.ethereum) window.ethereum.on?.('accountsChanged', () => { api.setToken(null); me = null; render() })
```

**File:** `web/index.html`
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Wheelmates</title>
  <meta name="description" content="Push the wheel with Squeektoshi. A tap game on the live Squeekchain hamster: when he runs, every tap pays more; when a block is found, you get a chest.">
  <meta name="theme-color" content="#000000">
  <link rel="icon" href="img/wheel-0.png" type="image/png">
  <link rel="stylesheet" href="css/game.css">
</head>
<body>
  <header class="top">
    <div class="live offair" id="live">
      <canvas id="liveWheel" width="28" height="28" aria-hidden="true"></canvas>
      <div class="state"><b id="liveText">Tuning in</b><span id="liveSub">Squeekchain</span></div>
      <span class="mult" id="liveMult" title="Tap multiplier right now">×1</span>
    </div>
    <button class="btn small" id="connect">Connect wallet</button>
  </header>

  <main>
    <section class="tab on" id="tab-cage">
      <div class="counters">
        <div><span class="label">Seeds</span><strong class="num" id="seeds">0</strong></div>
        <div class="right"><span class="label" id="rank">This week</span><strong class="num" id="seasonSeeds">0</strong></div>
      </div>
      <div class="cage-wrap">
        <canvas id="cage" width="360" height="240" aria-label="Squeektoshi's cage. Tap to push the wheel."></canvas>
        <span class="banner" id="banner">Tuning in</span>
        <button class="chest-btn" id="chestBtn" hidden><img class="px" src="img/chest.png" alt=""><span id="chestCount"></span></button>
      </div>
      <div class="energy"><div class="bar"><div class="fill" id="energyFill"></div></div><div class="row"><span class="label">Energy</span><span class="num" id="energyText">500 / 500</span></div></div>
      <div class="actions">
        <button class="btn solid" id="daily" hidden>Daily bonus</button>
        <button class="btn small" id="signout" hidden>Sign out</button>
        <a class="btn small" href="about.html">About</a>
      </div>
      <p class="msg" id="msg" role="status" aria-live="polite">Tap the cage to push the wheel. When the real Squeektoshi runs, every tap pays more.</p>
    </section>

    <section class="tab" id="tab-upgrades">
      <div class="hero-text"><h1>The cage</h1><p>Seeds buy a better wheel, a bigger bottle, softer bedding, a pantry that earns while you sleep.</p></div>
      <div id="upgrades"></div>
    </section>

    <section class="tab" id="tab-friends">
      <div class="hero-text"><h1>Friends</h1><p>Bring your wheelmates.</p></div>
      <div id="friends"></div>
      <form class="card" id="nameForm"><div class="label">Your name on the board</div><div class="copy"><input id="nameInput" maxlength="20" placeholder="3 to 20 characters" aria-label="Display name"><button class="btn small" type="submit">Save</button></div></form>
    </section>

    <section class="tab" id="tab-leaders">
      <div class="hero-text"><h1>Leaders</h1><p id="leadersTitle">This week</p></div>
      <div class="seg"><button class="on" data-scope="season">Week</button><button data-scope="all">All time</button></div>
      <div id="leaders"></div>
    </section>
  </main>

  <nav class="tabs" aria-label="Sections">
    <button class="on" data-tab="cage">Cage</button>
    <button data-tab="upgrades">Upgrades</button>
    <button data-tab="friends">Friends</button>
    <button data-tab="leaders">Leaders</button>
  </nav>

  <script src="config.js"></script>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

**File:** `web/about.html`
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>About Wheelmates</title>
  <meta name="description" content="How Wheelmates reads Squeekchain, what the wallet signature is for, and what the game never does.">
  <link rel="icon" href="img/wheel-0.png" type="image/png">
  <link rel="stylesheet" href="css/game.css">
</head>
<body>
  <main class="doc">
    <p class="label">Squeekchain Genesis Code Lane</p>
    <h1>Wheelmates</h1>
    <p>A tap game around Squeektoshi, the real hamster whose wheel powers <a href="https://squeekchain.com">Squeekchain</a>. You push a wheel for seeds; he sets the tempo. Testnet only: seeds have no value, there is no token and nothing is sold.</p>

    <h2>How it reads Squeekchain</h2>
    <ul>
      <li>Every 5 seconds the server reads the wheel's status from Squeekchain's public API: whether the device is online, its RPM and speed, today's distance, the Squeek block height and progress.</li>
      <li>Two readings in a row with the wheel turning make him <b>running</b>: the wheel on your screen turns at his real RPM and every tap pays ×2. At 4.5 km/h or more he has the <b>zoomies</b>: ×3. Still or off air: ×1.</li>
      <li>Every 15 seconds the server reads the event feed. A settlement on SqueekCore that completes Squeek blocks gives every player who was around in the last day a <b>chest</b>.</li>
      <li>Passive income from the pantry runs ×1.5 while he runs, computed from a log of his phases, so what you earn away from the game is also his doing.</li>
      <li>If you connect a wallet that holds Squeeks (in the wallet or in staking), the account API gives you a <b>holder bonus</b>: 10% per Squeek-equivalent (a Level 2 counts as 2.2), up to 50%, rechecked every ten minutes.</li>
    </ul>

    <h2>The wallet signature</h2>
    <p>Signing in means signing a plain text message with your wallet: no gas, no transaction, no chain switch, no approval. It only proves the address is yours, so your seeds, cage and place on the board belong to it. The game never asks you to send a transaction and never touches a token.</p>

    <h2>What the game never does</h2>
    <ul>
      <li>No transactions, no token, no payouts, no purchases. Seeds are points.</li>
      <li>No tracking beyond what the game needs: your address, your seeds and your upgrades.</li>
      <li>Not affiliated with Squeekchain. A community build for the Genesis Code Lane.</li>
    </ul>

    <h2>Fair play</h2>
    <p>Everything is counted on the server: energy, seeds, multipliers and chests. Your browser only reports how many times you tapped, at most 15 a second and never beyond your energy, which comes back one point a second. Autoclickers gain nothing a thumb cannot.</p>

    <p class="fine"><a href="./">Back to the cage</a> · <a href="https://github.com/am3en0x/wheelmates">Source</a> · <a href="https://docs.squeekchain.com/developers/api/">Squeekchain API</a></p>
  </main>
</body>
</html>
```

- [ ] **Step 3: Browser check** — run the server (`npm start` in `server/`) and `python -m http.server 8080 -d web`; in Playwright inject a stub `window.ethereum` that signs with an `ethers.Wallet` key (personal_sign of the message bytes) and returns its address; connect, tap 25 times, wait for the batch, check `#seeds` equals the server's `/me`, buy Wheel when affordable (seed the balance through the DB if needed), claim a chest after inserting a block row dated now into `blocks`, open the leaders tab; check 390 px and 1280 px with no console errors and screenshots into `docs/screens/`. Fix what the screenshots show (the hamster must sit on the bedding and read as a hamster; the wheel must be centred in the cage).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "Add the pixel art and the game site"`.

---

### Task 6: Hosting files and docs

**Files:** Create `deploy/wheelmates.service`, `deploy/Caddyfile`, `deploy/deploy.sh`, `README.md`, `docs/IMD_JOB.md`.

- [ ] **Step 1: Write them**

**File:** `deploy/wheelmates.service`
```ini
[Unit]
Description=Wheelmates game server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wheelmates
WorkingDirectory=/opt/wheelmates/server
Environment=NODE_ENV=production
Environment=PORT=8790
Environment=HOST=127.0.0.1
Environment=WHEELMATES_DB=/var/lib/wheelmates/wheelmates.sqlite
Environment=WHEELMATES_ORIGINS=https://SITE_HOST
Environment=WHEELMATES_SITE=https://SITE_HOST/
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/wheelmates
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**File:** `deploy/Caddyfile`
```
api.SITE_HOST {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8790
}
```

**File:** `deploy/deploy.sh`
```bash
#!/usr/bin/env bash
# Deploys the server to the host: rsync server/, install production deps, restart the service.
# Usage: deploy/deploy.sh ubuntu@HOST   (first time: create the user, /opt/wheelmates, /var/lib/wheelmates, install the unit)
set -euo pipefail
host="${1:?usage: deploy.sh user@host}"
here="$(cd "$(dirname "$0")/.." && pwd)"
want="$(cat "$here/.nvmrc")"
have="$(ssh "$host" 'node --version' | sed 's/^v//')"
[ "${have%%.*}" = "${want%%.*}" ] || { echo "host runs Node $have, this repo wants $want"; exit 1; }
rsync -az --delete --exclude node_modules --exclude '*.sqlite*' "$here/server/" "$host:/opt/wheelmates/server/"
ssh "$host" 'cd /opt/wheelmates/server && npm ci --omit=dev && sudo systemctl restart wheelmates && sleep 1 && curl -fsS http://127.0.0.1:8790/healthz'
echo deployed
```

**File:** `docs/IMD_JOB.md`
```
# Publishing Wheelmates through IMD

The site in `web/` is static and talks to our own API (`web/config.js`). IMD hosts the static site; the server runs on
the owner's host.

On explorer.imd.fun/launch: **Website**, then start from GitHub with `https://github.com/am3en0x/wheelmates`.
Before paying, point `web/config.js` at the production API origin and commit. 0.5 IMD from the Genesis-verified
wallet.

Text for the page:

```
Host Wheelmates from this repository as it is: the static site in web/ (no build step). It is a tap game around
Squeektoshi, the real hamster whose wheel powers Squeekchain: players push a wheel for seeds; when the live hamster
runs, the wheel on screen turns at his RPM and every tap pays x2 (x3 in the zoomies); every settled Squeek block
gives active players a chest; seeds buy six cage upgrades; Squeek holders get a bonus read from the account API;
weekly leaderboards, friends and a daily streak. Sign-in is a signed message (no gas, no transaction). The game logic
runs on our own server (server/ in the repository, Node 22 and SQLite), which reads api.squeekchain.com every 5 s
(status) and 15 s (events); the site reads only that server. Testnet only, no token, no value. Checks: cd server &&
npm test (unit and API tests). Do not change the pages; publish web/ as is.
```
```

**File:** `README.md`
```markdown
# Wheelmates

Push the wheel with Squeektoshi. A tap game around the real hamster whose wheel powers
[Squeekchain](https://squeekchain.com): seeds for taps, a multiplier when he runs, chests when Squeek blocks are
found, six cage upgrades, a bonus for Squeek holders, friends, a daily streak and weekly leaderboards. Built for the
[Squeekchain Genesis Code Lane](https://squeekchain.com/genesis/code). Testnet only: seeds have no value, there is no
token and nothing is sold. Not affiliated with Squeekchain.

## How the hamster plays

| Squeektoshi | What happens in the game |
| --- | --- |
| still or off air | taps pay ×1, passive income ×1 |
| running (two readings in a row) | your wheel turns at his real RPM, taps pay ×2 (+0.1 per Sneakers level), passive ×1.5 |
| zoomies (4.5 km/h or more) | taps pay ×3 (+Sneakers), passive ×1.5 |
| a settlement completes Squeek blocks | every player seen in the last day gets a chest: 50 + half an hour of pantry + 20 strong taps |

Energy: 500 base, one tap each, back at 1 per second (more with Bedding); the server takes at most 15 taps a second.
Upgrades: Wheel (tap power), Water bottle (energy), Bedding (regen), Pantry (seeds per hour, kept 3 to 12 hours while
away), Seed stash (those hours), Sneakers (the live multiplier). Holder bonus: 10% per Squeek-equivalent (a Level 2
is 2.2), up to 50%. Daily bonus: 100 × streak up to 7. Friends: 5% of the first ten friends' taps and chests, up to
20,000 a week. Seasons are ISO weeks (Monday 00:00 UTC). The full rules, with every number, are in
[the design](docs/superpowers/specs/2026-11-09-wheelmates-design.md).

## Run it

```sh
cd server && npm install && npm test && npm start      # API on http://127.0.0.1:8790, SQLite file next to it
python -m http.server 8080 -d web                       # the site; web/config.js points at the API
python tools/art.py                                     # redraw the pixel art (Pillow)
```

Sign-in is a signed message (EIP-191) from the wallet: no gas, no transaction, no chain switch. The server verifies
it with `ethers` and issues a 30-day bearer token. Everything else is computed on the server; the browser only
reports tap counts (`count`, `clientTs`, `batchId`) every two seconds.

## Layout

- `server/src/rules.js`: pure game math (costs, stats, taps, multipliers, chests, holder bonus, streaks, referrals,
  seasons, passive income over the phase log). `phase.js`: readings and the phase machine. `poller.js`: reads
  Squeekchain, writes `phase_log` and `blocks`. `players.js`: the game, one SQLite transaction per request.
  `auth.js`: nonces and sessions. `api.js`: HTTP, CORS, rate limit. `index.js`: boot.
- `web/`: the site (canvas cage, four tabs, About). `tools/art.py`: the art. `deploy/`: systemd unit, Caddyfile,
  deploy script. `docs/`: design, plan, IMD text, screenshots.

## Hosting

`deploy/wheelmates.service` runs the API on localhost; Caddy (`deploy/Caddyfile`) fronts `api.<domain>` with HTTPS;
`deploy/deploy.sh user@host` ships `server/`. The static `web/` is hosted by IMD (see [docs/IMD_JOB.md](docs/IMD_JOB.md))
and mirrored on GitHub Pages. Node is pinned to 22.17 (`.nvmrc`).

## License

MIT. The fonts in `web/fonts/` keep the SIL Open Font License 1.1.
```

- [ ] **Step 2: Commit** — `git add -A && git commit -m "Add hosting files and the handoff docs"`.
- [ ] **Step 3: Show the owner** — publish `web/index.html` with its files as an Artifact only if the API is reachable from it (it will not be while the API is local); otherwise send the screenshots and the local URL. Push once `am3en0x/wheelmates` exists.
