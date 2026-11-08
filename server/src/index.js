import { openDb } from './db.js'
import { createSqueek } from './squeek.js'
import { createPoller } from './poller.js'
import { createGame } from './players.js'
import { createAuth } from './auth.js'
import { createServer } from './api.js'

// Boot: one SQLite file, the poller, the game, the HTTP door on localhost (Caddy fronts it in production).
const cfg = {
  port: Number(process.env.PORT || 8790),
  host: process.env.HOST || '127.0.0.1',
  db: process.env.WHEELMATES_DB || './wheelmates.sqlite',
  origins: (process.env.WHEELMATES_ORIGINS || 'http://localhost:8080,http://127.0.0.1:8080').split(',').map((s) => s.trim()).filter(Boolean),
  site: process.env.WHEELMATES_SITE || 'http://localhost:8080/',
}
const db = openDb(cfg.db)
const squeek = createSqueek()
const poller = createPoller({ db, squeek })
const game = createGame({ db, live: poller, squeek, siteUrl: cfg.site })
const auth = createAuth({ db })
poller.start()
game.housekeeping()
setInterval(() => game.housekeeping(), 3600e3).unref()
createServer({ auth, game, origins: cfg.origins }).listen(cfg.port, cfg.host, () => {
  console.log(`wheelmates api on http://${cfg.host}:${cfg.port}, db ${cfg.db}, origins ${cfg.origins.join(' ')}`)
})
