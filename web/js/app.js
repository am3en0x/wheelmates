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
  $('connect').innerHTML = signed ? short(me.address) : 'Connect<span class="wide">&nbsp;wallet</span>'
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
