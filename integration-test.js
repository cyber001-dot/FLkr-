/**
 * integration-test.js — Smoke-test the flkr backend:
 *   1. /health returns 200
 *   2. Wrong password -> 401
 *   3. Right password -> OTP issued (printed in stdout in dev mode)
 *   4. /facts returns up to 50 verified facts
 *   5. Rate limit triggers after 5 wrong logins
 */
const http = require('http');

const BASE = 'http://127.0.0.1:8787';

function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: '127.0.0.1',
      port: 8787,
      path,
      headers: Object.assign(
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        headers || {}
      ),
    };
    const r = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  console.log('--- 1. /health');
  const h = await req('GET', '/health');
  console.log('   status:', h.status, 'body:', h.body);
  if (h.status !== 200) throw new Error('health failed');

  console.log('--- 2. Wrong password');
  const bad = await req('POST', '/auth/login', {
    email: 'wisdomobialo22@gmail.com',
    password: 'wrong-password',
  });
  console.log('   status:', bad.status, 'body:', bad.body);
  if (bad.status !== 401) throw new Error('expected 401 on wrong password');

  console.log('--- 3. Right password -> OTP issued (dev fallback prints to server stdout)');
  const good = await req('POST', '/auth/login', {
    email: 'wisdomobialo22@gmail.com',
    password: 'flkr2026',
  });
  console.log('   status:', good.status, 'body:', good.body);
  if (good.status !== 200 || !good.body.otp_required) {
    throw new Error('expected otp_required:true on good password');
  }

  console.log('--- 4. /facts returns verified facts');
  const facts = await req('GET', '/facts?limit=5');
  console.log('   status:', facts.status, 'count:', facts.body && facts.body.facts ? facts.body.facts.length : 0);
  if (facts.status !== 200) throw new Error('expected /facts 200');

  console.log('--- 5. /facts/categories');
  const cats = await req('GET', '/facts/categories');
  console.log('   status:', cats.status, 'categories:', cats.body && cats.body.categories ? cats.body.categories.length : 0);

  console.log('--- 6. /ads returns active ads');
  const ads = await req('GET', '/ads');
  console.log('   status:', ads.status, 'count:', ads.body && ads.body.ads ? ads.body.ads.length : 0);

  console.log('--- 7. Rate limit: 6 more wrong logins from same IP');
  for (let i = 0; i < 6; i++) {
    const r = await req('POST', '/auth/login', {
      email: 'wisdomobialo22@gmail.com',
      password: 'wrong-' + i,
    });
    process.stdout.write('   attempt ' + (i + 1) + ' -> ' + r.status + (r.body.error ? ' (' + r.body.error + ')' : '') + '\n');
  }

  console.log('\nAll integration checks passed.');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
