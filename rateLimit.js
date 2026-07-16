/**
 * middleware/rateLimit.js — IP-based rate limiter backed by SQLite.
 *
 * We use a simple sliding-window counter per IP + per route-key. This
 * avoids the in-memory store problem (lost on restart) without pulling
 * in Redis. Cleanup runs every 60s to prune rows older than the largest
 * window.
 *
 * The exported factory returns an Express middleware bound to a specific
 * limit config.
 */
const { db } = require('../db');

db.exec(`
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  ip        TEXT NOT NULL,
  route_key TEXT NOT NULL,
  window_ms INTEGER NOT NULL,
  count     INTEGER NOT NULL DEFAULT 0,
  first_at  INTEGER NOT NULL,
  PRIMARY KEY (ip, route_key)
);
CREATE INDEX IF NOT EXISTS idx_rl_first_at ON rate_limit_buckets(first_at);
`);

let lastPrune = 0;
function pruneOld() {
  const now = Date.now();
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  // Anything older than 1 hour is irrelevant.
  const cutoff = now - 3_600_000;
  db.prepare('DELETE FROM rate_limit_buckets WHERE first_at < ?').run(cutoff);
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs
 * @param {number} opts.max
 * @param {string} opts.routeKey
 */
function makeLimiter({ windowMs, max, routeKey }) {
  return function rateLimit(req, res, next) {
    pruneOld();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const row = db.prepare(
      'SELECT count, first_at FROM rate_limit_buckets WHERE ip = ? AND route_key = ?'
    ).get(ip, routeKey);

    let count, firstAt;
    if (!row || now - row.first_at > windowMs) {
      count = 1;
      firstAt = now;
      db.prepare(`
        INSERT INTO rate_limit_buckets (ip, route_key, window_ms, count, first_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ip, route_key) DO UPDATE SET
          count = excluded.count,
          first_at = excluded.first_at
      `).run(ip, routeKey, windowMs, count, firstAt);
    } else {
      count = row.count + 1;
      firstAt = row.first_at;
      db.prepare(
        'UPDATE rate_limit_buckets SET count = ? WHERE ip = ? AND route_key = ?'
      ).run(count, ip, routeKey);
    }

    const resetAt = firstAt + windowMs;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (count > max) {
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'too_many_requests',
        retryAfter,
      });
    }
    next();
  };
}

module.exports = { makeLimiter };
