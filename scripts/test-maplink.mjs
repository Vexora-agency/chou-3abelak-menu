/**
 * Google Maps shared-link resolver contract.
 * Run: node scripts/test-maplink.mjs
 *
 * No network: fetch is stubbed. Proves URL validation (allowlist only),
 * coordinate extraction from @lat,lng / !3d/!4d / ?q= forms, zone verdicts
 * (inside / outside / unknown), and the route's gate + shapes.
 */

import { createAsserts, makeKV, readJson } from './_helpers/shared.mjs';
import {
  extractCoordsFromGoogleUrl,
  isAllowedMapsHost,
  validateMapsLinkUrl,
} from '../functions/_shared/maplink.js';
import { onRequest } from '../functions/api/geo/resolve-link.js';

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

/* ---------- pure URL helpers ---------- */

check('allows google maps hosts', isAllowedMapsHost('maps.app.goo.gl') && isAllowedMapsHost('WWW.GOOGLE.COM'));
check('rejects other hosts', !isAllowedMapsHost('evil.com') && !isAllowedMapsHost('') && !isAllowedMapsHost(null));
check('accepts a full maps URL', validateMapsLinkUrl('https://www.google.com/maps/place/X/@31.2056,29.9246,17z') !== null);
check('accepts a short link', validateMapsLinkUrl('https://maps.app.goo.gl/AbC123xYz') !== null);
check('rejects garbage and off-host links', validateMapsLinkUrl('not a url') === null
  && validateMapsLinkUrl('https://evil.com/maps/@1,2,3z') === null
  && validateMapsLinkUrl('ftp://maps.google.com/x') === null
  && validateMapsLinkUrl('x'.repeat(2001)) === null);
check('extracts @lat,lng', JSON.stringify(extractCoordsFromGoogleUrl('https://www.google.com/maps/place/X/@31.20561,29.92459,17z/data')) === JSON.stringify({ lat: 31.20561, lng: 29.92459 }));
check('extracts !3d/!4d', JSON.stringify(extractCoordsFromGoogleUrl('https://www.google.com/maps/place/X/data=!3m2!4b1!4m6!3m5!1sABC!8m2!3d31.2!4d29.95')) === JSON.stringify({ lat: 31.2, lng: 29.95 }));
check('extracts ?q= pair', JSON.stringify(extractCoordsFromGoogleUrl('https://www.google.com/maps?q=31.1,29.9')) === JSON.stringify({ lat: 31.1, lng: 29.9 }));
check('rejects out-of-range and missing coords', extractCoordsFromGoogleUrl('https://www.google.com/maps/place/X/@91,0,10z') === null
  && extractCoordsFromGoogleUrl('https://www.google.com/maps/search/foobar') === null
  && extractCoordsFromGoogleUrl(null) === null);

/* ---------- route ---------- */

const noHeader = await onRequest({ request: new Request('https://example.com/api/geo/resolve-link?url=https://maps.app.goo.gl/x'), env: {} });
check('route: missing customer header is 400', noHeader.status === 400);
const postRes = await onRequest({
  request: new Request('https://example.com/api/geo/resolve-link?url=https://maps.app.goo.gl/x', {
    method: 'POST',
    headers: { 'X-Requested-With': 'menu-customer' },
  }),
  env: {},
});
check('route: POST is 405 with Allow GET', postRes.status === 405 && postRes.headers.get('Allow') === 'GET');

for (const bad of ['url=' + encodeURIComponent('not a url'), 'url=' + encodeURIComponent('https://evil.com/maps/@1,2,3z'), '']) {
  const res = await onRequest({ request: customerGet(`/api/geo/resolve-link?${bad}`), env: {} });
  check(`route: bad link (${bad.slice(0, 12) || 'missing'}) is 400 invalid_link`, res.status === 400);
}

const originalFetch = globalThis.fetch;
try {
  const kv = makeKV();
  await kv.put('menu', JSON.stringify({ settings: { ordering: { deliveryZones: { mode: 'selected', countries: [{ cc: 'EG' }] } } } }));
  const env = { MENU_KV: kv };
  // Short link -> redirect target carries @coords; reverse says EG.
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nominatim')) {
      return { ok: true, status: 200, json: async () => ({ address: { country_code: 'eg', city: 'Alexandria' } }) };
    }
    return { ok: true, status: 200, url: 'https://www.google.com/maps/place/X/@31.2056,29.9246,17z/data=!x', json: async () => ({}) };
  };
  const res = await onRequest({ request: customerGet(`/api/geo/resolve-link?url=${encodeURIComponent('https://maps.app.goo.gl/AbC123')}`), env });
  const body = await readJson(res);
  check('route: short link resolves to coordinates inside the zone',
    res.status === 200 && body && body.ok === true && body.lat === 31.2056 && body.lng === 29.9246 && body.outside === false);

  // Full URL works even when the fetch itself fails (no redirect to follow).
  globalThis.fetch = async (url) => {
    if (String(url).includes('nominatim')) {
      return { ok: true, status: 200, json: async () => ({ address: { country_code: 'lb' } }) };
    }
    throw new Error('offline');
  };
  const resFull = await onRequest({
    request: customerGet(`/api/geo/resolve-link?url=${encodeURIComponent('https://www.google.com/maps/place/Y/@33.8938,35.5018,15z')}`),
    env,
  });
  const bodyFull = await readJson(resFull);
  check('route: full URL needs no network and flags outside zones',
    resFull.status === 200 && bodyFull && bodyFull.lat === 33.8938 && bodyFull.outside === true);

  // Unresolvable target -> 404, never echoes the URL.
  globalThis.fetch = async () => ({ ok: true, status: 200, url: 'https://www.google.com/maps/search/foobar', json: async () => ({}) });
  const res404 = await onRequest({ request: customerGet('/api/geo/resolve-link?url=' + encodeURIComponent('https://maps.app.goo.gl/AbC123')), env });
  check('route: coords-less target is 404 without echoing the link',
    res404.status === 404 && !JSON.stringify(await readJson(res404)).includes('AbC123'));
} finally {
  globalThis.fetch = originalFetch;
}

summary();
