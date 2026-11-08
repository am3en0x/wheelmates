// The cage on a square canvas: the drum wheel on its stand spins with the real hamster and with every tap, the hamster
// runs inside it or naps on the bedding, chests sit on the floor, and every tap pops a gold number. Logical size
// 360 x 360, drawn pixelated (the art is 2x).
const W = 360
const H = 360
const FLOOR_Y = 304 // top of the bedding in logical pixels
const load = (name) => { const im = new Image(); im.src = `img/${name}.png`; return im }
const IMG = {
  cage: load('cage'),
  wheel: Array.from({ length: 12 }, (_, i) => load(`wheel-${i}`)),
  run: Array.from({ length: 4 }, (_, i) => load(`hamster-run-${i}`)),
  nap: load('hamster-nap'),
  seed: load('seed'),
  chest: load('chest'),
}
const WHEEL = { x: 84, y: FLOOR_Y - 216, w: 192, h: 224, cx: 84 + 95, cy: FLOOR_Y - 216 + 95 }

export function createCage(canvas) {
  const ctx = canvas.getContext('2d')
  canvas.width = W
  canvas.height = H
  const state = { angle: 0, rpm: 0, kick: 0, running: false, chests: 0, floats: [], press: 0, last: performance.now() }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches

  function frame(now) {
    const dt = Math.min(0.1, (now - state.last) / 1000)
    state.last = now
    // degrees per second: the hamster's real rpm plus the player's pushes, which wind down
    const degPerSec = state.rpm * 6 + state.kick
    state.kick = Math.max(0, state.kick - state.kick * 2.4 * dt - 30 * dt)
    state.press = Math.max(0, state.press - dt * 6)
    if (!still) state.angle = (state.angle + degPerSec * dt) % 360
    draw(now)
    requestAnimationFrame(frame)
  }

  function draw(now) {
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, W, H)
    if (IMG.cage.complete) ctx.drawImage(IMG.cage, 0, 0, W, H)
    const spinning = state.rpm > 0 || state.kick > 20
    // the wheel: twelve frames cover the 120 degrees between the three spokes
    const idx = Math.floor(((state.angle % 120) / 120) * 12) % 12
    const wheel = IMG.wheel[idx]
    const squash = 1 - state.press * 0.03
    if (wheel.complete) ctx.drawImage(wheel, WHEEL.x + (WHEEL.w * (1 - squash)) / 2, WHEEL.y + WHEEL.h * (1 - squash), WHEEL.w * squash, WHEEL.h * squash)
    // the hamster: inside the drum while it turns, on the bedding otherwise
    const fast = state.rpm > 60 || state.kick > 300
    if (spinning) {
      const ham = IMG.run[Math.floor(now / (fast ? 60 : 100)) % 4]
      if (ham.complete) ctx.drawImage(ham, WHEEL.cx - 46, WHEEL.cy + 2, 96, 72)
    } else if (IMG.nap.complete) {
      ctx.drawImage(IMG.nap, 22, FLOOR_Y - 62, 96, 72)
    }
    // chests on the floor, up to three drawn, with a slow bob
    if (state.chests > 0 && IMG.chest.complete) {
      const bob = Math.round(Math.sin(now / 350)) * 2
      for (let i = 0; i < Math.min(3, state.chests); i++) ctx.drawImage(IMG.chest, 286 - i * 18, FLOOR_Y - 40 + bob + i * 2, 56, 44)
    }
    // floating numbers
    state.floats = state.floats.filter((f) => now - f.at < 800)
    ctx.textAlign = 'center'
    ctx.lineJoin = 'round'
    for (const f of state.floats) {
      const k = (now - f.at) / 800
      const y = f.y - 20 - k * 80
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
      ctx.font = `700 ${f.hot ? 46 : 40}px "Barlow Condensed", sans-serif`
      ctx.lineWidth = 6
      ctx.strokeStyle = '#120d05'
      ctx.strokeText('+' + f.n, f.x, y)
      ctx.fillStyle = f.hot ? '#ffd166' : '#f6a63b'
      ctx.fillText('+' + f.n, f.x, y)
      if (IMG.seed.complete) ctx.drawImage(IMG.seed, f.x + 28 + (f.hot ? 6 : 0), y - 26, 24, 24)
    }
    ctx.globalAlpha = 1
  }

  requestAnimationFrame(frame)
  return {
    setLive({ rpm, phase }) {
      state.rpm = rpm || 0
      state.running = phase === 'running' || phase === 'zoomies'
    },
    setChests(n) { state.chests = n },
    tap(x, y, n, hot) {
      state.kick = Math.min(1100, state.kick + 170)
      state.press = 1
      state.floats.push({ x: Math.max(44, Math.min(W - 44, x)), y: Math.max(60, Math.min(H - 30, y)), n, hot, at: performance.now() })
    },
  }
}
