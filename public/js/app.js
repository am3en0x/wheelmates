import { api } from './api.js'
import { connect, disconnect, playAsGuest, short } from './wallet.js'
import { createCage } from './cage.js'

const $ = (id) => document.getElementById(id)
const fmt = (n) => Math.floor(n).toLocaleString('en-US')
const NAMES = { wheel: 'Wheel', bottle: 'Water bottle', bedding: 'Bedding', pantry: 'Pantry', stash: 'Seed stash', sneakers: 'Sneakers' }
// display-only mirror of the server's stats per level, to show "now → next"
const pantryAt = (n) => { let s = 0; for (let i = 1; i <= n; i++) s += Math.round(40 * 1.18 ** (i - 1)); return s }
const EFFECT = {
  wheel: (n) => ['Tap power', 1 + n],
  bottle: (n) => ['Energy', 500 + 100 * n],
  bedding: (n) => ['Regen per second', 1 + 0.25 * n],
  pantry: (n) => ['Seeds per hour', pantryAt(n)],
  stash: (n) => ['Hours kept while away', 3 + n],
  sneakers: (n) => ['Bonus when he runs', '+' + (n / 10).toFixed(1)],
}

const cage = createCage($('cage'))
let me = null
let live = { phase: 'offair', rpm: 0, multiplier: 1 }
let pending = 0
let shownSeeds = 0
let shownEnergy = 0
let energyAt = performance.now()
const ref = new URLSearchParams(location.search).get('ref') || undefined
const desktop = () => matchMedia('(min-width: 960px)').matches
const mult = () => (me ? me.live.multiplier : live.multiplier)

// ---------------------------------------------------------------- live hamster
async function pollLive() {
  try {
    live = await api.call('/live')
  } catch {
    live = { ...live, phase: 'offair', rpm: 0, multiplier: 1 }
  }
  if (me) me.live = { ...me.live, ...live, multiplier: live.phase === 'running' || live.phase === 'zoomies' ? Math.round((live.multiplier + (me.sneakers || 0)) * 100) / 100 : 1 }
  const hot = live.phase === 'running' || live.phase === 'zoomies'
  $('live').className = 'live ' + live.phase
  $('liveText').textContent = { offair: 'Squeektoshi is off air', still: 'Squeektoshi is napping', running: 'Squeektoshi is running', zoomies: 'Zoomies!' }[live.phase] || 'Tuning in'
  const km = live.todayKm > 0 ? `${live.todayKm.toFixed(2)} km today · ` : ''
  $('liveSub').textContent = hot ? `${live.speedKmh.toFixed(1)} km/h · ${km}taps pay ×${mult()}` : live.phase === 'offair' ? 'Squeekchain is quiet' : `${km}when he runs, taps pay ×2`
  $('liveMult').textContent = '×' + mult()
  $('banner').hidden = !hot
  $('banner').textContent = hot ? `He is running · taps pay ×${mult()}` : ''
  cage.setLive(live)
  drawMiniWheel()
}

let miniAngle = 0
function drawMiniWheel() {
  const c = $('liveWheel')
  const ctx = c.getContext('2d')
  c.width = c.height = 30
  ctx.clearRect(0, 0, 30, 30)
  ctx.strokeStyle = '#8b8798'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(15, 15, 12, 0, 6.2832); ctx.stroke()
  ctx.strokeStyle = live.rpm > 0 ? '#f6f2ea' : '#4a4652'
  for (let s = 0; s < 3; s++) {
    const a = ((s * 120 + miniAngle) * Math.PI) / 180
    ctx.beginPath(); ctx.moveTo(15, 15); ctx.lineTo(15 + 10 * Math.cos(a), 15 + 10 * Math.sin(a)); ctx.stroke()
  }
}
setInterval(() => { if (live.rpm > 0) { miniAngle = (miniAngle + live.rpm * 0.6) % 360; drawMiniWheel() } }, 100)

// ---------------------------------------------------------------- the player
const isGuest = () => Boolean(me) && me.address.startsWith('guest-')
const weekLine = () => `<b>${fmt(me.seasonSeeds)}</b> this week · #${me.rank.season}${me.holderBonus ? ` · Squeek holder +${Math.round(me.holderBonus * 100)}%` : isGuest() ? ' · <span class="guest-note">guest: link a wallet to keep it</span>' : ''}`

