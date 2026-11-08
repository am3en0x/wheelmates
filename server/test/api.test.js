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
const server = createServer({ auth, game, origins: ['http://site'], log: { error() {} }, rps: 1000 })
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

test('play as guest, then link a wallet and keep the seeds', async () => {
  const g = await call('/auth/guest', { method: 'POST', body: {} })
  assert.equal(g.status, 200)
  assert.ok(g.json.address.startsWith('guest-'))
  const token = g.json.token
  let me = await call('/me', { token })
  assert.equal(me.json.holderBonus, 0)
  const taps = await call('/taps', { method: 'POST', token, body: { count: 10, clientTs: Date.now(), batchId: 'g1' } })
  assert.equal(taps.json.accepted, 10)
  const fresh = Wallet.createRandom()
  const { json: n } = await call('/auth/nonce', { method: 'POST', body: { address: fresh.address } })
  const signature = await fresh.signMessage(n.message)
  const v = await call('/auth/verify', { method: 'POST', token, body: { address: fresh.address, signature } })
  assert.equal(v.status, 200)
  assert.equal(v.json.adopted, true)
  me = await call('/me', { token: v.json.token })
  assert.equal(me.json.address, fresh.address.toLowerCase())
  assert.equal(me.json.seeds, taps.json.total)
  assert.equal((await call('/me', { token })).status, 401)
})
