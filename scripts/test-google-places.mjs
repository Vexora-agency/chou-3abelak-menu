/**
 * Google Places last-resort pass (quota-guarded) contract.
 * Run: node scripts/test-google-places.mjs
 *
 * No network: upstream fetch is always injected or stubbed. Proves:
 *  - key gating (skip silently when unconfigured) and daily-budget default;
 *  - placeId validation edges; region code normalization;
 *  - predictions map to coordinate-less rows with placeId (details resolve
 *    once on pick, never per keystroke); details map to finite coords;
 *  - the key travels only in the X-Goog-Api-Key header (never URL/body);
 *  - autocomplete route: Google runs only when free passes stay thin, rows
 *    merge behind with placeId intact, skipped without a key;
 *  - place-details route: gate, 400/405/429/502/503, 200 exact shape.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAsserts, makeKV, readJson } from './_helpers/shared.mjs';
import {
  fetchGoogleAutocomplete,
  fetchPlaceDetails,
  googleDailyMax,
  isGoogleConfigured,
  normalizeRegionCode,
  sanitizeGooglePredictions,
  sanitizePlaceDetails,
  validatePlaceId,
} from '../functions/_shared/google.js';
import { onRequest as autocomplete } from '../functions/api/geo/autocomplete.js';
import { onRequest as placeDetails } from '../functions/api/geo/place-details.js';

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

const G_ENV = { GOOGLE_PLACES_API_KEY: 'test-google-key' };

/* ---------- config + validation ---------- */

check('configured with a key', isGoogleConfigured({ GOOGLE_PLACES_API_KEY: 'k' }));
check('not configured without a key', !isGoogleConfigured({}) && !isGoogleConfigured({ GOOGLE_PLACES_API_KEY: '   ' }));
check('daily budget defaults to 300', googleDailyMax({}) === 300);
check('daily budget reads env', googleDailyMax({ GOOGLE_PLACES_DAILY_MAX: '50' }) === 50);
check('daily budget clamps garbage', googleDailyMax({ GOOGLE_PLACES_DAILY_MAX: 'x' }) === 300);
check('placeId accepts tokens', validatePlaceId('ChIJN1t_tDeuEmsRMD9Q5I-qdUQ') !== null);
check('placeId rejects garbage', validatePlaceId('ab') === null && validatePlaceId(null) === null && validatePlaceId('has space here!!!!') === null);
check('region uppercases EG', normalizeRegionCode('eg') === 'EG');
check('region rejects junk', normalizeRegionCode('usa') === '' && normalizeRegionCode(null) === '');

/* ---------- mapping ---------- */

const predictions = {
  suggestions: [
    { placePrediction: { placeId: 'ChIJN1t_tDeuEmsRMD9Q5I-qdUQ', text: { text: 'شارع 16، السيوف، الإسكندرية' }, structuredFormat: { mainText: { text: 'شارع 16' }, secondaryText: { text: 'السيوف، الإسكندرية' } } } },
    { placePrediction: { placeId: 'short', text: { text: 'x' } } },
    { placePrediction: { text: { text: 'no id' } } },
    null,
  ],
};
const mapped = sanitizeGooglePredictions(predictions);
check('predictions map to coordinate-less rows with placeId',
  mapped.length === 1 && mapped[0].placeId === 'ChIJN1t_tDeuEmsRMD9Q5I-qdUQ'
  && mapped[0].lat === null && mapped[0].lng === null
  && mapped[0].line1 === 'شارع 16' && mapped[0].line2 === 'السيوف، الإسكندرية');
check('garbage predictions sanitize to []', sanitizeGooglePredictions(null).length === 0 && sanitizeGooglePredictions({}).length === 0);

check('details map to finite coords',
  JSON.stringify(sanitizePlaceDetails({ location: { latitude: 31.2, longitude: 29.95 }, displayName: { text: 'Street 16' }, formattedAddress: 'Street 16, El Soyouf' }))
  === JSON.stringify({ lat: 31.2, lng: 29.95, label: 'Street 16, El Soyouf' }));
check('details null without a location', sanitizePlaceDetails({}) === null && sanitizePlaceDetails(null) === null);

/* ---------- fetch units (mocked) ---------- */

