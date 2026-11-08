import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet } from 'ethers'
import { openDb } from '../src/db.js'
import { createAuth } from '../src/auth.js'
import { GameError } from '../src/players.js'

function harness() {
  const db = openDb(':memory:')
  let t = 1_700_000_000_000
  return { db, auth: createAuth({ db, now: () => t }), tick: (ms) => { t += ms } }
}
const wallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const err = (fn, code) => { try { fn(); assert.fail('expected ' + code) } catch (e) { assert.ok(e instanceof GameError, String(e)); assert.equal(e.code, code) } }

test('nonce, sign, verify, session', async () => {
  const { auth, tick } = harness()
  err(() => auth.nonce('nope'), 'bad_address')
  const { nonce, message } = auth.nonce(wallet.address)
  assert.equal(nonce.length, 32)
  assert.ok(message.startsWith('Wheelmates sign-in\nAddress: ' + wallet.address + '\nNonce: ' + nonce))
  assert.ok(message.endsWith('No gas, no transaction. Testnet game, seeds have no value.'))
  const sig = await wallet.signMessage(message)
  const s = auth.verify(wallet.address, sig)
  assert.equal(s.address, wallet.address.toLowerCase())
  assert.equal(auth.session(s.token), wallet.address.toLowerCase())
  err(() => auth.verify(wallet.address, sig), 'nonce_expired')
  tick(31 * 86400e3)
  assert.equal(auth.session(s.token), null)
})

test('wrong signer, garbage signature, expired nonce', async () => {
  const { auth, tick } = harness()
  const other = Wallet.createRandom()
  let { message } = auth.nonce(wallet.address)
  err(() => auth.verify(wallet.address, 'garbage'), 'bad_signature')
  ;({ message } = auth.nonce(wallet.address))
  const sig = await other.signMessage(message)
  err(() => auth.verify(wallet.address, sig), 'bad_signature')
  ;({ message } = auth.nonce(wallet.address))
  const good = await wallet.signMessage(message)
  tick(11 * 60e3)
  err(() => auth.verify(wallet.address, good), 'nonce_expired')
})

test('logout ends the session', async () => {
  const { auth } = harness()
  const { message } = auth.nonce(wallet.address)
  const s = auth.verify(wallet.address, await wallet.signMessage(message))
  auth.logout(s.token)
  assert.equal(auth.session(s.token), null)
})

test('a guest gets a session for a guest id, no signature needed', () => {
  const { auth } = harness()
  const g = auth.guest()
  assert.ok(/^guest-[0-9a-f]{16}$/.test(g.address))
  assert.equal(g.guest, true)
  assert.equal(auth.session(g.token), g.address)
  assert.equal(auth.isGuest(g.address), true)
  assert.equal(auth.isGuest(wallet.address.toLowerCase()), false)
})
