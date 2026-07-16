/**
 * middleware/cors.js — Strict CORS.
 *
 * Only origins listed in FRONTEND_ORIGINS are allowed. Preflight requests
 * are answered with 204 and explicit allowed methods/headers. Credentials
 * are supported so the admin JWT cookie can ride along.
 */
const ALLOWED = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (origin && ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Admin-Token'
    );
    res.setHeader('Access-Control-Max-Age', '600');
  } else if (origin) {
    // Origin present but not on the allowlist — explicitly refuse.
    res.setHeader('Access-Control-Allow-Origin', 'null');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
}

module.exports = { corsMiddleware, ALLOWED };
