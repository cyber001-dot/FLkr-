/**
 * seed.js — Seed the SQLite DB with the same 1000 facts + 5 ads
 * that ship in the frontend's static dataset. This makes the backend
 * independently useful (e.g., for an admin who wants to query the DB
 * directly).
 *
 * Run:  node seed.js
 */
require('dotenv').config();
const { db } = require('./db');

// Shim `window` so the static datasets (which use `window.FLKR_FACTS = [...]`)
// can be required from Node. Same trick the link-checker uses.
global.window = {};
require('../frontend/data/facts');
require('../frontend/data/ads');

// Pull the canonical datasets.
const FACTS = global.window.FLKR_FACTS;
const ADS   = global.window.FLKR_ADS;

// Wipe + reseed (idempotent). Drop facts/ads only — keep admins/audit.
db.prepare('DELETE FROM facts').run();
db.prepare('DELETE FROM ads').run();

const insertFact = db.prepare(`
  INSERT INTO facts (text, category, source_url, image_seed, verified, created_at)
  VALUES (?, ?, ?, ?, 1, ?)
`);

const insertAd = db.prepare(`
  INSERT INTO ads (sponsor, headline, body, cta_url, image_seed, status, created_at)
  VALUES (?, ?, ?, ?, ?, 'active', ?)
`);

const now = Math.floor(Date.now() / 1000);

const tx = db.transaction(() => {
  for (let i = 0; i < FACTS.length; i++) {
    const f = FACTS[i];
    insertFact.run(f.text, f.category, f.sourceUrl || null, f.imageSeed || null, now - i);
  }
  for (let i = 0; i < ADS.length; i++) {
    const a = ADS[i];
    insertAd.run(a.sponsor, a.headline, a.body || null, a.ctaUrl, a.imageSeed, now - i);
  }
});
tx();

// eslint-disable-next-line no-console
console.log(`[seed] inserted ${FACTS.length} facts + ${ADS.length} ads`);
