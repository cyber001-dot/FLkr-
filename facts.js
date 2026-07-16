/**
 * routes/facts.js — Facts CRUD (admin-only writes; reads open to feed).
 */
const express = require('express');
const { db } = require('../db');
const { validate, factSchema } = require('../middleware/validate');
const { requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /facts?category=&limit=&offset=
 * Public: returns verified facts, newest first.
 */
router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const category = String(req.query.category || '').trim();

  let rows;
  if (category && category.toLowerCase() !== 'all') {
    rows = db.prepare(`
      SELECT id, text, category, source_url, image_seed, verified, created_at
      FROM facts
      WHERE verified = 1 AND category = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(category, limit, offset);
  } else {
    rows = db.prepare(`
      SELECT id, text, category, source_url, image_seed, verified, created_at
      FROM facts
      WHERE verified = 1
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }
  res.json({ facts: rows });
});

/**
 * GET /facts/categories
 */
router.get('/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT category, COUNT(*) AS n
    FROM facts WHERE verified = 1
    GROUP BY category ORDER BY n DESC
  `).all();
  res.json({ categories: rows });
});

/**
 * POST /facts — admin only
 */
router.post('/', requireAdmin, validate({ body: factSchema }), (req, res) => {
  const { text, category, source_url, image_seed, verified } = req.body;
  const info = db.prepare(`
    INSERT INTO facts (text, category, source_url, image_seed, verified)
    VALUES (?, ?, ?, ?, ?)
  `).run(text, category, source_url || null, image_seed || null, verified === false ? 0 : 1);
  logger.info(req.admin.sub, 'fact_created', { id: info.lastInsertRowid });
  res.status(201).json({ id: info.lastInsertRowid });
});

/**
 * PUT /facts/:id — admin only
 */
router.put('/:id', requireAdmin, validate({ body: factSchema }), (req, res) => {
  const id = Number(req.params.id);
  const { text, category, source_url, image_seed, verified } = req.body;
  const info = db.prepare(`
    UPDATE facts SET text=?, category=?, source_url=?, image_seed=?, verified=?
    WHERE id=?
  `).run(text, category, source_url || null, image_seed || null, verified === false ? 0 : 1, id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  logger.info(req.admin.sub, 'fact_updated', { id });
  res.json({ ok: true });
});

/**
 * DELETE /facts/:id — admin only
 */
router.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM facts WHERE id=?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  logger.info(req.admin.sub, 'fact_deleted', { id });
  res.json({ ok: true });
});

module.exports = router;
