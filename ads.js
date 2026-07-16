/**
 * routes/ads.js — Ads CRUD (admin-only writes).
 * Reads filter on status='active' so the feed only shows live ads.
 */
const express = require('express');
const { db } = require('../db');
const { validate, adSchema } = require('../middleware/validate');
const { requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /ads — returns active ads for the feed.
 */
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, sponsor, headline, body, cta_url, image_seed, status, created_at
    FROM ads
    WHERE status = 'active'
    ORDER BY created_at DESC
  `).all();
  res.json({ ads: rows });
});

/**
 * POST /ads — admin only
 */
router.post('/', requireAdmin, validate({ body: adSchema }), (req, res) => {
  const { sponsor, headline, body, cta_url, image_seed, status } = req.body;
  const info = db.prepare(`
    INSERT INTO ads (sponsor, headline, body, cta_url, image_seed, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sponsor, headline, body || null, cta_url, image_seed || null, status || 'active');
  logger.info(req.admin.sub, 'ad_created', { id: info.lastInsertRowid, sponsor });
  res.status(201).json({ id: info.lastInsertRowid });
});

/**
 * PUT /ads/:id — admin only
 */
router.put('/:id', requireAdmin, validate({ body: adSchema }), (req, res) => {
  const id = Number(req.params.id);
  const { sponsor, headline, body, cta_url, image_seed, status } = req.body;
  const info = db.prepare(`
    UPDATE ads SET sponsor=?, headline=?, body=?, cta_url=?, image_seed=?, status=?
    WHERE id=?
  `).run(sponsor, headline, body || null, cta_url, image_seed || null, status || 'active', id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  logger.info(req.admin.sub, 'ad_updated', { id });
  res.json({ ok: true });
});

/**
 * DELETE /ads/:id — admin only
 */
router.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM ads WHERE id=?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  logger.info(req.admin.sub, 'ad_deleted', { id });
  res.json({ ok: true });
});

module.exports = router;
