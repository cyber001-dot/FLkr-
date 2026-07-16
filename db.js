/**
 * db.js — SQLite setup for flkr.
 *
 * Tables:
 *   - admins           (id, email, pass_hash, role, created_at)
 *   - facts            (id, text, category, source_url, image_seed, verified, created_at)
 *   - ads              (id, sponsor, headline, body, cta_url, image_seed, status, created_at)
 *   - otp_codes        (id, email, code_hash, expires_at, consumed, created_at)
 *   - login_attempts   (id, ip, email, success, created_at)  — for lockout + audit
 *   - audit_log        (id, level, actor, action, meta_json, created_at)
 *
 * Indexes are explicitly created for hot query paths.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'flkr.sqlite');

// Ensure parent dir exists.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');   // Better concurrent read performance.
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL'); // Safe + fast.

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'admin',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS facts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  category    TEXT NOT NULL,
  source_url  TEXT,
  image_seed  TEXT,
  verified    INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS ads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sponsor     TEXT NOT NULL,
  headline    TEXT NOT NULL,
  body        TEXT,
  cta_url     TEXT NOT NULL,
  image_seed  TEXT,
  status      TEXT NOT NULL DEFAULT('active'),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ip          TEXT,
  email       TEXT,
  success     INTEGER NOT NULL,
  reason      TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  level       TEXT NOT NULL,         -- 'info' | 'warn' | 'error'
  actor       TEXT,                  -- email or ip
  action      TEXT NOT NULL,
  meta_json   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

// ---------- Explicit indexes (hot paths) ----------
db.exec(`
-- facts: filter by category, sort by created_at
CREATE INDEX IF NOT EXISTS idx_facts_category_created
  ON facts(category, created_at DESC);

-- facts: skip unverified rows quickly
CREATE INDEX IF NOT EXISTS idx_facts_verified
  ON facts(verified) WHERE verified = 1;

-- ads: status filtering on every feed render
CREATE INDEX IF NOT EXISTS idx_ads_status_created
  ON ads(status, created_at DESC);

-- otp_codes: lookup by email + validity
CREATE INDEX IF NOT EXISTS idx_otp_email_expires
  ON otp_codes(email, expires_at, consumed);

-- login_attempts: lockout check by ip+email within recent window
CREATE INDEX IF NOT EXISTS idx_login_ip_created
  ON login_attempts(ip, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_email_created
  ON login_attempts(email, created_at DESC);

-- audit_log: time-bounded queries
CREATE INDEX IF NOT EXISTS idx_audit_created
  ON audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_level_created
  ON audit_log(level, created_at DESC);
`);

// ---------- Helpers ----------
function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

const ADMIN_EMAIL = process.env.OTP_RECIPIENT || 'wisdomobialo22@gmail.com';
const ADMIN_PASS  = process.env.ADMIN_FALLBACK_PASSWORD || 'flkr2026';

// Seed the single admin row if absent.
const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(ADMIN_EMAIL);
if (!existing) {
  db.prepare(
    'INSERT INTO admins (email, pass_hash, role) VALUES (?, ?, ?)'
  ).run(ADMIN_EMAIL, hashSecret(ADMIN_PASS), 'admin');
  console.log('[db] seeded admin:', ADMIN_EMAIL);
}

module.exports = {
  db,
  hashSecret,
  ADMIN_EMAIL,
};
