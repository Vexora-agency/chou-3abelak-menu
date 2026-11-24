/**
 * Server-side address autocomplete (Geoapify proxied) contract.
 * Run: node scripts/test-geo-autocomplete.mjs
 *
 * No network: the upstream fetch is always injected or stubbed. Proves:
 *  - query validation edges (2/3/100/101 chars, whitespace, non-string);
 *  - lang/country fallback in URL building;
 *  - URL param presence, bias order (longitude first), and that the key
 *    lives only in the upstream URL string (never in logs or responses);
 *  - the sanitizer drops bad rows, caps the label, and strips every
 *    provider-only field (rank, datasource, …);
 *  - the route: gate, 400 invalid_query, 429 rate limits, 503 without a
 *    key, 502 on upstream failure, 200 with the exact sanitized shape;
 *  - no file under src/ can reach the provider or the key (the only
 *    allowed brand mention is the attribution link in AddressSuggestList).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAsserts, makeKV, readJson } from './_helpers/shared.mjs';
import {
  buildAutocompleteUrl,
  fetchAutocomplete,
  isGeoapifyConfigured,
  sanitizeAutocompleteResults,
  trimEnv,
  validateAutocompleteQuery,
} from '../functions/_shared/geoapify.js';
import { onRequest } from '../functions/api/geo/autocomplete.js';

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

function param(url, name) {
  return new URL(url).searchParams.get(name);
}

const KEY_ENV = { GEOAPIFY_API_KEY: 'test-key-abc123' };

/* ---------- query validation edges ---------- */

check('query: 2 chars rejected', validateAutocompleteQuery('ab') === null);
check('query: 3 chars accepted', validateAutocompleteQuery('abc') === 'abc');
check('query: 100 chars accepted', validateAutocompleteQuery('x'.repeat(100)) === 'x'.repeat(100));
check('query: 101 chars rejected', validateAutocompleteQuery('x'.repeat(101)) === null);
check('query: whitespace-only rejected', validateAutocompleteQuery('    ') === null);
check('query: padding trimmed', validateAutocompleteQuery('  Beirut  ') === 'Beirut');
check('query: null rejected', validateAutocompleteQuery(null) === null);
check('query: undefined rejected', validateAutocompleteQuery(undefined) === null);
check('query: number rejected', validateAutocompleteQuery(123) === null);
check('query: object rejected', validateAutocompleteQuery({}) === null);
check('query: empty string rejected', validateAutocompleteQuery('') === null);

/* ---------- env + config ---------- */

check('trimEnv trims', trimEnv({ GEOAPIFY_API_KEY: '  k  ' }, 'GEOAPIFY_API_KEY') === 'k');
check('trimEnv missing is empty', trimEnv({}, 'GEOAPIFY_API_KEY') === '');
check('configured with a key', isGeoapifyConfigured({ GEOAPIFY_API_KEY: 'k' }));
check('not configured without a key', !isGeoapifyConfigured({}));
check('not configured with a blank key', !isGeoapifyConfigured({ GEOAPIFY_API_KEY: '   ' }));

/* ---------- lang/country fallback ---------- */

