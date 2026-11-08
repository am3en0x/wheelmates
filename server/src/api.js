import http from 'node:http'
import { GameError } from './players.js'

// The HTTP door: JSON in and out, CORS for the site's origins, 20 requests a second per IP, bearer sessions.
export function createServer({ auth, game, origins = [], now = Date.now, log = console }) {
  const buckets = new Map()
  function allow(ip) {
    const t = now()
    const b = buckets.get(ip) || { tokens: 20, at: t }
    b.tokens = Math.min(20, b.tokens + ((t - b.at) / 1000) * 20)
    b.at = t
    const ok = b.tokens >= 1
    if (ok) b.tokens -= 1
    buckets.set(ip, b)
    if (buckets.size > 10_000) buckets.clear()
    return ok
  }
  function send(res, status, body, extra = {}) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra })
    res.end(JSON.stringify(body))
  }
  function cors(req, res) {
    const o = req.headers.origin
    if (!o || !(origins.includes(o) || origins.includes('*'))) return
    res.setHeader('access-control-allow-origin', o)
    res.setHeader('vary', 'origin')
    res.setHeader('access-control-allow-headers', 'content-type, authorization')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-max-age', '600')
  }
  // The JSON body, at most 10 KB; a larger one is read to the end and refused, so the client gets an answer.
  function body(req) {
    return new Promise((resolve, reject) => {
      let s = ''
      let tooLarge = false
      req.on('data', (c) => {
        if (tooLarge) return
        s += c
        if (s.length > 10_000) {
          tooLarge = true
          s = ''
        }
      })
      req.on('end', () => {
        if (tooLarge) return reject(new GameError(413, 'too_large'))
        try {
          resolve(s ? JSON.parse(s) : {})
        } catch {
          reject(new GameError(400, 'bad_json'))
        }
      })
      req.on('error', reject)
    })
  }
  const AUTHED = new Set(['GET /me', 'POST /taps', 'POST /upgrade', 'POST /chest/claim', 'POST /daily', 'POST /name'])
  const bearer = (req) => {
    const h = req.headers.authorization || ''
    return h.startsWith('Bearer ') ? h.slice(7) : null
  }

  async function handle(req, res) {
    cors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
    if (!allow(ip)) return send(res, 429, { error: 'rate_limited' }, { 'retry-after': '1' })
    const url = new URL(req.url, 'http://x')
    const route = req.method + ' ' + url.pathname
    try {
      if (route === 'GET /live') return send(res, 200, game.liveView())
      if (route === 'GET /healthz') return send(res, 200, game.health())
      if (route === 'GET /leaderboard') return send(res, 200, game.leaderboard(url.searchParams.get('scope'), url.searchParams.get('limit')))
      if (route === 'POST /auth/nonce') {
        const b = await body(req)
        return send(res, 200, auth.nonce(String(b.address || '')))
      }
      if (route === 'POST /auth/verify') {
        const b = await body(req)
        const s = auth.verify(String(b.address || ''), String(b.signature || ''))
        game.touch(s.address, b.ref)
        return send(res, 200, s)
      }
      if (route === 'POST /auth/logout') {
        auth.logout(bearer(req))
        return send(res, 200, { ok: true })
      }
      if (!AUTHED.has(route)) return send(res, 404, { error: 'not_found' })
      const token = bearer(req)
      const address = auth.session(token)
      if (!address) return send(res, 401, { error: token ? 'session_expired' : 'unauthorized' })
      if (route === 'GET /me') {
        await game.refreshHolder(address)
        return send(res, 200, game.me(address))
      }
      if (route === 'POST /taps') {
        const b = await body(req)
        return send(res, 200, game.taps(address, { count: b.count, clientTs: Number(b.clientTs), batchId: String(b.batchId || ''), token }))
      }
      if (route === 'POST /upgrade') {
        const b = await body(req)
        return send(res, 200, game.upgrade(address, String(b.key || '')))
      }
      if (route === 'POST /chest/claim') {
        const b = await body(req)
        return send(res, 200, game.claimChest(address, { id: b.id, all: b.all === true }))
      }
      if (route === 'POST /daily') return send(res, 200, game.daily(address))
      if (route === 'POST /name') {
        const b = await body(req)
        return send(res, 200, game.setName(address, b.name))
      }
      return send(res, 404, { error: 'not_found' })
    } catch (e) {
      if (e instanceof GameError) return send(res, e.status, { error: e.code, ...(e.detail ? { detail: e.detail } : {}) }, e.status === 429 ? { 'retry-after': '1' } : {})
      log.error('api', e)
      return send(res, 500, { error: 'internal' })
    }
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      log.error('api', e)
      try { send(res, 500, { error: 'internal' }) } catch {}
    })
  })
}
