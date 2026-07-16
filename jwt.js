/**
 * utils/jwt.js — Tiny JWT implementation (no external dep).
 *
 * Uses HS256. We avoid jsonwebtoken to keep the dependency surface small
 * and to make the signing logic auditable.
 */
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS || 3600);

function base64Url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payload, ttlSeconds = TTL_SECONDS) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = base64Url(JSON.stringify(header));
  const p = base64Url(JSON.stringify(body));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // Timing-safe compare.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const body = JSON.parse(base64UrlDecode(p).toString('utf8'));
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

module.exports = { sign, verify };
