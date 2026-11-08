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
