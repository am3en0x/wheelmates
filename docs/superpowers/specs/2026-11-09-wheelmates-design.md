# Wheelmates: design

Date: 2026-11-09. Status: approved in chat ("ок, оставляем"), pending written-spec review.

## Goal

A tap game built around Squeektoshi, the real hamster whose wheel powers Squeekchain: players push a wheel for seeds,
and the live hamster sets the tempo. When he runs, every player's wheel turns at his real RPM and every tap pays more;
when a Squeek block is found on chain, every active player gets a chest. Seeds buy cage upgrades. Weekly leaderboard,
friends, daily streak, a bonus for Squeek holders. Built for the Squeekchain Genesis Code Lane ("Games powered by
Squeekchain"). Testnet only: seeds have no value, nothing is sold, no token.

The game is original: its own name, art, words and mechanics. It copies no existing tapper's name, characters, cards,
combos or ciphers.

## Constraints

- Site: static `web/` (plain HTML, CSS, JS modules, no build), bundled fonts (SIL OFL). Hosted by IMD (Website from
  GitHub) and mirrored on GitHub Pages. `web/config.js` holds the API origin.
- Server: Node 22, `node:http`, `node:sqlite` (one file), `ethers` v6 for signature checks only. One systemd service on
  the owner's Ohio host behind Caddy (HTTPS). No other dependency, no framework, no external database.
- Data from Squeekchain's public API only: `GET /v1/status` every 5 s (server), `GET /v1/events?category=all&limit=40`
  every 15 s (server), `GET /v1/accounts/{address}` when a holder bonus is (re)checked. The site never calls
  Squeekchain itself; it reads the server's `/live`.
- Sign-in: the wallet signs a plain text message (EIP-191, no gas, no transaction, no chain switch). Korea-safe: no
  payouts, no token, no prizes.
- Server-authoritative: energy, seeds, upgrades, chests and multipliers are computed on the server; the client only
  reports tap counts.
- English UI; code comments in English; commits in English.

## Game rules (all numbers are the spec)

### Seeds, taps and energy

- `tapPower` seeds per tap, base 1, raised by the Wheel upgrade.
- Energy: `energyMax` base 500 (Bottle upgrade), regenerates `regenPerSec` base 1 (Bedding upgrade). Each accepted tap
  spends 1 energy. Taps beyond the energy available are dropped, not queued.
- Rate cap: the server accepts at most 15 taps per second per player, measured over the batch's window (batches every
  2 s, so 30 per batch); the rest are dropped.
- Seeds from a tap batch = `accepted × tapPower × liveMultiplier × (1 + holderBonus)`, integer, floored.

### The live hamster

The server's poller turns `/v1/status` into a phase, with the same rules as a careful reading of the wheel:

| Phase | Condition | `liveMultiplier` | Passive multiplier |
| --- | --- | --- | --- |
| `offair` | no online reading for 2 minutes | 1 | 1 |
| `still` | online, `rpmMilli == 0` | 1 | 1 |
| `running` | online, `rpmMilli > 0` on two polls in a row | 2 + sneakers | 1.5 |
| `zoomies` | running and speed ≥ 4.5 km/h on two polls in a row | 3 + sneakers | 1.5 |

Sneakers upgrade adds `+0.1 × level` to the running and zoomies multipliers (max level 10, so up to +1.0).
`GET /live` returns `{phase, rpm, speedKmh, todayKm, block, progress, multiplier, observedAt}` for the site; the site
polls it every 5 s and turns the wheel at `rpm` while `phase` is running or zoomies.

### Passive income

- `seedsPerHour` base 0 (Pantry upgrade). It accrues from `lastSeenAt` to now, capped at `offlineCapHours` (base 3,
  Stash upgrade, max 12). While the hamster ran during that window the rate is ×1.5: the server keeps a log of phase
  changes and integrates exactly.
- Accrued seeds are credited on every authenticated request (`/me`, `/taps`), then `lastSeenAt` moves.

### Upgrades (cage items)

| Key | Name | Effect per level | Max level | Cost of level n |
| --- | --- | --- | --- | --- |
| `wheel` | Wheel | `tapPower = 1 + n` | 30 | `50 × 1.35^(n-1)` |
| `bottle` | Water bottle | `energyMax = 500 + 100n` | 30 | `80 × 1.3^(n-1)` |
| `bedding` | Bedding | `regenPerSec = 1 + 0.25n` | 20 | `120 × 1.35^(n-1)` |
| `pantry` | Pantry | `seedsPerHour = 60 × n × 1.15^(n-1)` | 30 | `200 × 1.4^(n-1)` |
| `stash` | Seed stash | `offlineCapHours = 3 + n` | 9 | `500 × 1.6^(n-1)` |
| `sneakers` | Sneakers | live multiplier `+0.1n` | 10 | `1000 × 1.7^(n-1)` |

