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
  extractServiceCountries,
  extractServiceRadiusM,
  fetchAutocomplete,
  isGeoapifyConfigured,
  mergeAutocompleteResults,
  MIN_RICH_RESULTS,
  normalizeCountryCodes,
  parseLatLng,
  RESULT_LIMIT,
  sanitizeAutocompleteResults,
  trimEnv,
  validateAutocompleteQuery,
} from '../functions/_shared/geoapify.js';
import { onRequest } from '../functions/api/geo/autocomplete.js';
import {
  bboxAround,
  buildPhotonUrl,
  buildQueryVariants,
  fetchPhoton,
  latinizeStreetType,
  normalizeArabicQuery,
  rankAppendedByDigits,
  sanitizePhotonResults,
} from '../functions/_shared/photon.js';

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
check('countries array joins with commas', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', countries: ['lb', 'eg'] }), 'filter') === 'countrycode:lb,eg');
check('countries array sanitizes entries', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', countries: [' LB ', 'usa', 7, null] }), 'filter') === 'countrycode:lb');
check('countries empty means no filter', param(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', countries: [] }), 'filter') === null);
check('RESULT_LIMIT is 20 for street-level rows', RESULT_LIMIT === 20);
check('MIN_RICH_RESULTS threshold is 3', MIN_RICH_RESULTS === 3);
check('parseLatLng accepts strings', JSON.stringify(parseLatLng('33.8938', '35.5018')) === JSON.stringify({ lat: 33.8938, lng: 35.5018 }));
check('parseLatLng rejects garbage', parseLatLng('x', '35.5') === null && parseLatLng('33.9', null) === null);
check('parseLatLng rejects out-of-range', parseLatLng(91, 0) === null && parseLatLng(0, 181) === null);
check(
  'merge keeps zone rows first and dedupes by coords',
  (() => {
    const a = { label: 'A', line1: 'A', line2: '', lat: 1.00001, lng: 2.00001 };
    const b = { label: 'B', line1: 'B', line2: '', lat: 3, lng: 4 };
    const dup = { label: 'A copy', line1: 'A', line2: '', lat: 1.00002, lng: 2.00002 };
    const merged = mergeAutocompleteResults([a], [dup, b, null, 'junk'], 10);
    return merged.length === 2 && merged[0] === a && merged[1] === b;
  })()
);
check(
  'merge caps at the limit',
  mergeAutocompleteResults([], Array.from({ length: 30 }, (_, i) => ({ label: `P${i}`, line1: '', line2: '', lat: 10 + i * 0.01, lng: 20 })), 20).length === 20
);
check('zone countries come only from selected mode', extractServiceCountries({ settings: { ordering: { deliveryZones: { mode: 'selected', countries: [{ cc: 'LB' }, { cc: 'EG' }, { cc: 'xx' }] } } } }).join(',') === 'lb,eg,xx');
check('zone countries ignore non-selected modes', extractServiceCountries({ settings: { ordering: { deliveryZones: { mode: 'all', countries: [{ cc: 'LB' }] } } } }).length === 0);
check('zone countries fail open on garbage', extractServiceCountries(null).length === 0 && extractServiceCountries({}).length === 0);
check('radius defaults to 100km without zones', extractServiceRadiusM(null) === 100000);
check('radius reads maxKm', extractServiceRadiusM({ settings: { ordering: { deliveryZones: { maxKm: 30 } } } }) === 30000);
check('radius clamps garbage', extractServiceRadiusM({ settings: { ordering: { deliveryZones: { maxKm: 0 } } } }) === null
  && extractServiceRadiusM({ settings: { ordering: { deliveryZones: { maxKm: 5000 } } } }) === null);
check('circle filter wins over country codes', new URL(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', countries: ['lb'], circle: { lat: 33.9, lng: 35.5, radiusM: 30000 } })).searchParams.get('filter') === 'circle:35.5,33.9,30000');
check('circle rejects a tiny radius', new URL(buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', countries: ['lb'], circle: { lat: 33.9, lng: 35.5, radiusM: 10 } })).searchParams.get('filter') === 'countrycode:lb');

/* ---------- Photon deep-search fallback (keyless, OSM typeahead) ---------- */

check('photon: url hits the komoot endpoint', (buildPhotonUrl({ text: 'street 16' }) || '').startsWith('https://photon.komoot.io/api/'));
check('photon: url carries q + lang + limit', (() => {
  const u = buildPhotonUrl({ text: 'street 16', lang: 'ar' });
  return !!u && new URL(u).searchParams.get('q') === 'street 16' && new URL(u).searchParams.get('lang') === 'ar' && new URL(u).searchParams.get('limit') === '20';
})());
check('photon: unknown lang falls back to en', new URL(buildPhotonUrl({ text: 'street', lang: 'fr' })).searchParams.get('lang') === 'en');
check('photon: viewport bias uses lat/lon names', (() => {
  const u = new URL(buildPhotonUrl({ text: 'street', bias: { lat: 31.2, lng: 29.95 } }));
  return u.searchParams.get('lat') === '31.2' && u.searchParams.get('lon') === '29.95';
})());
check('photon: bad query returns null', buildPhotonUrl({ text: 'ab' }) === null && buildPhotonUrl({}) === null);
check(
  'photon: sanitizer maps GeoJSON to the shared client shape',
  (() => {
    const rows = sanitizePhotonResults({
      features: [
        {
          properties: { street: 'Street 16', district: 'El Soyouf', city: 'Alexandria', country: 'Egypt' },
          geometry: { coordinates: [29.96, 31.21] },
        },
        { properties: {}, geometry: { coordinates: ['x', 'y'] } },
        null,
      ],
    });
    return rows.length === 1 && rows[0].label.includes('Street 16')
      && rows[0].lat === 31.21 && rows[0].lng === 29.96 && typeof rows[0].line1 === 'string';
  })()
);
check('photon: garbage sanitizes to []', JSON.stringify(sanitizePhotonResults(null)) === '[]'
  && JSON.stringify(sanitizePhotonResults({})) === '[]');
{
  const bad = await fetchPhoton(null, { text: 'ab' }, async () => ({ ok: true, json: async () => ({}) }));
  check('photon fetch: short query is bad_query without network', !bad.ok && bad.error === 'bad_query');
  const failed = await fetchPhoton(null, { text: 'street 16' }, async () => ({ ok: false }));
  check('photon fetch: upstream failure maps to failed', !failed.ok && failed.error === 'failed');
check('arabic normalize unifies alef', normalizeArabicQuery('الإسكندرية') === 'الاسكندرية');
check('arabic normalize strips tashkeel and tatweel', normalizeArabicQuery('شَارع الـسـيوف') === 'شارع السيوف');
check('arabic normalize keeps ة and ى', normalizeArabicQuery('السيوف') === 'السيوف');
check('latinize maps شارع to street', latinizeStreetType('السيوف شارع 16') === 'السيوف street 16');
check('latinize returns null without a street word', latinizeStreetType('السيوف 16') === null);
check(
  'variants cover original, normalized and latinized',
  JSON.stringify(buildQueryVariants('الإسكندرية السيوف شارع 16')) === JSON.stringify(['الإسكندرية السيوف شارع 16', 'الاسكندرية السيوف شارع 16', 'الاسكندرية السيوف street 16'])
);
check(
  'variants back off to the last tokens for long latin queries',
  JSON.stringify(buildQueryVariants('Alexandria El Soyouf Street 16')) === JSON.stringify(['Alexandria El Soyouf Street 16', 'El Soyouf Street 16'])
);
check('variants collapse to one for short queries', JSON.stringify(buildQueryVariants('السيوف')) === JSON.stringify(['السيوف']));
check('bbox centers on the bias', bboxAround({ lat: 31.2, lng: 29.95 }) === '29.7,30.95,30.2,31.45');
check('bbox rejects garbage', bboxAround(null) === null && bboxAround({ lat: 91, lng: 0 }) === null);
check('photon url carries bbox with a bias', new URL(buildPhotonUrl({ text: 'street', bias: { lat: 31.2, lng: 29.95 } })).searchParams.get('bbox') === '29.7,30.95,30.2,31.45');
check('photon url has no bbox without a bias', new URL(buildPhotonUrl({ text: 'street' })).searchParams.get('bbox') === null);
check('photon: osm_tag=highway narrows the fallback to streets', new URL(buildPhotonUrl({ text: 'street 16', osmTag: 'highway' })).searchParams.get('osm_tag') === 'highway');
check('photon: no osm_tag by default', new URL(buildPhotonUrl({ text: 'street 16' })).searchParams.get('osm_tag') === null);
check(
  'digit ranking lifts the numbered street behind the zone rows',
  (() => {
    const z = { label: 'Z', line1: 'Z', line2: '', lat: 1, lng: 2 };
    const a = { label: 'Other road', line1: 'Other road', line2: '', lat: 3, lng: 4 };
    const b = { label: 'Street 16', line1: 'Street 16', line2: '', lat: 5, lng: 6 };
    const ranked = rankAppendedByDigits([z], [a, b], 'شارع 16');
    return ranked.length === 3 && ranked[0] === z && ranked[1] === b && ranked[2] === a;
  })()
);
check(
  'digit ranking keeps order when the query has no number',
  (() => {
    const z = { label: 'Z', line1: 'Z', line2: '', lat: 1, lng: 2 };
    const a = { label: 'A', line1: 'A', line2: '', lat: 3, lng: 4 };
    const ranked = rankAppendedByDigits([z], [a], 'السيوف');
    return ranked.length === 2 && ranked[0] === z && ranked[1] === a;
  })()
);
}

/* ---------- URL building ---------- */

const built = buildAutocompleteUrl(KEY_ENV, { text: 'Beirut', lang: 'ar', country: 'lb' });
check('url hits the autocomplete endpoint', built.startsWith('https://api.geoapify.com/v1/geocode/autocomplete?'));
check('url carries text', param(built, 'text') === 'Beirut');
check('url carries format=json', param(built, 'format') === 'json');
check('url carries the key (server-side only)', param(built, 'apiKey') === 'test-key-abc123');
check('url carries limit=20', param(built, 'limit') === '20');
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
  { label: 'Beirut, Lebanon', line1: 'Beirut', line2: 'Lebanon', lat: 33.8938, lng: 35.5018, details: 'Hamra, Beirut' },
  { label: 'Hamra Street, Beirut', line1: 'Hamra Street', line2: '', lat: 33.9, lng: 35.5 },
];
check(
  'sanitizer returns the exact client shape',
  JSON.stringify(sanitizeAutocompleteResults(providerPayload)) === JSON.stringify(expectedSanitized)
);
check(
  'sanitized rows carry only label/line1/line2/lat/lng (+optional details)',
  sanitizeAutocompleteResults(providerPayload).every((row) => {
    const keys = Object.keys(row).sort();
    return JSON.stringify(keys) === JSON.stringify(['label', 'lat', 'line1', 'line2', 'lng']) ||
      JSON.stringify(keys) === JSON.stringify(['details', 'label', 'lat', 'line1', 'line2', 'lng']);
  })
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
check(
  'sanitizer passes through 20 richer results',
  sanitizeAutocompleteResults({
    results: Array.from({ length: 20 }, (_, i) => ({
      formatted: `Place ${i}, Beirut, Lebanon`,
      address_line1: `Street ${i}`,
      address_line2: 'Beirut, Lebanon',
      lat: 33.8 + i * 0.001,
      lon: 35.4 + i * 0.001,
    })),
  }).length === 20
);
check(
  'street/building rows kept with line1 intact (street names prominent)',
  (() => {
    const rows = sanitizeAutocompleteResults({
      results: [
        { formatted: 'Hamra Street, Beirut, Lebanon', address_line1: 'Hamra Street', address_line2: 'Beirut, Lebanon', result_type: 'street', street: 'Hamra Street', lat: 33.9, lon: 35.5 },
        { formatted: 'Bldg 12, Hamra Street, Beirut', address_line1: 'Bldg 12, Hamra Street', address_line2: 'Beirut, Lebanon', result_type: 'building', lat: 33.901, lon: 35.501 },
      ],
    });
    return rows.length === 2 && rows[0].line1 === 'Hamra Street' && rows[1].line1 === 'Bldg 12, Hamra Street';
  })()
);
check(
  'side-street details composed when line2 is empty',
  (() => {
    const rows = sanitizeAutocompleteResults({
      results: [
        {
          formatted: 'Gouraud Street, Mar Mikhael, Beirut, Lebanon',
          address_line1: 'Gouraud Street',
          address_line2: '',
          housenumber: '12',
          street: 'Gouraud Street',
          suburb: 'Mar Mikhael',
          city: 'Beirut',
          lat: 33.8938,
          lon: 35.5018,
        },
      ],
    });
    return rows.length === 1 &&
      rows[0].line2 === '12 Gouraud Street, Mar Mikhael, Beirut' &&
      rows[0].details === '12 Gouraud Street, Mar Mikhael, Beirut';
  })()
);
check(
  'empty address_line1 kept for label fallback (display uses line1 || label)',
  JSON.stringify(sanitizeAutocompleteResults({
    results: [{ formatted: 'Beirut, Lebanon', address_line1: '', address_line2: 'Beirut, Lebanon', result_type: 'city', lat: 33.8938, lon: 35.5018 }],
  })) === JSON.stringify([{ label: 'Beirut, Lebanon', line1: '', line2: 'Beirut, Lebanon', lat: 33.8938, lng: 35.5018 }])
);

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
// Rich zone payload (3 rows): no second pass — the first call carries the
// zone filter and the restaurant-pin bias.
const originalFetch = globalThis.fetch;
let calledUrls = [];
const richPayload = {
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
    {
      formatted: 'Verdun Street, Beirut, Lebanon',
      address_line1: 'Verdun Street',
      address_line2: 'Beirut, Lebanon',
      street: 'Verdun Street',
      suburb: 'Verdun',
      city: 'Beirut',
      lat: 33.889,
      lon: 35.48,
    },
    {
      formatted: 'Bldg 4, Verdun Street, Beirut, Lebanon',
      address_line1: 'Bldg 4, Verdun Street',
      address_line2: 'Beirut, Lebanon',
      housenumber: '4',
      street: 'Verdun Street',
      city: 'Beirut',
      lat: 33.8891,
      lon: 35.4801,
    },
    { formatted: 'Bad coords row', lat: 33.8, lon: 'oops' },
  ],
};
const expectedRichResults = [
  { label: 'Verdun, Beirut, Lebanon', line1: 'Verdun', line2: 'Beirut, Lebanon', lat: 33.8886, lng: 35.4798 },
  { label: 'Verdun Street, Beirut, Lebanon', line1: 'Verdun Street', line2: 'Beirut, Lebanon', lat: 33.889, lng: 35.48, details: 'Verdun Street, Verdun, Beirut' },
  { label: 'Bldg 4, Verdun Street, Beirut, Lebanon', line1: 'Bldg 4, Verdun Street', line2: 'Beirut, Lebanon', lat: 33.8891, lng: 35.4801, details: '4 Verdun Street, Beirut' },
];
try {
  const kv = makeKV();
  await kv.put('menu', JSON.stringify({ settings: { mapUrl: 'https://www.google.com/maps/@33.8938,35.5018,15z', ordering: { deliveryZones: { mode: 'selected', countries: [{ cc: 'LB' }, { cc: 'EG' }] } } } }));
  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    return { ok: true, status: 200, json: async () => richPayload };
  };
  const res = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Verdun%20Beirut&lang=ar&country=lb'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kv },
  });
  const body = await readJson(res);
  check('route: success is 200 with exact sanitized results',
    res.status === 200 && body && body.ok === true
    && JSON.stringify(body.results) === JSON.stringify(expectedRichResults));
  check('route: rich zone pass needs no second call', calledUrls.length === 1);
  check('route: sources trail names the answering passes', (() => { const r = body; return Array.isArray(r.sources) && r.sources.includes('geoapify') && !r.sources.includes('google'); })());
  // Owner places rank first: a matching custom place outranks every
  // provider row and needs no extra provider call.
  calledUrls = [];
  const fakeDb = {
    prepare: () => ({
      all: async () => ({ results: [{
        name_ar: 'دوار السيوف', name_en: 'El Soyouf Roundabout',
        lat: 31.205, lng: 29.945, kind: 'landmark',
        created_at: '2026-11-26T00:00:00.000Z', updated_at: null,
      }] }),
    }),
  };
  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    return { ok: true, status: 200, json: async () => richPayload };
  };
  const resPlaces = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=%D8%A7%D9%84%D8%B3%D9%8A%D9%88%D9%81&lang=ar'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kv, ORDERS_DB: fakeDb },
  });
  const bodyPlaces = await readJson(resPlaces);
  check('route: owner place ranks first with the saved-place line',
    resPlaces.status === 200 && bodyPlaces && bodyPlaces.ok === true
    && bodyPlaces.results.length >= 1
    && bodyPlaces.results[0].line1 === 'دوار السيوف'
    && bodyPlaces.results[0].line2 === 'مكان محفوظ'
    && bodyPlaces.results[0].lat === 31.205 && bodyPlaces.results[0].lng === 29.945);
  check('route: owner head needs no extra provider call', calledUrls.length === 1);
  check('route: sources trail leads with custom', Array.isArray(bodyPlaces.sources) && bodyPlaces.sources[0] === 'custom');
  check('route: success is no-store JSON', res.headers.get('Cache-Control') === 'no-store'
    && (res.headers.get('Content-Type') || '').includes('application/json'));
  check('route: response never carries the key', !JSON.stringify(body).includes('route-key-xyz'));
  check('route: upstream URL carries the key server-side', calledUrls[0].includes('route-key-xyz'));
  check('route: upstream URL carries lang + circle filter around the pin', param(calledUrls[0], 'lang') === 'ar'
    && param(calledUrls[0], 'filter') === 'circle:35.5018,33.8938,100000');
  check('route: upstream URL biases to the restaurant pin (LON,LAT)',
    param(calledUrls[0], 'bias') === 'proximity:35.5018,33.8938');

  // Thin zone pass (1 row): the deep second pass runs unfiltered with the
  // same bias; zone rows stay first, duplicates drop. Both Geoapify passes
  // stay thin (2 rows), so the keyless Photon pass runs third and appends
  // the numbered side street (e.g. Street 16) behind the zone matches.
  calledUrls = [];
  const thinPayload = {
    results: [
      {
        formatted: 'El Soyouf, Alexandria, Egypt',
        address_line1: 'El Soyouf',
        address_line2: 'Alexandria, Egypt',
        suburb: 'El Soyouf',
        city: 'Alexandria',
        lat: 31.2,
        lon: 29.95,
      },
    ],
  };
  const openPayload = {
    results: [
      {
        formatted: 'El Soyouf, Alexandria, Egypt',
        address_line1: 'El Soyouf',
        address_line2: 'Alexandria, Egypt',
        suburb: 'El Soyouf',
        city: 'Alexandria',
        lat: 31.20001,
        lon: 29.95001,
      },
      {
        formatted: 'Street 45, El Soyouf, Alexandria, Egypt',
        address_line1: 'Street 45',
        address_line2: 'El Soyouf, Alexandria, Egypt',
        street: 'Street 45',
        suburb: 'El Soyouf',
        city: 'Alexandria',
        lat: 31.201,
        lon: 29.951,
      },
    ],
  };
  let thinFirst = true;
  const photonGeoJson = {
    features: [
      {
        properties: { street: 'Street 16', district: 'El Soyouf', city: 'Alexandria', country: 'Egypt' },
        geometry: { coordinates: [29.952, 31.202] },
      },
    ],
  };
  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    if (String(url).includes('photon.komoot.io')) {
      return { ok: true, status: 200, json: async () => photonGeoJson };
    }
    const payload = thinFirst ? thinPayload : openPayload;
    thinFirst = false;
    return { ok: true, status: 200, json: async () => payload };
  };
  const resThin = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=%D8%A7%D9%84%D8%B3%D9%8A%D9%88%D9%81&lang=ar&country=eg'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kv },
  });
  const bodyThin = await readJson(resThin);
  check('route: thin area pass triggers open + EN + photon passes', calledUrls.length === 4);
  check('route: EN retry keeps the area filter with lang=en',
    param(calledUrls[2], 'filter') === 'circle:35.5018,33.8938,100000' && param(calledUrls[2], 'lang') === 'en');
  check('route: deep pass drops the country filter but keeps the bias',
    param(calledUrls[1], 'filter') === null && param(calledUrls[1], 'bias') === 'proximity:35.5018,33.8938');
  check('route: photon pass carries the viewport bias without any key',
    calledUrls[3].includes('photon.komoot.io') && !calledUrls[3].includes('route-key-xyz'));
  check('route: merged results keep the zone row first and dedupe',
    resThin.status === 200 && bodyThin && bodyThin.ok === true
    && bodyThin.results.length === 3
    && bodyThin.results[0].label === 'El Soyouf, Alexandria, Egypt'
    && bodyThin.results[1].label === 'Street 45, El Soyouf, Alexandria, Egypt'
    && bodyThin.results[2].label.includes('Street 16'));

  // Fallback variant: a 4-token query whose Photon full-text pass is empty
  // still resolves via the backoff variant («El Soyouf Street 16»).
  calledUrls = [];
  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    const u = String(url);
    if (u.includes('photon.komoot.io')) {
      const pq = new URL(u).searchParams.get('q') || '';
      if (pq === 'Alexandria El Soyouf Street 16') {
        return { ok: true, status: 200, json: async () => ({ features: [] }) };
      }
      return { ok: true, status: 200, json: async () => photonGeoJson };
    }
    const payload = geoFirst ? thinPayload : openPayload;
    geoFirst = false;
    return { ok: true, status: 200, json: async () => payload };
  };
  let geoFirst = true;
  const resFallback = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Alexandria%20El%20Soyouf%20Street%2016&lang=en&country=eg'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kv },
  });
  const bodyFallback = await readJson(resFallback);
  check('route: empty photon full pass retries the backoff variant', calledUrls.length === 4);
  check('route: fallback variant resolves the numbered street',
    resFallback.status === 200 && bodyFallback && bodyFallback.ok === true
    && bodyFallback.results.length === 3
    && bodyFallback.results[2].label.includes('Street 16'));
  check('route: fallback variant searches streets only (osm_tag=highway)',
    (() => {
      const photonCalls = calledUrls.filter((u) => String(u).includes('photon.komoot.io'));
      return photonCalls.length === 2
        && new URL(photonCalls[1]).searchParams.get('osm_tag') === 'highway'
        && new URL(photonCalls[1]).searchParams.get('q') === 'El Soyouf Street 16';
    })());

  // Map viewport bias: a lat/lng from the picker outranks the restaurant
  // pin; garbage viewports fall back to the pin.
  calledUrls = [];
  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    return { ok: true, status: 200, json: async () => richPayload };
  };
  const resView = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Verdun&lat=31.2&lng=29.95'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kv },
  });
  const bodyView = await readJson(resView);
  check('route: viewport bias outranks the restaurant pin',
    resView.status === 200 && bodyView && bodyView.ok === true
    && param(calledUrls[0], 'bias') === 'proximity:29.95,31.2');
  calledUrls = [];
  const resBadView = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Verdun&lat=oops&lng=200'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kv },
  });
  const bodyBadView = await readJson(resBadView);
  check('route: invalid viewport falls back to the restaurant pin',
    resBadView.status === 200 && bodyBadView && bodyBadView.ok === true
    && param(calledUrls[0], 'bias') === 'proximity:35.5018,33.8938');

  // No KV menu: bias is skipped, the search still succeeds (single call:
  // no zone filter exists, so no second pass is needed).
  calledUrls = [];
  const resNoKv = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=Verdun'),
    env: { GEOAPIFY_API_KEY: 'route-key-xyz' },
  });
  const bodyNoKv = await readJson(resNoKv);
  check('route: missing KV skips bias and still succeeds',
    resNoKv.status === 200 && bodyNoKv && bodyNoKv.ok === true
    && calledUrls.length === 1 && param(calledUrls[0], 'bias') === null);

  // No stored pin: the delivery-zone countries still filter the search.
  {
    const kvZones = makeKV();
    await kvZones.put('menu', JSON.stringify({ settings: { ordering: { deliveryZones: { mode: 'selected', countries: [{ cc: 'LB' }, { cc: 'EG' }] } } } }));
    calledUrls = [];
    const resZones = await onRequest({
      request: customerGet('/api/geo/autocomplete?q=Verdun'),
      env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kvZones },
    });
    check('route: pin-less zones fall back to the country filter',
      resZones.status === 200 && param(calledUrls[0], 'filter') === 'countrycode:lb,eg');
  }

  // Worldwide service (zones not selected): the client hint is the only
  // filter; with no hint either, the search runs unfiltered + unbiased.
  {
    const kvAll = makeKV();
    await kvAll.put('menu', JSON.stringify({ settings: { ordering: { deliveryZones: { mode: 'all' } } } }));
    calledUrls = [];
    const resHint = await onRequest({
      request: customerGet('/api/geo/autocomplete?q=Verdun&country=lb'),
      env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kvAll },
    });
    check('route: worldwide service falls back to the client country hint',
      resHint.status === 200 && param(calledUrls[0], 'filter') === 'countrycode:lb');
    calledUrls = [];
    const resOpen = await onRequest({
      request: customerGet('/api/geo/autocomplete?q=Verdun'),
      env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kvAll },
    });
    check('route: worldwide service without a hint runs unfiltered',
      resOpen.status === 200 && param(calledUrls[0], 'filter') === null);
  }

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
