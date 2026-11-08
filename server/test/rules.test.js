import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as R from '../src/rules.js'

test('upgrade costs match the spec table', () => {
  assert.equal(R.UPGRADES.wheel.cost(1), 30)
  assert.equal(R.UPGRADES.wheel.cost(16), 2162)
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
