import { api } from './api.js'

// Connect: ask the wallet for an account, fetch a nonce, sign the plain message, get a session. No chain switch.
export async function connect(ref) {
  const eth = window.ethereum
  if (!eth) throw { code: 'no_wallet' }
  const [account] = await eth.request({ method: 'eth_requestAccounts' })
  const { message } = await api.call('/auth/nonce', { method: 'POST', body: { address: account } })
  const hex = '0x' + Array.from(new TextEncoder().encode(message)).map((b) => b.toString(16).padStart(2, '0')).join('')
  const signature = await eth.request({ method: 'personal_sign', params: [hex, account] })
  const s = await api.call('/auth/verify', { method: 'POST', body: { address: account, signature, ref } })
  api.setToken(s.token)
  return s
}

export async function disconnect() {
  try { await api.call('/auth/logout', { method: 'POST' }) } catch {}
  api.setToken(null)
}

export const short = (a) => (!a ? '' : a.startsWith('guest-') ? 'Guest ' + a.slice(6, 10) : a.slice(0, 6) + '…' + a.slice(-4))

// A guest session: an id instead of a wallet, nothing to sign. Linking a wallet later keeps the progress.
export async function playAsGuest(ref) {
  const s = await api.call('/auth/guest', { method: 'POST', body: { ref } })
  api.setToken(s.token)
  return s
}