check('lang ar passes through', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', lang: 'ar' }), 'lang') === 'ar');
check('lang en passes through', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', lang: 'en' }), 'lang') === 'en');
check('lang fr falls back to en', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', lang: 'fr' }), 'lang') === 'en');
check('lang missing falls back to en', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut' }), 'lang') === 'en');
check('country lb sets filter', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', country: 'lb' }), 'filter') === 'countrycode:lb');
check('country LB normalizes to lb', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', country: 'LB' }), 'filter') === 'countrycode:lb');
check('country usa dropped', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', country: 'usa' }), 'filter') === null);
check('country single letter dropped', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', country: 'l' }), 'filter') === null);
check('country digits dropped', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', country: '12' }), 'filter') === null);
check('country missing means no filter', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut' }), 'filter') === null);

/* ---------- URL building ---------- */

const built = buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', lang: 'ar', country: 'lb' });
check('url hits the autocomplete endpoint', built.startsWith('https://api.geoapify.com/v1/geocode/autocomplete?'));
check('url carries text', param(built, 'text') === 'Beirut');
check('url carries format=json', param(built, 'format') === 'json');
check('url carries the key (server-side only)', param(built, 'apiKey') === 'test-key-abc123');
check('url carries limit=5', param(built, 'limit') === '5');
check('url carries lang', param(built, 'lang') === 'ar');

const biased = buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', bias: { lng: 35.5, lat: 33.9 } });
check('bias is proximity LON,LAT (longitude first)', param(biased, 'bias') === 'proximity:35.5,33.9');
check('bad bias skipped', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', bias: { lng: NaN, lat: 33.9 } }), 'bias') === null);
check('missing bias skipped', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut' }), 'bias') === null);
check('build returns null without a key', buildAutocompleteUrl({}, { text: 'Beirut' }) === null);
check('build returns null for a bad query', buildAutocompleteUrl(KEY_ENV, { text: 'ab' }) === null);

const geoSource = read('functions/_shared/geoapify.js');
const routeSource = read('functions/api/geo/autocomplete.js');
check('shared helper never logs (no key/query in logs)', !geoSource.includes('console.'));
check('route never logs (no key/query in logs)', !routeSource.includes('console.'));
check('route wires the per-IP burst key', routeSource.includes('rl:geo-ac:'));
check('route wires the global daily key', routeSource.includes('geo-ac-day:'));
check('route reads the daily cap env', routeSource.includes('GEOAPIFY_DAILY_MAX'));
check('route biases from the stored map pin', routeSource.includes('parseMapUrlCoordsJs'));

/* ---------- sanitizer ---------- */

const providerPayload = {
  results: [
    {
      formatted: 'Beirut, Lebanon',
      address_line1: 'Beirut',
      address_line2: 'Lebanon',
      name: 'Beirut',
      street: 'Hamra',
      city: 'Beirut',
      result_type: 'city',
      rank: { importance: 1, popularity: 2 },
      datasource: { sourcename: 'openstreetmap' },
      lat: 33.8938,
      lon: 35.5018,
    },
    {
      formatted: '  Hamra Street, Beirut  ',
      address_line1: 'Hamra Street',
      address_line2: '',
      lat: 33.9,
      lon: 35.5,
      rank: {},
    },
    { formatted: 'Nowhere', lat: 1, lon: null },
    { formatted: 'String coords', lat: '33', lon: '35' },
    { formatted: '   ', address_line1: 'x', lat: 1, lon: 1 },
    { address_line1: 'No label', lat: 1, lon: 1 },
    null,
    'junk',
  ],
};
const expectedSanitized = [
  { label: 'Beirut, Lebanon', line1: 'Beirut', line2: 'Lebanon', lat: 33.8938, lng: 35.5018 },
  { label: 'Hamra Street, Beirut', line1: 'Hamra Street', line2: '', lat: 33.9, lng: 35.5 },
];
check(
  'sanitizer returns the exact client shape',
  JSON.stringify(sanitizeAutocompleteResults(providerPayload)) === JSON.stringify(expectedSanitized)
);
check(
  'sanitized rows carry only label/line1/line2/lat/lng',
  sanitizeAutocompleteResults(providerPayload).every(
    (row) => JSON.stringify(Object.keys(row).sort()) === JSON.stringify(['label', 'lat', 'line1', 'line2', 'lng'])
  )
);
const longLabel = sanitizeAutocompleteResults({
  results: [{ formatted: `  ${'z'.repeat(200)}  `, address_line1: 'a', address_line2: 'b', lat: 1, lon: 1 }],
});
check('label trimmed and capped at 120 chars', longLabel.length === 1 && longLabel[0].label.length === 120);
check(
  'non-string address lines default to empty',
  JSON.stringify(sanitizeAutocompleteResults({
    results: [{ formatted: 'A', address_line1: 42, lat: 1, lon: 1 }],
  })) === JSON.stringify([{ label: 'A', line1: '', line2: '', lat: 1, lng: 1 }])
);
check('garbage payloads sanitize to []', JSON.stringify(sanitizeAutocompleteResults(null)) === '[]'
  && JSON.stringify(sanitizeAutocompleteResults({})) === '[]'
  && JSON.stringify(sanitizeAutocompleteResults({ results: 'x' })) === '[]');

/* ---------- fetchAutocomplete unit (mocked fetch) ---------- */

let called = false;
const neverFetch = async () => {
  called = true;
  return { ok: true, status: 200, json: async () => ({ results: [] }) };
};
called = false;
const notConfigured = await fetchAutocomplete({}, { text: 'Beirut' }, neverFetch);
check('fetch: missing key is not_configured', !notConfigured.ok && notConfigured.error === 'not_configured' && !called);
called = false;
const badQuery = await fetchAutocomplete(KEY_ENV, { text: 'ab' }, neverFetch);
check('fetch: short query is bad_query without network', !badQuery.ok && badQuery.error === 'bad_query' && !called);

const failFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
const failed500 = await fetchAutocomplete(KEY_ENV, { text: 'Beirut' }, failFetch);
check('fetch: 500 maps to failed', !failed500.ok && failed500.error === 'failed');
const rateFetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
const failed429 = await fetchAutocomplete(KEY_ENV, { text: 'Beirut' }, rateFetch);
check('fetch: 429 maps to failed', !failed429.ok && failed429.error === 'failed');
const throwFetch = async () => { throw new Error('boom'); };
const failedThrow = await fetchAutocomplete(KEY_ENV, { text: 'Beirut' }, throwFetch);
check('fetch: exception maps to failed (never throws)', !failedThrow.ok && failedThrow.error === 'failed');
const badJsonFetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
const failedJson = await fetchAutocomplete(KEY_ENV, { text: 'Beirut' }, badJsonFetch);
check('fetch: unreadable body maps to failed', !failedJson.ok && failedJson.error === 'failed');

let upstreamUrl = '';
const okFetch = async (url) => {
  upstreamUrl = url;
  return { ok: true, status: 200, json: async () => providerPayload };
};
const fetched = await fetchAutocomplete(KEY_ENV, { text: 'Beirut' }, okFetch);
check(
  'fetch: success returns sanitized results',
  fetched.ok && JSON.stringify(fetched.results) === JSON.stringify(expectedSanitized)
);
check('fetch: key travels only in the upstream URL', upstreamUrl.includes('test-key-abc123')
  && !JSON.stringify(fetched).includes('test-key-abc123'));

/* ---------- route ---------- */

const noHeaderRes = await onRequest({ request: new Request('https://example.com/api/geo/autocomplete?q=Beirut'), env: KEY_ENV });
check('route: missing customer header is 400', noHeaderRes.status === 400);
const postRes = await onRequest({
  request: new Request('https://example.com/api/geo/autocomplete?q=Beirut', {
    method: 'POST',
    headers: { 'X-Requested-With': 'menu-customer' },
  }),
  env: KEY_ENV,
});
check('route: POST is 405 with Allow GET', postRes.status === 405 && postRes.headers.get('Allow') === 'GET');

for (const bad of ['q=ab', 'q=' + 'x'.repeat(101), '']) {
  const res = await onRequest({ request: customerGet(`/api/geo/autocomplete?${bad}`), env: KEY_ENV });
  const body = await readJson(res);
  check(`route: invalid query (${bad.slice(0, 8) || 'missing'}) is 400 invalid_query`,
    res.status === 400 && body && body.error === 'invalid_query');
}

const noKeyRes = await onRequest({ request: customerGet('/api/geo/autocomplete?q=Beirut'), env: {} });
const noKeyBody = await readJson(noKeyRes);
check('route: missing key is 503 autocomplete_unavailable (no KV, no key)',
  noKeyRes.status === 503 && noKeyBody && noKeyBody.error === 'autocomplete_unavailable');
check('route: 503 body echoes nothing sensitive', !JSON.stringify(noKeyBody).includes('Beirut'));

// Success path with a stubbed global fetch (the route uses server fetch).
const originalFetch = globalThis.fetch;
let capturedUrl = '';
const routePayload = {
  results: [
    {
      formatted: 'Verdun, Beirut, Lebanon',
      address_line1: 'Verdun',
      address_line2: 'Beirut, Lebanon',
      rank: { importance: 0.9 },
      datasource: { sourcename: 'openstreetmap' },
      lat: 33.8886,
      lon: 35.4798,
    },
    { formatted: 'Bad coords row', lat: 33.8, lon: 'oops' },
  ],
};
const expectedRouteResults = [
  { label: 'Verdun, Beirut, Lebanon', line1: 'Verdun', line2: 'Beirut, Lebanon', lat: 33.8886, lng: 35.4798 },
];
try {
  const kv = makeKV();
  await kv.put('menu', JSON.stringify({ settings: { mapUrl: 'https://www.google.com/maps/@33.8938,35.5018,15z' } }));
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return { ok: true, status: 200, json: async () => routePayload };
  };
  const res = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Verdun%20Beirut&lang=ar&country=lb'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kv },
  });
  const body = await readJson(res);
  check('route: success is 200 with exact sanitized results',
    res.status === 200 && body && body.ok === true
    && JSON.stringify(body.results) === JSON.stringify(expectedRouteResults));
  check('route: success is no-store JSON', res.headers.get('Cache-Control') === 'no-store'
    && (res.headers.get('Content-Type') || '').includes('application/json'));
  check('route: response never carries the key', !JSON.stringify(body).includes('route-key-xyz'));
  check('route: upstream URL carries the key server-side', capturedUrl.includes('route-key-xyz'));
  check('route: upstream URL carries lang and NO strict country filter (bias-only ranking)',
    param(capturedUrl, 'lang') === 'ar' && param(capturedUrl, 'filter') === null);
  check('route: upstream URL biases to the restaurant pin (LON,LAT)',
    param(capturedUrl, 'bias') === 'proximity:35.5018,33.8938');

  // No KV menu: bias is skipped, the search still succeeds.
  capturedUrl = '';
  const resNoKv = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Verdun'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz' },
  });
  const bodyNoKv = await readJson(resNoKv);
  check('route: missing KV skips bias and still succeeds',
    resNoKv.status === 200 && bodyNoKv && bodyNoKv.ok === true
    && param(capturedUrl, 'bias') === null);

  // Upstream failure: generic 502, nothing echoed.
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ message: 'provider says no' }) });
  const failRes = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Verdun'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz' },
  });
  const failBody = await readJson(failRes);
  check('route: upstream failure is 502 autocomplete_failed',
    failRes.status === 502 && failBody && failBody.error === 'autocomplete_failed'
    && !JSON.stringify(failBody).includes('provider says no')
    && !JSON.stringify(failBody).includes('route-key-xyz'));
} finally {
  globalThis.fetch = originalFetch;
}