Costs are rounded to integers. Buying needs the full cost in seeds; the server checks max level and balance.

### Block chests

- When a `system.settlement_completed` event with `completedBlockCount > 0` appears (deduplicated by event id), the
  server creates a chest for every player seen in the last 24 hours: `seeds = 50 + 30 × seedsPerHour / 60 + 20 × tapPower`,
  that is a flat 50, half an hour of passive income and twenty strong taps.
- Chests expire 24 hours after creation. `/me` lists open chests with the Squeek block number; `POST /chest/claim`
  credits one.

### Holder bonus

- On sign-in and then at most every 10 minutes while active, the server reads `/v1/accounts/{address}`. For each
  Squeek in `tokens` (wallet or staking custody), `basePower / 1000` counts as Squeek-equivalents (Level 1 = 1, Level 2
  = 2.2, …). `holderBonus = min(0.5, 0.1 × Σ equivalents)`.
- An unavailable or failed read keeps the last value; never zero out a bonus because the API blinked.

### Daily streak

- One claim per UTC day, by `POST /daily`. Streak grows when the previous claim was yesterday, else resets to 1. Reward
  `100 × min(streak, 7) × (1 + holderBonus)`, so days 7 and beyond pay 700 before the bonus.

### Friends

- Every player has a referral code: the first 8 hex chars of `keccak256(address)`. Link `?ref=CODE`. On first sign-in
  with a valid `ref` of another player, the inviter is stored. The inviter earns 5% of every seed the friend earns
  from taps and chests, credited in the same transaction (not deducted from the friend). `/me` shows friends and the
  total earned from them.

### Seasons and leaderboard

- `season` = ISO week starting Monday 00:00 UTC, key `YYYY-Www`. `players.seasonSeeds` resets when a request arrives
  in a new season (the old value is archived into `season_results(season, address, seeds)`).
- `GET /leaderboard?scope=season|all&limit=100`: rank, short address (or display name if set), seeds, holder flag.
- A display name: `POST /name` with 3 to 20 characters `[A-Za-z0-9_ ]`, unique, filtered by a small bad-word list.

## Authentication

- `POST /auth/nonce {address}` → `{nonce, message}`. Message:
  ```
  Wheelmates sign-in
  Address: 0x…
  Nonce: <32 hex>
  Issued: <ISO time>
  No gas, no transaction. Testnet game, seeds have no value.
  ```
- `POST /auth/verify {address, signature}`: `ethers.verifyMessage` must return the address; the nonce is single-use
  and expires in 10 minutes. The server issues a session token (32 random bytes, hex) in `sessions(token, address,
  expiresAt = 30 days)`, returned as JSON; the client keeps it in `localStorage` and sends `Authorization: Bearer`.
- `POST /auth/logout` deletes the session.
- CORS: `Access-Control-Allow-Origin` for the site's origins (config list), credentials not used.

## API

| Method and path | Auth | Body → Response |
| --- | --- | --- |
| `GET /live` | no | the hamster's phase and numbers (above) |
| `GET /leaderboard?scope&limit` | no | `{season, rows:[{rank, address, name, seeds, holder}]}` |
| `POST /auth/nonce`, `/auth/verify`, `/auth/logout` | see above | |
| `GET /me` | yes | `{address, name, seeds, seasonSeeds, energy, energyMax, regenPerSec, tapPower, seedsPerHour, offlineCapHours, upgrades:{key: level}, costs:{key: nextCost|null}, holderBonus, holderEquivalents, streak, dailyClaimable, chests:[{id, block, seeds, expiresAt}], referral:{code, link, friends, earned}, live}` |
| `POST /taps {count, clientTs}` | yes | `{accepted, seeds, energy, seasonSeeds, multiplier}`; `count` 1..60 |
| `POST /upgrade {key}` | yes | `/me` shape, or 409 `insufficient_seeds` / `max_level` |
| `POST /chest/claim {id}` | yes | `/me` shape, or 404 |
| `POST /daily` | yes | `/me` shape, or 409 `already_claimed` |
| `POST /name {name}` | yes | `/me` shape, or 409 `name_taken` / 400 `invalid_name` |
| `GET /healthz` | no | 200 while the poller saw the API in the last 2 minutes, 503 otherwise (body says) |

