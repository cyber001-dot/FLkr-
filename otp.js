/**
 * utils/otp.js — OTP generation, hashing, and verification.
 *
 * Codes are 6 digits, valid for 5 minutes, single-use.
 * Only the SHA-256 hash is persisted; the plaintext is sent by email
 * and never touches the DB.
 */
const crypto = require('crypto');
const { db, hashSecret } = require('../db');

const TTL_SECONDS = 5 * 60;

function generateCode() {
  // Cryptographically secure 6-digit code, zero-padded.
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, '0');
}

function issueOtp(email) {
  const code = generateCode();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;
  db.prepare(
    'INSERT INTO otp_codes (email, code_hash, expires_at) VALUES (?, ?, ?)'
  ).run(email, hashSecret(code), expiresAt);
  return { code, expiresAt };
}

/**
 * Verify a code. Returns true on success and marks the code consumed.
 * On failure returns an object explaining why (so we can log it).
 */
function verifyOtp(email, code) {
  const row = db.prepare(`
    SELECT id, expires_at, consumed
    FROM otp_codes
    WHERE email = ? AND code_hash = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(email, hashSecret(code || ''));

  if (!row)            return { ok: false, reason: 'unknown_code' };
  if (row.consumed)    return { ok: false, reason: 'already_used' };
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at < now) return { ok: false, reason: 'expired' };

  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').run(row.id);
  return { ok: true };
}

module.exports = { issueOtp, verifyOtp, TTL_SECONDS };
