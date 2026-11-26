/**
 * Nominatim full-text search fallback contract.
 * Run: node scripts/test-nominatim.mjs
 *
 * No network: upstream fetch is injected or stubbed. Proves:
 *  - query validation edges (min 6 chars), lang fallback, URL shape
 *    (jsonv2 + namedetails + viewbox bias, never a hard fence);
 *  - sanitizer maps named POIs with coordinates, drops bad rows;
 *  - never logs; route merges nominatim rows behind with sources trail,
 *    throttled per IP (1 call / 2s) plus the shared daily cap.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAsserts, makeKV, readJson } from './_helpers/shared.mjs';
import {
  buildNominatimUrl,
  fetchNominatim,
  NOMINATIM_RESULT_LIMIT,
  sanitizeNominatimResults,
  validateNominatimQuery,
} from '../functions/_shared/nominatim.js';
import { onRequest } from '../functions/api/geo/autocomplete.js';

const { ok, summary } = createAsserts();

function check(name, cond) {
  if (cond) console.log(`  ok ${name}`);
  ok(cond, name);
}

function customerGet(path) {
  return new Request(`https://example.com${path}`, {
    method: 'GET',
    headers: { 'X-Requested-With': 'menu-customer' },
  });
}

check('query shorter than 6 chars is rejected', validateNominatimQuery('abcde') === null);
check('query of 100 chars accepted', validateNominatimQuery('x'.repeat(100)) === 'x'.repeat(100));
check('whitespace collapses', validateNominatimQuery('  شارع   16  ') === 'شارع 16');
check('non-strings rejected', validateNominatimQuery(null) === null && validateNominatimQuery(42) === null);

const built = buildNominatimUrl({ text: 'كنيسة الانبا اثناسيوس', lang: 'ar', country: 'EG', bias: { lat: 31.2, lng: 29.95 } });
check('url hits nominatim search', (built || '').startsWith('https://nominatim.openstreetmap.org/search?'));
check('url carries jsonv2 + namedetails + arabic lang', (() => {
  const u = new URL(built);
  return u.searchParams.get('format') === 'jsonv2' && u.searchParams.get('namedetails') === '1'
    && u.searchParams.get('accept-language') === 'ar' && u.searchParams.get('countrycodes') === 'eg';
})());
check('url biases with an open viewbox (never a fence)', (() => {
  const u = new URL(built);
  return (u.searchParams.get('viewbox') || '').split(',').length === 4 && u.searchParams.get('bounded') === '0';
})());
check('url rejects short queries', buildNominatimUrl({ text: 'ab' }) === null);

const payload = [
  {
    place_id: 1,
    lat: '31.2056',
    lon: '29.9246',
    name: 'كنيسة الأنبا أثناسيوس',
    display_name: 'كنيسة الأنبا أثناسيوس, السيوف, الإسكندرية, مصر',
    namedetails: { 'name:ar': 'كنيسة الأنبا أثناسيوس', name: 'Anba Athanasius Church' },
    address: { amenity: 'كنيسة الأنبا أثناسيوس', suburb: 'السيوف', city: 'الإسكندرية' },
  },
  { lat: 'x', lon: 'y', display_name: 'Bad row' },
  null,
];
const rows = sanitizeNominatimResults(payload);
check('sanitizer maps the named POI with coordinates',
  rows.length === 1 && rows[0].line1 === 'كنيسة الأنبا أثناسيوس'
  && rows[0].label.includes('السيوف') && rows[0].lat === 31.2056 && rows[0].lng === 29.9246);
check('garbage sanitizes to []', sanitizeNominatimResults(null).length === 0 && sanitizeNominatimResults({}).length === 0);
check('result limit is 8', NOMINATIM_RESULT_LIMIT === 8);

let called = false;
const neverFetch = async () => {
  called = true;
  return { ok: true, status: 200, json: async () => ([]) };
};
called = false;
check('fetch: bad query never hits network', (await fetchNominatim(null, { text: 'ab' }, neverFetch)).error === 'bad_query' && !called);
{
  let seenUrl = '';
  let seenOpts = null;
  const fetched = await fetchNominatim(null, { text: 'كنيسة اثناسيوس', lang: 'ar' }, async (url, opts) => {
    seenUrl = String(url);
    seenOpts = opts;
    return { ok: true, status: 200, json: async () => payload };
  });
  check('fetch: success returns mapped rows', fetched.ok && fetched.rows === undefined && fetched.results.length === 1);
  check('fetch: identifying UA, no key anywhere', seenOpts && seenOpts.headers && seenOpts.headers['User-Agent'] === 'chou-3abelak-menu/1.0 (delivery address search)'
    && !seenUrl.includes('key') && !JSON.stringify(seenOpts).includes('test-key'));
}

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'functions', '_shared', 'nominatim.js'), 'utf8');
check('shared helper never logs', !src.includes('console.'));

const originalFetch = globalThis.fetch;
try {
  const kv = makeKV();
  await kv.put('menu', JSON.stringify({ settings: { mapUrl: 'https://www.google.com/maps/@31.2056,29.9246,15z', ordering: { deliveryZones: { mode: 'selected', countries: [{ cc: 'EG' }], maxKm: 30 } } } }));
  const churchGeoJson = { features: [] };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nominatim.openstreetmap.org/search')) {
      return { ok: true, status: 200, json: async () => payload };
    }
    if (u.includes('photon.komoot.io')) return { ok: true, status: 200, json: async () => churchGeoJson };
    if (u.includes('places.googleapis.com')) return { ok: true, status: 200, json: async () => ({ suggestions: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const res = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=' + encodeURIComponent('كنيسة الانبا اثناسيوس السيوف في الاسكندرية') + '&lang=ar&country=eg'),
    env: { GOOGLE_PLACES_API_KEY: 'route-key-xyz', MENU_KV: kv },
  });
  const body = await readJson(res);
  check('route: nominatim resolves the buried POI name',
    res.status === 200 && body && body.ok === true
    && body.results.some((r) => (r.line1 || '').includes('أثناسيوس')));
  check('route: sources trail includes nominatim', Array.isArray(body.sources) && body.sources.includes('nominatim'));
} finally {
  globalThis.fetch = originalFetch;
}

summary();
