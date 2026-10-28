/* 30-second autocannon quick check (pre-k6 smoke signal).
 * Run:  node scripts/load/autocannon-quick.mjs [baseUrl]
 * Hits /, /api/menu, /api/ordering-state sequentially, 10 connections each.
 * SAFETY: local or *.pages.dev preview only — never production.
 */
import { spawnSync } from 'node:child_process';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
if (!/localhost|127\.0\.0\.1|pages\.dev/.test(BASE)) {
  console.error(`REFUSING to load-test non-preview target: ${BASE}`);
  process.exit(2);
}

const targets = ['/', '/api/menu', '/api/ordering-state'];
for (const t of targets) {
  console.log(`\n=== autocannon ${BASE}${t} (10 conn, 30s) ===`);
  const r = spawnSync('npx', ['autocannon', '-c', '10', '-d', '30', `${BASE}${t}`], {
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    console.error(`autocannon failed for ${t} (exit ${r.status})`);
    process.exit(1);
  }
}
console.log('\nQuick check done. For full scenarios run the k6 script (see header of scripts/load/k6-load-test.js).');
