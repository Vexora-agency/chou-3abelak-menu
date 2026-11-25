/**
 * Server-side reverse-geocode (Nominatim proxied) contract.
 * Run: node scripts/test-geo-reverse.mjs
 *
 * No network: the upstream fetch is always injected or stubbed. Proves:
 *  - lat/lng validation edges (strings, rounding, ranges, garbage);
 *  - reverse URL carries zoom=18 + language and the identifying UA header;
 *  - the formatter returns place + road + district + city with wide OSM
 *    key coverage, display_name fallback, 200-char cap;
 *  - the route: gate, 400 invalid_query, 405, 429 rate limits,
 *    502 on upstream failure, 200 with { ok, address } (address null is
 *    NOT a failure), no-store, and no coordinate logging.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAsserts, makeKV, readJson } from './_helpers/shared.mjs';
import {
  buildReverseUrl,
  fetchReverse,
  formatReverseAddress,
  normalizeReverseLang,
  validateLatLng,
} from '../functions/_shared/reverse.js';
import { onRequest } from '../functions/api/geo/reverse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const { ok, summary } = createAsserts();

function check(name, cond) {
  if (cond) console.log(`  ok ${name}`);
  ok(cond, name);
}

function customerGet(path, { ip } = {}) {
  const headers = { 'X-Requested-With': 'menu-customer' };
  if (ip) headers['CF-Connecting-IP'] = ip;
  return new Request(`https://example.com${path}`, { method: 'GET', headers });
}

/* ---------- validation ---------- */

check('coords: numbers accepted', JSON.stringify(validateLatLng(33.8938, 35.5018)) === JSON.stringify({ lat: 33.8938, lng: 35.5018 }));
check('coords: strings accepted', JSON.stringify(validateLatLng(' 33.89381 ', '35.50184')) === JSON.stringify({ lat: 33.89381, lng: 35.50184 }));
check('coords: rounded to 5 decimals', JSON.stringify(validateLatLng(33.893812345, 35.5)) === JSON.stringify({ lat: 33.89381, lng: 35.5 }));
check('coords: missing rejected', validateLatLng(null, 35.5) === null && validateLatLng(33.8, undefined) === null);
check('coords: garbage rejected', validateLatLng('x', 35.5) === null && validateLatLng(NaN, 1) === null);
check('coords: out-of-range rejected', validateLatLng(91, 0) === null && validateLatLng(0, 181) === null);
check('coords: edges accepted', validateLatLng(90, 180) !== null && validateLatLng(-90, -180) !== null);
check('lang ar passes', normalizeReverseLang('ar') === 'ar' && normalizeReverseLang(' AR ') === 'ar');
check('lang falls back to en', normalizeReverseLang('fr') === 'en' && normalizeReverseLang(null) === 'en');

/* ---------- url + formatter ---------- */

const built = buildReverseUrl(33.8938, 35.5018, 'ar');
check('url hits nominatim reverse', (built || '').startsWith('https://nominatim.openstreetmap.org/reverse?'));
check('url carries zoom=18 + language', (() => {
  const u = new URL(built);
  return u.searchParams.get('zoom') === '18' && u.searchParams.get('accept-language') === 'ar'
    && u.searchParams.get('format') === 'jsonv2';
})());
check('url rejects bad coords', buildReverseUrl(91, 0, 'ar') === null);

check(
  'formatter returns place + road + district + city',
  formatReverseAddress({
    name: 'Pharmacy One',
    address: { house_number: '12', road: 'Gouraud Street', suburb: 'Mar Mikhael', city: 'Beirut' },
  }) === 'Pharmacy One, 12 Gouraud Street, Mar Mikhael, Beirut'
);
check(
  'formatter covers footway/residential/borough tags',
  formatReverseAddress({
    address: { footway: 'Alley 3', borough: 'El Soyouf', town: 'Alexandria' },
  }) === 'Alley 3, El Soyouf, Alexandria'
);
check(
  'formatter skips a place that duplicates the road',
  formatReverseAddress({ name: 'Gouraud Street', address: { road: 'Gouraud Street', city: 'Beirut' } }) === 'Gouraud Street, Beirut'
);
check(
  'formatter falls back to display_name head',
  formatReverseAddress({ display_name: 'A, B, C, D, E, F' }) === 'A, B, C, D'
);
check('formatter caps at 200 chars', (formatReverseAddress({ display_name: `${'z'.repeat(300)}, x` }) || '').length === 200);
check('formatter garbage is null', formatReverseAddress(null) === null && formatReverseAddress({}) === null && formatReverseAddress({ address: {} }) === null);

/* ---------- fetch unit (mocked) ---------- */

let called = false;
const neverFetch = async () => {
  called = true;
  return { ok: true, status: 200, json: async () => ({}) };
};
called = false;
const bad = await fetchReverse(null, { lat: 91, lng: 0 }, neverFetch);
check('fetch: bad coords never hit network', !bad.ok && bad.error === 'bad_query' && !called);

