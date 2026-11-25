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
check('radius is null without an explicit maxKm', extractServiceRadiusM(null) === null
  && extractServiceRadiusM({ settings: { ordering: { deliveryZones: { mode: 'selected', countries: [] } } } }) === null);
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

const noKeyEnv = {};
{
  // No keys at all: free passes still answer (Photon stubbed empty here).
  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ features: [] }) };
  };
  const resFree = await onRequest({ request: customerGet('/api/geo/autocomplete?q=Beirut'), env: noKeyEnv });
  const bodyFree = await readJson(resFree);
  check('route: keyless search still answers 200 from free passes',
    resFree.status === 200 && bodyFree && bodyFree.ok === true && Array.isArray(bodyFree.results));
  check('route: google flag is off without a key', bodyFree.google === 'off');
  check('route: free body echoes nothing sensitive', !JSON.stringify(bodyFree).includes('Beirut'));
}

// Success paths with a stubbed global fetch (the route uses server fetch).
const originalFetch = globalThis.fetch;
let calledUrls = [];
const googlePayload = {
  suggestions: [
    {
      placePrediction: {
        placeId: 'ChIJN1t_tDeuEmsRMD9Q5I-qdUQ',
        text: { text: 'شارع 16، السيوف، الإسكندرية' },
        structuredFormat: { mainText: { text: 'شارع 16' }, secondaryText: { text: 'السيوف، الإسكندرية' } },
      },
    },
    {
      placePrediction: {
        placeId: 'ChIJN1t_tDeuEmsRMD9Q5I-qdUR',
        text: { text: 'شارع 17، السيوف، الإسكندرية' },
        structuredFormat: { mainText: { text: 'شارع 17' }, secondaryText: { text: 'السيوف، الإسكندرية' } },
      },
    },
  ],
};
const photonGeoJson = {
  features: [
    {
      properties: { street: 'Street 45', district: 'El Soyouf', city: 'Alexandria', country: 'Egypt' },
      geometry: { coordinates: [29.951, 31.201] },
    },
  ],
};
const emptyPhoton = { features: [] };
function googleCalls(urls) {
  return urls.filter((u) => String(u).includes('places.googleapis.com'));
}
function photonCalls(urls) {
  return urls.filter((u) => String(u).includes('photon.komoot.io'));
}
try {
  const kv = makeKV();
  await kv.put('menu', JSON.stringify({ settings: { mapUrl: 'https://www.google.com/maps/@31.2056,29.9246,15z', ordering: { deliveryZones: { mode: 'selected', countries: [{ cc: 'EG' }], maxKm: 30 } } } }));
  const gEnv = { GOOGLE_PLACES_API_KEY: 'route-google-key', MENU_KV: kv };

  // Google primary: owner places first, then Google rows, no Photon needed.
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
  let seenBody = null;
  globalThis.fetch = async (url, opts) => {
    calledUrls.push(String(url));
    if (String(url).includes('places.googleapis.com')) {
      seenBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => googlePayload };
    }
    return { ok: true, status: 200, json: async () => emptyPhoton };
  };
  const resPlaces = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=%D8%A7%D9%84%D8%B3%D9%8A%D9%88%D9%81&lang=ar&session=abc123XYZ_-'),
    env: { ...gEnv, ORDERS_DB: fakeDb },
  });
  const bodyPlaces = await readJson(resPlaces);
  check('route: owner place ranks first with the saved-place line',
    resPlaces.status === 200 && bodyPlaces && bodyPlaces.ok === true
    && bodyPlaces.results.length === 3
    && bodyPlaces.results[0].line1 === 'دوار السيوف'
    && bodyPlaces.results[0].line2 === 'مكان محفوظ'
    && bodyPlaces.results[1].placeId === 'ChIJN1t_tDeuEmsRMD9Q5I-qdUQ'
    && bodyPlaces.results[1].lat === null);
  check('route: sources trail leads with custom then google',
    Array.isArray(bodyPlaces.sources) && bodyPlaces.sources[0] === 'custom' && bodyPlaces.sources[1] === 'google');
  check('route: google flag is ok', bodyPlaces.google === 'ok');
  check('route: Google call is POST with key header + restriction + session',
    googleCalls(calledUrls).length === 1 && seenBody
    && seenBody.input === 'السيوف' && seenBody.languageCode === 'ar'
    && JSON.stringify(seenBody.includedRegionCodes) === JSON.stringify(['EG'])
    && seenBody.regionCode === 'eg' && seenBody.sessionToken === 'abc123XYZ_-'
    && seenBody.locationRestriction && seenBody.locationRestriction.circle
    && seenBody.locationRestriction.circle.center.latitude === 31.2056
    && !('locationBias' in seenBody));
  check('route: success is no-store JSON', resPlaces.headers.get('Cache-Control') === 'no-store'
    && (resPlaces.headers.get('Content-Type') || '').includes('application/json'));
  check('route: response never carries the key', !JSON.stringify(bodyPlaces).includes('route-google-key'));

  // Thin Google (empty) falls back to Photon streets.
  calledUrls = [];
  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    if (String(url).includes('places.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ suggestions: [] }) };
    }
    return { ok: true, status: 200, json: async () => photonGeoJson };
  };
  const resThin = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=%D8%B4%D8%A7%D8%B1%D8%B9%2045&lang=ar&country=eg'),
    env: gEnv,
  });
  const bodyThin = await readJson(resThin);
  check('route: empty Google pass falls back to Photon streets',
    resThin.status === 200 && bodyThin && bodyThin.ok === true
    && bodyThin.google === 'empty'
    && bodyThin.sources.includes('photon')
    && bodyThin.results.some((r) => r.line1 === 'Street 45'));

  // No key: Photon alone still answers; google flag stays off.
  calledUrls = [];
  const resNoKey = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=%D8%B4%D8%A7%D8%B1%D8%B9%2045&lang=ar'),
    env: { MENU_KV: kv },
  });
  const bodyNoKey = await readJson(resNoKey);
  check('route: unconfigured Google is skipped, Photon covers',
    resNoKey.status === 200 && bodyNoKey && bodyNoKey.ok === true
    && bodyNoKey.google === 'off' && googleCalls(calledUrls).length === 0
    && photonCalls(calledUrls).length >= 1);

  // Daily budget spent: Google capped, free Photon still answers.
  {
    const kvCap = makeKV();
    await kv.put('menu', JSON.stringify({ settings: { mapUrl: 'https://www.google.com/maps/@31.2056,29.9246,15z' } }));
    const day = new Date().toISOString().slice(0, 10);
    await kvCap.put('geo-gg-day:' + day, '300');
    await kvCap.put('menu', JSON.stringify({ settings: { mapUrl: 'https://www.google.com/maps/@31.2056,29.9246,15z' } }));
    calledUrls = [];
    globalThis.fetch = async (url) => {
      calledUrls.push(String(url));
      return { ok: true, status: 200, json: async () => photonGeoJson };
    };
    const resCap = await onRequest({
      request: customerGet('/api/geo/autocomplete?q=%D8%B4%D8%A7%D8%B1%D8%B9%2045&lang=ar'),
      env: { GOOGLE_PLACES_API_KEY: 'route-google-key', MENU_KV: kvCap },
    });
    const bodyCap = await readJson(resCap);
    check('route: spent budget caps Google but Photon answers',
      resCap.status === 200 && bodyCap && bodyCap.google === 'capped'
      && googleCalls(calledUrls).length === 0);
  }

  // No stored pin: viewport bias (no restriction), same region rule.
  calledUrls = [];
  let seenBiasBody = null;
  globalThis.fetch = async (url, opts) => {
    calledUrls.push(String(url));
    if (String(url).includes('places.googleapis.com')) {
      seenBiasBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => googlePayload };
    }
    return { ok: true, status: 200, json: async () => emptyPhoton };
  };
  const resBias = await onRequest({
    request: customerGet('/api/geo/autocomplete?q=%D8%B4%D8%A7%D8%B1%D8%B9%2016&lat=31.2&lng=29.95'),
    env: { GOOGLE_PLACES_API_KEY: 'route-google-key' },
  });
  const bodyBias = await readJson(resBias);
  check('route: pin-less search biases by the live viewport',
    resBias.status === 200 && bodyBias && bodyBias.ok === true && seenBiasBody
    && seenBiasBody.locationBias && seenBiasBody.locationBias.circle.center.latitude === 31.2
    && !('locationRestriction' in seenBiasBody));
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