function render() {
  const signed = Boolean(me)
  $('connect').className = 'btn small' + (signed && !isGuest() ? ' addr' : '')
  $('connect').innerHTML = !signed ? 'Connect<span class="wide">&nbsp;wallet</span>' : isGuest() ? 'Link<span class="wide">&nbsp;wallet</span>' : short(me.address)
  $('signout').hidden = !signed
  $('start').hidden = signed
  $('guest').hidden = signed
  $('daily').hidden = !signed || !me.dailyClaimable
  if (signed) $('daily').textContent = `Daily bonus · +${fmt(me.dailyReward)}` + (me.streak ? ` · streak ${me.streak}` : '')
  const chests = signed ? me.chests : []
  $('chestBtn').hidden = !chests.length
  cage.setChests(chests.length)
  if (chests.length) $('chestText').innerHTML = `Open ${chests.length} chest${chests.length > 1 ? 's' : ''} <b>+${fmt(chests.reduce((a, c) => a + c.seeds, 0))}</b>`
  shownSeeds = signed ? me.seeds : 0
  shownEnergy = signed ? me.energy : 500
  energyAt = performance.now()
  $('seeds').textContent = fmt(shownSeeds)
  $('balance').textContent = fmt(shownSeeds)
  $('week').innerHTML = signed ? weekLine() : 'Connect a wallet or play as a guest'
  $('liveMult').textContent = '×' + mult()
  renderUpgrades()
  renderFriends()
  if (document.querySelector('#tab-leaders.on')) loadLeaders(document.querySelector('.seg button.on').dataset.scope)
}

function tickEnergy() {
  const max = me ? me.energyMax : 500
  const regen = me ? me.regenPerSec : 1
  const e = Math.min(max, shownEnergy + (regen * (performance.now() - energyAt)) / 1000)
  $('energyFill').style.width = (100 * e) / max + '%'
  $('energyText').textContent = `${Math.floor(e)} / ${max}`
}
setInterval(tickEnergy, 250)

function renderUpgrades() {
  const box = $('upgrades')
  box.textContent = ''
  if (!me) { box.innerHTML = '<p class="empty">Connect your wallet to build the cage.</p>'; return }
  for (const key of Object.keys(NAMES)) {
    const level = me.upgrades[key] || 0
    const cost = me.costs[key]
    const [what, now] = EFFECT[key](level)
    const [, next] = EFFECT[key](level + 1)
    const can = cost !== null && me.seeds >= cost
    const card = document.createElement('div')
    card.className = 'item'
    card.innerHTML = `<img class="px" src="img/icon-${key}.png" alt=""><div><h3>${NAMES[key]}<small>Lv ${level}</small></h3><div class="effect">${what} <b>${now}</b>${cost === null ? '' : ` → <span class="next">${next}</span>`}</div></div>
      <button class="btn ${can ? 'solid' : ''}" data-key="${key}" ${can ? '' : 'disabled'}>${cost === null ? 'Max' : `<span class="cost"><img class="px" src="img/seed.png" alt="">${fmt(cost)}</span>${can ? '' : `<span class="need">need ${fmt(cost - me.seeds)} more</span>`}`}</button>`
    box.append(card)
  }
}

function renderFriends() {
  if (!me) { $('friends').innerHTML = '<p class="empty">Connect your wallet to get your invite link.</p>'; return }
  const list = me.referral.friends.map((f) => `<tr><td>${f.name || short(f.address)}</td><td class="r">${f.counts ? '5%' : '—'}</td></tr>`).join('')
  $('friends').innerHTML = `<div class="card"><div class="label">Your invite link</div><div class="copy"><input readonly value="${me.referral.link}" aria-label="Invite link"><button class="btn small" id="copyRef">Copy</button></div>
    <p class="empty" style="text-align:left;padding:10px 0 0">You get 5% of what your first ten friends earn from taps and chests, up to 20,000 seeds a week. They lose nothing.</p></div>
    <div class="card"><div class="label">Friends · earned ${fmt(me.referral.earned)}</div><table><tbody>${list || '<tr><td class="empty">Nobody yet.</td></tr>'}</tbody></table></div>`
  $('copyRef').onclick = async () => { try { await navigator.clipboard.writeText(me.referral.link); $('copyRef').textContent = 'Copied' } catch { $('copyRef').textContent = 'Select' } }
}

async function loadLeaders(scope) {
  const data = await api.call('/leaderboard?scope=' + scope)
  $('leadersTitle').textContent = scope === 'all' ? 'All time' : data.season
  $('leaders').innerHTML = `<table><thead><tr><th>#</th><th>Player</th><th class="r">Seeds</th></tr></thead><tbody>${data.rows
    .map((r) => `<tr class="${me && r.address === me.address ? 'me' : ''}"><td>${r.rank}</td><td>${r.name || short(r.address)}${r.holder ? ' ·' : ''}</td><td class="r num">${fmt(r.seeds)}</td></tr>`)
    .join('') || '<tr><td colspan="3" class="empty">Nobody yet. Be the first.</td></tr>'}</tbody></table>`
}

