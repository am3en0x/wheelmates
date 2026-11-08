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
