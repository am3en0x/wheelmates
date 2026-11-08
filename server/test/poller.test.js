import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { openDb } from '../src/db.js'
import { createPoller } from '../src/poller.js'

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)))
// node:sqlite rows have a null prototype; copy them into plain objects before deepEqual
const plain = (rows) => rows.map((r) => ({ ...r }))
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
  assert.deepEqual(plain(db.prepare('SELECT phase, mult FROM phase_log').all()), [{ phase: 'offair', mult: 1 }])
  db.prepare('INSERT INTO phase_log (at, phase, mult) VALUES (?, ?, ?)').run(1_000_000 + 60_000, 'running', 1.5)
  tick(600_000)
  poller.fillGap()
  const rows = plain(db.prepare('SELECT at, phase, mult FROM phase_log ORDER BY at').all())
  assert.deepEqual(rows[rows.length - 1], { at: 1_000_000 + 65_000, phase: 'offair', mult: 1 })
})

test('status polls move the snapshot and log phase changes once', async () => {
  let answer = idle
  const { db, poller, tick } = harness({ status: () => ({ ok: true, data: answer }) })
  poller.fillGap()
  tick(1000)
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
  assert.deepEqual(plain(db.prepare('SELECT phase, mult FROM phase_log ORDER BY at').all()), [
    { phase: 'offair', mult: 1 }, { phase: 'still', mult: 1 }, { phase: 'running', mult: 1.5 },
  ])
  assert.equal(poller.snapshot().apiAt, 1_016_000)
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
  assert.deepEqual(plain(db.prepare('SELECT event_id, block, blocks, at FROM blocks').all()), [
    { event_id: 'e9', block: 2001, blocks: 2, at: Date.parse('2026-11-07T18:30:36.000Z') },
  ])
})
