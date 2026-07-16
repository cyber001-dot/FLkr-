/**
 * server.js — flkr backend entry point.
 *
 * Wires up:
 *   - Helmet (security headers)
 *   - Compression
 *   - Strict CORS
 *   - JSON body parser (with size cap)
 *   - Async audit logger for every request
 *   - Routes: /health, /auth, /facts, /ads
 *   - Centralized error handler
 *
 * Run:  node server.js
 */
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const { corsMiddleware } = require('./middleware/cors');
const logger = require('./utils/logger');

const app = express();
const PORT = Number(process.env.PORT || 8787);

// ---- Trust proxy so req.ip is the real client IP behind a reverse proxy.
app.set('trust proxy', 1);

// ---- Security headers. CSP disabled here because we're an API; the
//      frontend is served statically by nginx/CDN in prod.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(compression());
app.use(corsMiddleware);

// Body parser — strict size limit (defeats large-payload DoS).
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// ---- Async request logger (records every request to audit_log).
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const ip = req.ip;
    const actor = req.admin ? req.admin.sub : ip;
    logger.info(actor, 'http_request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - startedAt,
    });
  });
  next();
});

// ---- Path-prefix stripping
// The platform's preview ingress may route traffic with a path prefix
// like /ws-<bot-id>/. Strip it before static + route handlers so that
// assets (styles.css, app.js, data/facts.js) resolve to real files
// instead of falling through to the SPA catch-all.
app.use((req, res, next) => {
  const prefixRegex = /^\/(?:ws-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/i;
  if (prefixRegex.test(req.path)) {
    req.url = req.url.replace(prefixRegex, '') || '/';
  }
  next();
});

// ---- Routes
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/auth', require('./routes/auth'));
app.use('/facts', require('./routes/facts'));
app.use('/ads', require('./routes/ads'));

// Static frontend. `fallthrough: true` lets the SPA catch-all handle
// any path that doesn't match a real file.
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  maxAge: '1h',
  fallthrough: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// ---- SPA catch-all
// Any non-API GET request that didn't match a static file returns
// index.html so the SPA can take over client-side.
app.get(/^\/(?!auth|facts|ads|health).*/, (req, res, next) => {
  const indexPath = path.join(__dirname, '..', 'frontend', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) next(err);
  });
});

// ---- 404 (only reached for non-GET requests to unknown paths)
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// ---- Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(req.ip, 'unhandled_error', {
    method: req.method,
    path: req.originalUrl,
    error: err.message,
    stack: err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : null,
  });
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.parse.invalid') {
    return res.status(400).json({ error: 'invalid_json' });
  }
  res.status(500).json({ error: 'internal_error' });
});

// ---- Periodic log flush check + prune
setInterval(() => {
  try {
    const { db } = require('./db');
    const cutoff = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
    db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(cutoff);
    db.prepare('DELETE FROM otp_codes WHERE expires_at < ? AND consumed = 1')
      .run(Math.floor(Date.now() / 1000));
  } catch (e) {
    // never crash on cleanup
  }
}, 60_000);

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[flkr] backend listening on :${PORT} (env=${process.env.NODE_ENV || 'dev'})`);
  });
}

module.exports = app;