let seenUrl = '';
let seenOpts = null;
const okFetch = async (url, opts) => {
  seenUrl = String(url);
  seenOpts = opts;
  return {
    ok: true,
    status: 200,
    json: async () => ({ address: { road: 'Hamra Street', city: 'Beirut' } }),
  };
};
const fetched = await fetchReverse(null, { lat: 33.9, lng: 35.5, lang: 'en' }, okFetch);
check('fetch: success returns the formatted address', fetched.ok && fetched.address === 'Hamra Street, Beirut');
check('fetch: identifying UA rides server-side', seenOpts && seenOpts.headers && seenOpts.headers['User-Agent'] === 'chou-3abelak-menu/1.0 (delivery address lookup)');
check('fetch: url carries no key material', !seenUrl.includes('key') && !seenUrl.includes('token'));

const failFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
check('fetch: 500 maps to failed', !((await fetchReverse(null, { lat: 1, lng: 1 }, failFetch))).ok);
const throwFetch = async () => { throw new Error('boom'); };
check('fetch: exception maps to failed (never throws)', !((await fetchReverse(null, { lat: 1, lng: 1 }, throwFetch))).ok);

/* ---------- route ---------- */

const sharedSource = read('functions/_shared/reverse.js');
const routeSource = read('functions/api/geo/reverse.js');
check('shared helper never logs (no coords in logs)', !sharedSource.includes('console.'));
check('route never logs (no coords in logs)', !routeSource.includes('console.'));
check('route wires the per-IP burst key', routeSource.includes('rl:geo-rev:'));
check('route wires the global daily key', routeSource.includes('geo-rev-day:'));
check('route reads the daily cap env', routeSource.includes('GEO_REVERSE_DAILY_MAX'));

const noHeaderRes = await onRequest({ request: new Request('https://example.com/api/geo/reverse?lat=1&lng=1'), env: {} });
check('route: missing customer header is 400', noHeaderRes.status === 400);
const postRes = await onRequest({
  request: new Request('https://example.com/api/geo/reverse?lat=1&lng=1', {
    method: 'POST',
    headers: { 'X-Requested-With': 'menu-customer' },
  }),
  env: {},
});
check('route: POST is 405 with Allow GET', postRes.status === 405 && postRes.headers.get('Allow') === 'GET');

for (const badQ of ['lat=1', 'lat=x&lng=35.5', 'lat=91&lng=0', 'lat=33.8&lng=200', '']) {
  const res = await onRequest({ request: customerGet(`/api/geo/reverse?${badQ}`), env: {} });
  const body = await readJson(res);
  check(`route: invalid coords (${badQ.slice(0, 12) || 'missing'}) is 400 invalid_query`,
    res.status === 400 && body && body.error === 'invalid_query');
}

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      name: 'Pharmacy One',
      address: { house_number: '12', road: 'Gouraud Street', suburb: 'Mar Mikhael', city: 'Beirut' },
    }),
  });
  const res = await onRequest({ request: customerGet('/api/geo/reverse?lat=33.8938&lng=35.5018&lang=ar'), env: {} });
  const body = await readJson(res);
  check('route: success is 200 with the exact address',
    res.status === 200 && body && body.ok === true
    && body.address === 'Pharmacy One, 12 Gouraud Street, Mar Mikhael, Beirut');
  check('route: success is no-store JSON', res.headers.get('Cache-Control') === 'no-store'
    && (res.headers.get('Content-Type') || '').includes('application/json'));

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const resNull = await onRequest({ request: customerGet('/api/geo/reverse?lat=0&lng=0'), env: {} });
  const bodyNull = await readJson(resNull);
  check('route: empty upstream is 200 with address null (not a failure)',
    resNull.status === 200 && bodyNull && bodyNull.ok === true && bodyNull.address === null);

  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ message: 'nope' }) });
  const resFail = await onRequest({ request: customerGet('/api/geo/reverse?lat=1&lng=1'), env: {} });
  const bodyFail = await readJson(resFail);
  check('route: upstream failure is 502 reverse_failed',
    resFail.status === 502 && bodyFail && bodyFail.error === 'reverse_failed'
    && !JSON.stringify(bodyFail).includes('nope'));
} finally {
  globalThis.fetch = originalFetch;
}

// Rate limits.
{
  const kv = makeKV();
  await kv.put('rl:geo-rev:9.9.9.9', '60');
  const res = await onRequest({
    request: customerGet('/api/geo/reverse?lat=1&lng=1', { ip: '9.9.9.9' }),
    env: { MENU_KV: kv },
  });
  const body = await readJson(res);
  check('route: per-IP burst cap denies with 429 rate_limited', res.status === 429 && body && body.error === 'rate_limited');
}
{
  const kv = makeKV();
  const day = new Date().toISOString().slice(0, 10);
  await kv.put(`geo-rev-day:${day}`, '2500');
  const res = await onRequest({
    request: customerGet('/api/geo/reverse?lat=1&lng=1'),
    env: { MENU_KV: kv },
  });
  const body = await readJson(res);
  check('route: global daily cap denies with 429 rate_limited', res.status === 429 && body && body.error === 'rate_limited');
}

/* ---------- src/ must never hardcode a UA or call nominatim except fallback ---------- */

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full));
    else if (st.isFile()) out.push(full);
  }
  return out;
}
const hookFiles = listFiles(join(ROOT, 'src', 'features', 'cart', 'hooks')).map((f) => f.slice((ROOT + '/').length).split('\\').join('/'));
const hookText = hookFiles.map((f) => read(f)).join('\n');
check('hook: proxy-first with a direct fallback', hookText.includes('/api/geo/reverse') && hookText.includes('directReverseGeocode'));

summary();
