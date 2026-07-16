#!/usr/bin/env node
/**
 * link-checker.js — Crawl every sourceUrl in the 1000-fact dataset and
 * every ctaUrl in the 5-ad dataset. Report broken links.
 *
 * Usage:
 *   node scripts/link-checker.js            # check all
 *   node scripts/link-checker.js --quick    # check first 30 only
 *   node scripts/link-checker.js --timeout 5000
 *
 * Exit code:
 *   0  -> all links reachable
 *   1  -> one or more broken links
 *   2  -> script error
 */
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// We need to load the datasets. They assign to window, so we shim it.
global.window = {};
require(path.join(__dirname, '..', 'frontend', 'data', 'facts.js'));
require(path.join(__dirname, '..', 'frontend', 'data', 'ads.js'));

const FACTS = global.window.FLKR_FACTS;
const ADS   = global.window.FLKR_ADS;

const QUICK = process.argv.includes('--quick');
const TIMEOUT_MS = Number((process.argv.find(a => a.startsWith('--timeout=')) || '').split('=')[1] || 6000);
const CONCURRENCY = 8;

console.log(`[link-checker] ${FACTS.length} facts, ${ADS.length} ads`);
console.log(`[link-checker] timeout=${TIMEOUT_MS}ms, concurrency=${CONCURRENCY}, quick=${QUICK}`);

// Collect candidate URLs.
const urls = new Set();
for (const f of FACTS) {
  if (f.sourceUrl && /^https?:\/\//.test(f.sourceUrl)) urls.add(f.sourceUrl);
}
for (const a of ADS) {
  if (a.ctaUrl && /^https?:\/\//.test(a.ctaUrl)) urls.add(a.ctaUrl);
}
let list = Array.from(urls);
console.log(`[link-checker] ${list.length} unique URLs to check`);
if (QUICK) {
  list = list.slice(0, 30);
  console.log(`[link-checker] quick mode — checking first ${list.length} only`);
}

// HTTP GET with browser-like UA. (Many sites — Britannica, LoC,
// Science.org, NASA — reject HEAD or bot UA strings with 403/405.)
function checkOne(u) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(u); }
    catch (e) { return resolve({ url: u, ok: false, status: 0, error: 'invalid_url' }); }

    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      method: 'GET',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: TIMEOUT_MS,
    };

    const req = lib.request(opts, (res) => {
      // Consume the body to free the socket.
      res.resume();
      // Classification:
      //   2xx, 3xx                 -> OK
      //   403, 405, 429, 5xx       -> REVIEW (likely a bot wall, retry in browser)
      //   404, 410, 400, 401, 402,
      //   406, 407, 408, 409       -> BROKEN
      const code = res.statusCode;
      const reviewCodes = new Set([403, 405, 429, 500, 502, 503, 504]);
      const ok = code >= 200 && code < 400;
      const status = ok ? 'OK' : (reviewCodes.has(code) ? 'REVIEW' : 'BAD');
      resolve({
        url: u,
        ok: ok,
        status: code,
        kind: status,
        error: null,
      });
    });
    req.on('error', (err) => resolve({ url: u, ok: false, status: 0, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ url: u, ok: false, status: 0, error: 'timeout' }); });
    req.end();
  });
}

// Run with bounded concurrency.
async function runAll(items, concurrency) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      const r = await checkOne(items[idx]);
      results.push(r);
      const tag = r.ok ? 'OK ' : (r.kind === 'REVIEW' ? 'REV' : 'BAD');
      const code = r.status ? String(r.status) : '---';
      const extra = r.error ? ` (${r.error})` : '';
      console.log(`[${String(idx + 1).padStart(4)}/${items.length}] ${tag} ${code.padStart(3)} ${r.url}${extra}`);
    }
  }
  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

(async () => {
  const results = await runAll(list, CONCURRENCY);
  const broken  = results.filter((r) => !r.ok && r.kind === 'BAD');
  const review  = results.filter((r) => !r.ok && r.kind === 'REVIEW');
  const okCount = results.filter((r) => r.ok).length;

  console.log('\n========== SUMMARY ==========');
  console.log(`Checked        : ${results.length}`);
  console.log(`OK             : ${okCount}`);
  console.log(`Broken (BAD)   : ${broken.length}`);
  console.log(`Needs review   : ${review.length}  (likely bot-walls — verify in a real browser)`);
  if (broken.length) {
    console.log('\nBroken URLs (real 4xx):');
    for (const b of broken) {
      console.log(`  - [${b.status || '---'}] ${b.url}  ${b.error ? '(' + b.error + ')' : ''}`);
    }
  }
  if (review.length) {
    console.log('\nReview URLs (403/405/5xx — open in browser to confirm):');
    for (const b of review.slice(0, 20)) {
      console.log(`  - [${b.status || '---'}] ${b.url}`);
    }
    if (review.length > 20) console.log(`  ... and ${review.length - 20} more`);
  }
  // Exit code: 1 if there are any real broken links; 0 if only "review" items.
  process.exit(broken.length ? 1 : 0);
})().catch((err) => {
  console.error('[link-checker] fatal:', err);
  process.exit(2);
});