Errors are `{error, detail?}` with 400/401/404/409/429. Per-IP rate limit: 20 requests per second, 429 with
`Retry-After`.

## Data (SQLite)

- `players(address PK, name, seeds, season_seeds, season, energy, energy_at, last_seen_at, created_at, inviter,
  holder_bonus, holder_equivalents, holder_checked_at, streak, daily_claimed_on)`
- `upgrades(address, key, level, PK(address,key))`
- `sessions(token PK, address, expires_at)`, `nonces(nonce PK, address, message, expires_at)`
- `chests(id PK, address, block, seeds, created_at, expires_at, claimed_at)`, `blocks_seen(event_id PK)`
- `phase_log(at, phase, multiplier)` for exact passive integration, pruned to 14 days
- `season_results(season, address, seeds, PK(season,address))`
- `referral_earnings(inviter, friend, seeds, PK(inviter,friend))`

Energy is stored as `(energy, energy_at)` and recomputed as `min(energyMax, energy + regen × elapsed)` on read.

## The site

Phone-first (390 px), also fine on desktop. Black page, one accent (amber), IBM Plex Mono for text and Barlow
Condensed for headings, pixel art for the cage.

- **Top bar**: Squeektoshi's live state (`SQUEEKTOSHI IS RUNNING ×2.3`), his today km and speed; a small live wheel
  turning at his RPM.
- **Cage** (main tab): a pixel cage with a wheel and a hamster; tapping anywhere on the cage pushes the wheel (it
  spins faster with each tap and winds down), seeds fly up as `+N`. Energy bar. Seeds total, season seeds. Open chests
  appear as a chest on the cage floor with a count.
- **Upgrades**: the six items with level, effect, next cost, buy button.
- **Friends**: referral link with copy, friends list, seeds earned.
- **Leaders**: season and all-time tables, your rank.
- **Sign-in**: "Connect wallet" (EIP-1193 `eth_requestAccounts`, then `personal_sign`), no chain switch. Before
  sign-in the cage is visible and the live wheel turns, taps show "Connect to play".
- Taps are batched every 2 s (or on tab hide) and reconciled with the server's response; the client predicts seeds
  optimistically and corrects.

Art: `tools/art.py` draws the cage, the wheel frames (8), the hamster (run frames and nap), the seed, the chest and the
six item icons into `web/img/*.png` (pixelated, 4× scale in CSS). Own drawings, not the odometer's sprites.

## Error handling

- API down: `/live` keeps the last reading with `phase: offair` after 2 minutes; multipliers fall to 1; chests pause.
- Signature invalid or nonce expired: 401 `bad_signature` / `nonce_expired`; the client asks to sign again.
- Taps over energy or rate: dropped silently, the response's `accepted` tells the client the truth.
- Session expired: 401 `session_expired`; the client clears the token and shows Connect.
- SQLite busy: WAL mode, `busy_timeout` 5 s; a failed write returns 503 and the client retries the batch once.

## Testing

- `node --test` on the server: energy regen and cap; tap batches (rate cap, energy drop, multipliers, holder bonus,
  referral 5%); upgrade costs and max levels; passive income with a phase log (×1.5 segments, offline cap); chest
  creation on a block event once per event id, expiry, claim; daily streak rules; season roll-over and archive; the
  holder bonus from a recorded `/v1/accounts` answer (Level 2 = 2.2); nonce and signature flow with a real
  `ethers.Wallet`; the poller's phase machine from recorded `/v1/status` answers; the API handlers end to end against an
  in-memory database with `fetch` stubbed.
- Site: a browser check with a stub wallet (window.ethereum that signs with a test key) against the real local server:
  connect, tap, buy an upgrade, claim a chest, leaderboard; no console errors; 390 px and 1280 px screenshots.

## Deployment

- `server/` runs as `wheelmates.service` (systemd, `Restart=always`, `Environment=WHEELMATES_DB=/var/lib/wheelmates/db.sqlite`,
  `WHEELMATES_ORIGINS=https://<site>`), port 8790 on localhost; Caddy reverse-proxies `api.<domain>` to it with
  automatic HTTPS. Deploy script: rsync `server/`, `npm ci --omit=dev`, restart. Nothing in the repo holds a secret;
  the server needs no key at all.
- The owner buys a short domain without crypto words; until then the site runs locally against `http://localhost:8790`.

## Out of scope

Tokens, payouts, in-app purchases, Telegram, push notifications, PvP, clans, chat, translations.