let called = false;
const neverFetch = async () => {
  called = true;
  return { ok: true, status: 200, json: async () => ({}) };
};
called = false;
const noKey = await fetchGoogleAutocomplete({}, { text: 'شارع 16' }, neverFetch);
check('fetch: missing key is not_configured without network', !noKey.ok && noKey.error === 'not_configured' && !called);
called = false;
const badQ = await fetchGoogleAutocomplete(G_ENV, { text: 'ab' }, neverFetch);
check('fetch: short query is bad_query without network', !badQ.ok && badQ.error === 'bad_query' && !called);

let seenUrl = '';
let seenOpts = null;
const okFetch = async (url, opts) => {
  seenUrl = String(url);
  seenOpts = opts;
  return { ok: true, status: 200, json: async () => predictions };
};
const fetched = await fetchGoogleAutocomplete(G_ENV, { text: 'شارع 16', lang: 'ar', bias: { lat: 31.2, lng: 29.95 }, region: 'eg' }, okFetch);
check('fetch: success returns mapped rows', fetched.ok && fetched.results.length === 1 && fetched.results[0].placeId === 'ChIJN1t_tDeuEmsRMD9Q5I-qdUQ');
check('fetch: POST to the New API endpoint', seenOpts && seenOpts.method === 'POST' && seenUrl === 'https://places.googleapis.com/v1/places:autocomplete');
check('fetch: key travels only in the header', seenOpts && seenOpts.headers && seenOpts.headers['X-Goog-Api-Key'] === 'test-google-key'
  && !seenUrl.includes('test-google-key') && !JSON.stringify(seenOpts.body).includes('test-google-key'));
check('fetch: body carries input + language + region + bias', (() => {
  const b = JSON.parse(seenOpts.body);
  return b.input === 'شارع 16' && b.languageCode === 'ar'
    && JSON.stringify(b.includedRegionCodes) === JSON.stringify(['EG'])
    && b.locationBias && b.locationBias.circle && b.locationBias.circle.radius === 20000;
})());
const failFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
check('fetch: 500 maps to failed', !((await fetchGoogleAutocomplete(G_ENV, { text: 'شارع 16' }, failFetch))).ok);

const detFetch = async (url, opts) => {
  seenUrl = String(url);
  seenOpts = opts;
  return { ok: true, status: 200, json: async () => ({ location: { latitude: 31.2, longitude: 29.95 }, formattedAddress: 'Street 16' }) };
};
const det = await fetchPlaceDetails(G_ENV, { placeId: 'ChIJN1t_tDeuEmsRMD9Q5I-qdUQ' }, detFetch);
check('details: success returns coords', det.ok && det.lat === 31.2 && det.lng === 29.95);
check('details: key in header, id in path', seenOpts.headers['X-Goog-Api-Key'] === 'test-google-key'
  && seenUrl.includes('/v1/places/ChIJN1t_tDeuEmsRMD9Q5I-qdUQ'));
check('details: bad id never hits network', (await fetchPlaceDetails(G_ENV, { placeId: 'ab' }, neverFetch)).error === 'bad_query');

/* ---------- shared helper never logs ---------- */

check('shared helper never logs', !read('functions/_shared/google.js').includes('console.'));
check('details route never logs', !read('functions/api/geo/place-details.js').includes('console.'));

/* ---------- autocomplete route: Google last resort ---------- */

const originalFetch = globalThis.fetch;
try {
  const kv = makeKV();
  await kv.put('menu', JSON.stringify({ settings: { mapUrl: 'https://www.google.com/maps/@31.2056,29.9246,15z', ordering: { deliveryZones: { mode: 'selected', countries: [{ cc: 'EG' }] } } } }));
  const thinGeo = { results: [{ formatted: 'El Soyouf, Alexandria, Egypt', address_line1: 'El Soyouf', address_line2: 'Alexandria, Egypt', lat: 31.2, lon: 29.95 }] };
  let googleCalls = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('places.googleapis.com')) {
      googleCalls.push({ url: u, opts });
      return { ok: true, status: 200, json: async () => predictions };
    }
    if (u.includes('photon.komoot.io')) return { ok: true, status: 200, json: async () => ({ features: [] }) };
    return { ok: true, status: 200, json: async () => thinGeo };
  };
  const env = { GEOAPIFY_API_KEY: 'route-key-xyz', GOOGLE_PLACES_API_KEY: 'route-google-key', MENU_KV: kv };
  const res = await autocomplete({ request: customerGet('/api/geo/autocomplete?q=%D8%B4%D8%A7%D8%B1%D8%B9%2016&lang=ar&country=eg'), env });
  const body = await readJson(res);
  const googleRows = (body.results || []).filter((r) => r.placeId);
  check('route: thin free passes trigger one Google call',
    res.status === 200 && body.ok === true && googleCalls.length === 1);
  check('route: Google rows merge behind with placeId and null coords',
    googleRows.length === 1 && googleRows[0].lat === null && googleRows[0].line1 === 'شارع 16');
  check('route: sources trail includes google', Array.isArray(body.sources) && body.sources.includes('google'));
  check('route: Google key never leaks into URLs or the response',
    !googleCalls[0].url.includes('route-google-key') && !JSON.stringify(body).includes('route-google-key'));

  // No key → no Google call, free stack alone.
  googleCalls = [];
  const resNoKey = await autocomplete({ request: customerGet('/api/geo/autocomplete?q=%D8%B4%D8%A7%D8%B1%D8%B9%2016&lang=ar&country=eg'), env: { GEOAPIFY_API_KEY: 'route-key-xyz', MENU_KV: kv } });
  check('route: unconfigured Google is skipped silently', resNoKey.status === 200 && googleCalls.length === 0);
} finally {
  globalThis.fetch = originalFetch;
}

