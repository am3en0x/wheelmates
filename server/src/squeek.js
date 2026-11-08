// Squeekchain's public API, read with a timeout. A body with "status": "unavailable" is not an answer.
export function createSqueek({ base = 'https://api.squeekchain.com/v1', fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  async function get(path) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(base + path, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'wheelmates/1.0' } })
      if (res.status === 429 || res.status === 503) return { ok: false, retryAfter: Number(res.headers.get('retry-after')) || 10 }
      if (!res.ok) return { ok: false }
      const data = await res.json()
      if (data && data.status === 'unavailable') return { ok: false, unavailable: true }
      return { ok: true, data }
    } catch {
      return { ok: false }
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    status: () => get('/status'),
    events: () => get('/events?category=all&limit=40'),
    account: (address) => get('/accounts/' + address),
  }
}