// ---------------------------------------------------------------- taps
function onTap(e) {
  if (!me) { say('Connect a wallet or play as a guest to start.'); return }
  const now = performance.now()
  const energy = Math.min(me.energyMax, shownEnergy + (me.regenPerSec * (now - energyAt)) / 1000)
  if (energy < 1) { say('Out of energy: it comes back one a second.'); return }
  shownEnergy = energy - 1
  energyAt = now
  const hot = me.live.multiplier > 1
  const gain = Math.floor(me.tapPower * me.live.multiplier * (1 + me.holderBonus))
  pending += 1
  shownSeeds += gain
  $('seeds').textContent = fmt(shownSeeds)
  $('seedsBox').classList.add('bump')
  setTimeout(() => $('seedsBox').classList.remove('bump'), 120)
  const r = $('cage').getBoundingClientRect()
  cage.tap(((e.clientX - r.left) / r.width) * 360, ((e.clientY - r.top) / r.height) * 360, gain, hot)
}
$('cage').addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(e) })

async function flush() {
  if (!me || pending === 0) return
  const count = Math.min(60, pending)
  pending -= count
  try {
    const r = await api.call('/taps', { method: 'POST', body: { count, clientTs: Date.now(), batchId: crypto.randomUUID() } })
    shownSeeds = r.total + pending * Math.floor(me.tapPower * me.live.multiplier * (1 + me.holderBonus))
    shownEnergy = r.energy - pending
    energyAt = performance.now()
    me.seeds = r.total
    me.seasonSeeds = r.seasonSeeds
    me.live.multiplier = r.multiplier
    $('seeds').textContent = fmt(shownSeeds)
    $('balance').textContent = fmt(me.seeds)
    $('week').innerHTML = weekLine()
    renderUpgrades()
  } catch (err) {
    if (err.code === 'stale_session') await refresh()
    else if (err.code === 'too_fast') pending += count
    else if (err.status === 401) { me = null; render(); say('Session ended. Connect again.', 'bad') }
  }
}
setInterval(flush, 2000)
document.addEventListener('visibilitychange', () => { if (document.hidden) flush() })

// ---------------------------------------------------------------- actions
function say(text, kind = '') { const m = $('msg'); m.textContent = text; m.className = 'msg ' + kind }

async function refresh() {
  if (!api.token()) { me = null; render(); return }
  try { me = await api.call('/me') } catch (e) { me = null; if (e.code !== 'offline') api.setToken(null) }
  render()
}

async function signIn() {
  try {
    const wasGuest = isGuest()
    const s = await connect(ref)
    await refresh()
    say(wasGuest ? (s.adopted ? 'Wallet linked. Your seeds came along.' : 'Wallet linked. It already had its own cage, so that one is yours now.') : 'Connected. Tap the cage.', 'good')
  } catch (e) {
    say(e.code === 'no_wallet' ? 'No wallet found. Install MetaMask, open this page in a wallet browser, or play as a guest.' : e.code === 4001 || e.code === 'ACTION_REJECTED' ? 'Signature cancelled.' : 'Could not sign in: ' + (e.code || e.message || e), 'bad')
  }
}
$('connect').onclick = () => { if (!me || isGuest()) signIn() }
$('start').onclick = signIn
$('guest').onclick = async () => {
  try {
    await playAsGuest(ref)
    await refresh()
    say('Playing as a guest. Tap the cage. Link a wallet any time to keep your seeds.', 'good')
  } catch (e) {
    say('Could not start: ' + (e.code || e.message || e), 'bad')
  }
}
$('signout').onclick = async () => { await disconnect(); me = null; render() }
$('daily').onclick = async () => { try { me = await api.call('/daily', { method: 'POST' }); render(); say(`Daily bonus taken. Streak ${me.streak}.`, 'good') } catch { say('Already taken today.', 'bad') } }
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

// tabs: on phones one section at a time; on desktop the cage stays and the right column switches
function showTab(name) {
  if (desktop() && name === 'cage') name = 'upgrades'
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name))
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name))
  if (name === 'leaders') loadLeaders(document.querySelector('.seg button.on').dataset.scope)
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => showTab(b.dataset.tab)
for (const b of document.querySelectorAll('.seg button')) b.onclick = () => { document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b)); loadLeaders(b.dataset.scope) }
matchMedia('(min-width: 960px)').addEventListener('change', () => showTab(document.querySelector('.tabs button.on').dataset.tab))
if (desktop()) showTab('upgrades')

// ---------------------------------------------------------------- boot
pollLive()
setInterval(pollLive, 5000)
refresh()
setInterval(refresh, 10 * 60e3)
if (window.ethereum) window.ethereum.on?.('accountsChanged', () => { api.setToken(null); me = null; render() })
