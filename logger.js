/**
 * utils/logger.js — Asynchronous audit + error logger.
 *
 * Writes are offloaded to a worker-style setImmediate queue so request
 * handlers never block on disk I/O. Failures are silently swallowed to
 * prevent a logging bug from taking the API down.
 */
const { db } = require('../db');

const queue = [];
let flushing = false;

function flush() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  try {
    const stmt = db.prepare(
      'INSERT INTO audit_log (level, actor, action, meta_json) VALUES (?, ?, ?, ?)'
    );
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        stmt.run(r.level, r.actor, r.action, r.meta_json);
      }
    });
    tx(batch);
  } catch (err) {
    // Never let logging crash the request path.
    // eslint-disable-next-line no-console
    console.error('[logger] flush failed:', err.message);
  } finally {
    flushing = false;
    if (queue.length > 0) setImmediate(flush);
  }
}

function log(level, actor, action, meta = {}) {
  queue.push({
    level,
    actor: actor || null,
    action,
    meta_json: JSON.stringify(meta).slice(0, 4000),
  });
  setImmediate(flush);
}

module.exports = {
  info:  (actor, action, meta) => log('info',  actor, action, meta),
  warn:  (actor, action, meta) => log('warn',  actor, action, meta),
  error: (actor, action, meta) => log('error', actor, action, meta),
};
