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
