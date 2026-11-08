// The server. One token in localStorage; every error is {status, code, detail}.
const KEY = 'wm.token'
export const api = {
  token: () => { try { return localStorage.getItem(KEY) } catch { return null } },
  setToken(t) { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY) } catch {} },
  async call(path, { method = 'GET', body } = {}) {
    const headers = { 'content-type': 'application/json' }
    const token = api.token()
    if (token) headers.authorization = 'Bearer ' + token
    let res
    try {
      res = await fetch(window.WM.api + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    } catch {
      throw { status: 0, code: 'offline' }
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401) api.setToken(null)
      throw { status: res.status, code: json.error || 'error', detail: json.detail }
    }
    return json
  },
}