// Rate limits.
{
  const kv = makeKV();
  await kv.put('rl:geo-ac:9.9.9.9', '60');
  const res = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Beirut', { ip: '9.9.9.9' }),
    env: { GEOAPIFY_API_KEY: 'k', MENU_KV: kv },
  });
  const body = await readJson(res);
  check('route: per-IP burst cap denies with 429 rate_limited', res.status === 429 && body && body.error === 'rate_limited');
}
{
  const kv = makeKV();
  const day = new Date().toISOString().slice(0, 10);
  await kv.put(`geo-ac-day:${day}`, '2500');
  const res = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Beirut'),
    env: { GEOAPIFY_API_KEY: 'k', MENU_KV: kv },
  });
  const body = await readJson(res);
  check('route: global daily cap denies with 429 rate_limited', res.status === 429 && body && body.error === 'rate_limited');
}

/* ---------- src/ must never reach the provider or the key ---------- */

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
const srcFiles = listFiles(join(ROOT, 'src'));
let secretHits = [];
let fetchLines = [];
let brandFiles = [];
for (const full of srcFiles) {
  let text;
  try {
    text = readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('GEOAPIFY_API_KEY') || text.includes('api.geoapify.com') || text.includes('apiKey')) {
    secretHits.push(full);
  }
  if (/geoapify/i.test(text)) brandFiles.push(full.slice(ROOT.length + 1).split('\\').join('/'));
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/geoapify/i.test(line) && /fetch\s*\(/.test(line)) {
      fetchLines.push(`${full.slice(ROOT.length + 1).split('\\').join('/')}:${i + 1}`);
    }
  });
}
check('src/: no key name, no direct provider calls, no apiKey', secretHits.length === 0);
check('src/: no client line fetches Geoapify (proxy-only)', fetchLines.length === 0);
console.log(`  info Geoapify brand mentions (attribution/comments only): ${brandFiles.join(', ')}`);

summary();