/* ---------- place-details route ---------- */

const noHeader = await placeDetails({ request: new Request('https://example.com/api/geo/place-details?placeId=ChIJN1t_tDeuEmsRMD9Q5I-qdUQ'), env: {} });
check('route: missing customer header is 400', noHeader.status === 400);
const postRes = await placeDetails({
  request: new Request('https://example.com/api/geo/place-details?placeId=ChIJN1t_tDeuEmsRMD9Q5I-qdUQ', { method: 'POST', headers: { 'X-Requested-With': 'menu-customer' } }),
  env: {},
});
check('route: POST is 405 with Allow GET', postRes.status === 405 && postRes.headers.get('Allow') === 'GET');

for (const bad of ['placeId=ab', '']) {
  const res = await placeDetails({ request: customerGet(`/api/geo/place-details?${bad}`), env: G_ENV });
  const body = await readJson(res);
  check(`route: invalid placeId (${bad.slice(0, 10) || 'missing'}) is 400 invalid_query`,
    res.status === 400 && body && body.error === 'invalid_query');
}

const detOriginal = globalThis.fetch;
try {
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ location: { latitude: 31.2, longitude: 29.95 }, displayName: { text: 'Street 16' }, formattedAddress: 'Street 16, El Soyouf' }),
  });
  const res = await placeDetails({ request: customerGet('/api/geo/place-details?placeId=ChIJN1t_tDeuEmsRMD9Q5I-qdUQ'), env: G_ENV });
  const body = await readJson(res);
  check('route: success is 200 with exact coords + label',
    res.status === 200 && body && body.ok === true && body.lat === 31.2 && body.lng === 29.95 && body.label === 'Street 16, El Soyouf');
  check('route: success is no-store JSON', res.headers.get('Cache-Control') === 'no-store'
    && (res.headers.get('Content-Type') || '').includes('application/json'));

  const noKeyRes = await placeDetails({ request: customerGet('/api/geo/place-details?placeId=ChIJN1t_tDeuEmsRMD9Q5I-qdUQ'), env: {} });
  check('route: missing key is 503 place_unavailable', noKeyRes.status === 503);

  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const failRes = await placeDetails({ request: customerGet('/api/geo/place-details?placeId=ChIJN1t_tDeuEmsRMD9Q5I-qdUQ'), env: G_ENV });
  check('route: upstream failure is 502 place_failed', failRes.status === 502);
} finally {
  globalThis.fetch = detOriginal;
}

{
  const kv = makeKV();
  await kv.put('rl:geo-ggpd:9.9.9.9', '60');
  const res = await placeDetails({ request: customerGet('/api/geo/place-details?placeId=ChIJN1t_tDeuEmsRMD9Q5I-qdUQ', { ip: '9.9.9.9' }), env: { ...G_ENV, MENU_KV: kv } });
  check('route: per-IP burst cap denies with 429 rate_limited', res.status === 429);
}
{
  const kv = makeKV();
  const day = new Date().toISOString().slice(0, 10);
  await kv.put(`geo-gg-day:${day}`, '300');
  const res = await placeDetails({ request: customerGet('/api/geo/place-details?placeId=ChIJN1t_tDeuEmsRMD9Q5I-qdUQ'), env: { ...G_ENV, MENU_KV: kv } });
  check('route: shared Google daily cap denies with 429 rate_limited', res.status === 429);
}

summary();
