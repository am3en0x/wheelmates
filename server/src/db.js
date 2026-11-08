import { DatabaseSync } from 'node:sqlite'

// One SQLite file. Times are Unix milliseconds; seeds are REAL so passive fractions survive between requests and
// are floored only for display and spending.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  address TEXT PRIMARY KEY,
  ref_code TEXT NOT NULL,
  name TEXT,
  name_changed_at INTEGER,
  seeds REAL NOT NULL DEFAULT 0,
  season_seeds REAL NOT NULL DEFAULT 0,
  season TEXT NOT NULL,
  energy REAL NOT NULL,
  energy_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  me_at INTEGER,
  last_batch_at INTEGER,
  chest_cursor INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  inviter TEXT,
  invite_rank INTEGER,
  holder_bonus REAL NOT NULL DEFAULT 0,
  holder_equivalents REAL NOT NULL DEFAULT 0,
  holder_checked_at INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  daily_claimed_on TEXT,
  referral_season_seeds REAL NOT NULL DEFAULT 0,
  referral_earned REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS players_ref ON players (ref_code);
CREATE INDEX IF NOT EXISTS players_season ON players (season, season_seeds);
CREATE INDEX IF NOT EXISTS players_seeds ON players (seeds);
CREATE INDEX IF NOT EXISTS players_inviter ON players (inviter);
CREATE TABLE IF NOT EXISTS upgrades (address TEXT NOT NULL, key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (address, key));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, address TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, address TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blocks (event_id TEXT PRIMARY KEY, block INTEGER NOT NULL, blocks INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS blocks_at ON blocks (at);
CREATE TABLE IF NOT EXISTS chests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, block INTEGER NOT NULL, seeds INTEGER NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS chests_open ON chests (address, claimed_at, expires_at);
CREATE TABLE IF NOT EXISTS tap_batches (token TEXT NOT NULL, batch_id TEXT NOT NULL, response TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (token, batch_id));
CREATE TABLE IF NOT EXISTS phase_log (at INTEGER PRIMARY KEY, phase TEXT NOT NULL, mult REAL NOT NULL);
CREATE TABLE IF NOT EXISTS season_results (season TEXT NOT NULL, address TEXT NOT NULL, seeds INTEGER NOT NULL, PRIMARY KEY (season, address));
CREATE TABLE IF NOT EXISTS referral_earnings (inviter TEXT NOT NULL, friend TEXT NOT NULL, seeds REAL NOT NULL, PRIMARY KEY (inviter, friend));
`

export function openDb(path) {
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA)
  return db
}
