/**
 * middleware/auth.js — JWT verification for admin routes.
 *
 * Token may be carried in `Authorization: Bearer <jwt>` or in an
 * `X-Admin-Token` header (for convenience in tests).
 */
const { verify } = require('../utils/jwt');

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const xToken = req.headers['x-admin-token'];
  const token = bearer || xToken;

  if (!token) {
    return res.status(401).json({ error: 'missing_token' });
  }

  const payload = verify(token);
  if (!payload || payload.role !== 'admin') {
    return res.status(403).json({ error: 'invalid_token' });
  }

  req.admin = payload;
  next();
}

module.exports = { requireAdmin };
