import { randomBytes } from 'node:crypto'
import { isAddress, verifyMessage } from 'ethers'
import { GameError } from './players.js'

export const NONCE_TTL_MS = 10 * 60e3
export const SESSION_TTL_MS = 30 * 86400e3

// Sign-in with a plain signed message (EIP-191): no gas, no transaction, no chain. A session is a random bearer token.
export function createAuth({ db, now = Date.now }) {
  const st = {
    purge: db.prepare('DELETE FROM nonces WHERE expires_at < ?'),
    insert: db.prepare('INSERT INTO nonces (nonce, address, message, expires_at) VALUES (?, ?, ?, ?)'),
    latest: db.prepare('SELECT message FROM nonces WHERE address = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1'),
    drop: db.prepare('DELETE FROM nonces WHERE address = ?'),
    session: db.prepare('INSERT INTO sessions (token, address, expires_at, created_at) VALUES (?, ?, ?, ?)'),
    find: db.prepare('SELECT address, expires_at FROM sessions WHERE token = ?'),
    logout: db.prepare('DELETE FROM sessions WHERE token = ?'),
  }
  function nonce(address) {
    if (!isAddress(address)) throw new GameError(400, 'bad_address')
    const t = now()
    st.purge.run(t)
    const n = randomBytes(16).toString('hex')
    const message = `Wheelmates sign-in\nAddress: ${address}\nNonce: ${n}\nIssued: ${new Date(t).toISOString()}\nNo gas, no transaction. Testnet game, seeds have no value.`
    st.insert.run(n, address.toLowerCase(), message, t + NONCE_TTL_MS)
    return { nonce: n, message }
  }
  function verify(address, signature) {
    if (!isAddress(address)) throw new GameError(400, 'bad_address')
    const t = now()
    const addr = address.toLowerCase()
    const row = st.latest.get(addr, t)
    if (!row) throw new GameError(401, 'nonce_expired')
    let signer
    try {
      signer = verifyMessage(row.message, signature).toLowerCase()
    } catch {
      throw new GameError(401, 'bad_signature')
    }
    if (signer !== addr) throw new GameError(401, 'bad_signature')
    st.drop.run(addr)
    const token = randomBytes(32).toString('hex')
    st.session.run(token, addr, t + SESSION_TTL_MS, t)
    return { token, address: addr, expiresAt: t + SESSION_TTL_MS }
  }
  function session(token) {
    if (!token) return null
    const row = st.find.get(token)
    return row && row.expires_at > now() ? row.address : null
  }
  // A guest: a random id instead of an address, no signature. Linking a wallet later moves the progress over.
  function guest() {
    const t = now()
    const address = 'guest-' + randomBytes(8).toString('hex')
    const token = randomBytes(32).toString('hex')
    st.session.run(token, address, t + SESSION_TTL_MS, t)
    return { token, address, expiresAt: t + SESSION_TTL_MS, guest: true }
  }
  const isGuest = (address) => typeof address === 'string' && address.startsWith('guest-')
  return { nonce, verify, session, guest, isGuest, logout: (token) => { if (token) st.logout.run(token) } }
}
