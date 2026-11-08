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
    if (wheel.complete) ctx.drawImage(wheel, 116, 74, 128, 128)
    const ham = spinning ? IMG.run[Math.floor(now / (spinning && state.rpm > 60 ? 70 : 110)) % 4] : IMG.nap
    if (ham.complete) ctx.drawImage(ham, spinning ? 148 : 60, spinning ? 142 : 176, 64, 48)
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
