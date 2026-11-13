/**
 * Header-contract test: public/_headers is the SINGLE source of served
 * headers (Vite copies public/ verbatim; the output was verified
 * byte-identical in Phase 0). Fails if a required directive drifts or if
 * a second root _headers reappears (which Pages would ignore, silently
 * forking the security posture).
 * Run: node scripts/test-headers.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; /* console.log('PASS', n); */ } else { fail++; console.error(`FAIL ${n} ${x}`); } };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const served = join(root, 'public', '_headers');
const legacy = join(root, '_headers');

ok(!existsSync(legacy), 'no root _headers (single source is public/_headers)');
ok(existsSync(served), 'public/_headers exists');

const raw = existsSync(served) ? readFileSync(served, 'utf8') : '';
const text = raw.replace(/\r\n/g, '\n');
const section = (name) => {
  const i = text.indexOf(`\n${name}\n`);
  if (i < 0 && !text.startsWith(`${name}\n`)) return '';
  const start = i < 0 ? 0 : i + 1;
  const rest = text.slice(start);
  const next = rest.slice(rest.indexOf('\n') + 1).search(/^\S/m);
  return next < 0 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next);
};

const global = section('/*');
for (const h of ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy:', 'Permissions-Policy:', "Content-Security-Policy: default-src 'self'", "frame-ancestors 'none'"]) {
  ok(global.includes(h), `global has ${h.split(':')[0]}`);
}
ok(global.includes('geolocation=(self)'), 'geolocation allowed for self (map picker)');
ok(global.includes('tile.openstreetmap.org'), 'CSP allows OSM tiles');
ok(global.includes('lh3.googleusercontent.com'), 'CSP allows Google avatars');
ok(global.includes('nominatim.openstreetmap.org'), 'CSP allows Nominatim');

for (const p of ['/admin/*', '/admin', '/invite/*', '/invite']) {
  const s = section(p);
  ok(s.includes('Cache-Control: no-store'), `${p} is no-store`);
}
for (const p of ['/invite/*', '/invite']) {
  ok(section(p).includes('Referrer-Policy: no-referrer'), `${p} never leaks token via Referer`);
}
ok(section('/').includes('Cache-Control: no-cache'), 'entry HTML revalidates (no-cache, not no-store)');
ok(!section('/').includes('no-store'), 'entry HTML keeps bfcache eligibility');
ok(section('/assets/*').includes('immutable'), 'hashed assets immutable');

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
