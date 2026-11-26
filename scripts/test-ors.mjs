/**
 * OpenRouteService (hosted Pelias) keyed-pass contract.
 * Run: node scripts/test-ors.mjs
 *
 * No network: upstream fetch is always injected or stubbed. Proves:
 *  - key gating (skip silently when unconfigured) and daily-budget default;
 *  - country allow-list + focus-point shaping, key only in Authorization;
 *  - features map to coordinate-carrying rows (no follow-up call needed);
 *  - route: ORS leads when configured, caps degrade to free passes.
 */

import { createAsserts, makeKV, readJson } from './_helpers/shared.mjs';
import {
  ORS_RESULT_LIMIT,
  buildOrsAutocompleteUrl,
  expandAdminAbbreviations,
  fetchOrsAutocomplete,
  isOrsConfigured,
  normalizeOrsCountries,
  normalizeOrsLang,
  orsDailyMax,
  sanitizeOrsResults,
} from '../functions/_shared/ors.js';
import { onRequest } from '../functions/api/geo/autocomplete.js';

const { ok: check, summary } = createAsserts();

const KEY_ENV = { ORS_API_KEY: 'ors-test-key' };

check('unconfigured without a key', !isOrsConfigured({}) && !isOrsConfigured({ ORS_API_KEY: '  ' }));
check('configured with a key', isOrsConfigured(KEY_ENV));
check('daily budget defaults to the plan quota', orsDailyMax({}) === 3000 && orsDailyMax(KEY_ENV) === 3000);
check('daily budget honors env', orsDailyMax({ ORS_GEOCODING_DAILY_MAX: '500' }) === 500);
check('lang passes ar, falls back to en', normalizeOrsLang('ar') === 'ar' && normalizeOrsLang('fr') === 'en');
check('countries accept the admin zone list', JSON.stringify(normalizeOrsCountries(['lb', 'EG', 'lb', 'usa'])) === JSON.stringify(['LB', 'EG']));
check('result limit is 10', ORS_RESULT_LIMIT === 10);
check('short queries rejected without network', buildOrsAutocompleteUrl({ text: 'ab' }) === null);

{
  const u = new URL(buildOrsAutocompleteUrl({
    text: 'شارع 105', lang: 'ar', bias: { lat: 33.8804, lng: 35.5466 }, regions: ['lb', 'EG'],
  }));
  check('url hits the hosted Pelias autocomplete', u.origin === 'https://api.heigit.org' && u.pathname === '/pelias/v1/autocomplete');
  check('url carries text + lang + size + country allow-list',
    u.searchParams.get('text') === 'شارع 105' && u.searchParams.get('lang') === 'ar'
    && u.searchParams.get('size') === '10' && u.searchParams.get('boundary.country') === 'LB,EG');
  check('url biases with a soft focus point (never a fence)',
    u.searchParams.get('focus.point.lat') === '33.8804' && u.searchParams.get('focus.point.lon') === '35.5466');
  check('url carries no key material', !u.toString().includes('key'));
}

const peliasPayload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [35.5466, 33.8804] },
      properties: {
        name: 'Dekwaneh', label: 'Dekwaneh, Metn, Mount Lebanon, Lebanon',
        locality: 'Dekwaneh', county: 'Metn', region: 'Mount Lebanon', country: 'Lebanon', country_a: 'LB',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [35.55, 33.88] },
      properties: { name: 'Street 105', label: 'Street 105, Dekwaneh, Lebanon' },
    },
    { type: 'Feature', geometry: null, properties: { label: 'Nowhere' } },
    { type: 'Feature', properties: { label: 'No geometry' } },
    null,
  ],
};

{
  const rows = sanitizeOrsResults(peliasPayload);
  check('sanitizer maps Pelias features with coordinates',
    rows.length === 2 && rows[0].line1 === 'Dekwaneh'
    && rows[0].label.includes('Mount Lebanon') && rows[0].lat === 33.8804 && rows[0].lng === 35.5466);
  check('sanitizer keeps the street row second', rows[1].line1 === 'Street 105');
  check('garbage sanitizes to []', sanitizeOrsResults(null).length === 0 && sanitizeOrsResults({}).length === 0);
check('admin abbreviations expand to Arabic (JL → جبل لبنان)',
  expandAdminAbbreviations('سيتي راما دكوانه, JL, لبنان') === 'سيتي راما دكوانه, جبل لبنان, لبنان'
  && expandAdminAbbreviations('شارع الجلاء, بيروت, لبنان') === 'شارع الجلاء, بيروت, لبنان'
  && expandAdminAbbreviations(null) === null);
  const many = {
    type: 'FeatureCollection',
    features: Array.from({ length: 20 }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [35 + i * 0.01, 33 + i * 0.01] },
      properties: { label: `Place ${i}, Lebanon`, name: `Place ${i}` },
    })),
  };
  check('sanitizer caps at the result limit', sanitizeOrsResults(many).length === ORS_RESULT_LIMIT);
}

let called = false;
const neverFetch = async () => {
  called = true;
  return { ok: true, status: 200, json: async () => ({}) };
};
called = false;
check('fetch: bad query never hits network', (await fetchOrsAutocomplete(KEY_ENV, { text: 'ab' }, neverFetch)).error === 'bad_query' && !called);
check('fetch: unconfigured never hits network', (await fetchOrsAutocomplete({}, { text: 'دكوانة' }, neverFetch)).error === 'not_configured' && !called);

{
  let seenUrl = '';
  let seenHeaders = null;
  let seenBody = null;
  const fetched = await fetchOrsAutocomplete(
    KEY_ENV,
    { text: 'دكوانة', lang: 'ar', bias: { lat: 33.88, lng: 35.55 }, regions: ['LB'] },
    async (url, opts) => {
      seenUrl = String(url);
      seenHeaders = opts && opts.headers ? opts.headers : null;
      try {
        seenBody = opts && opts.body ? opts.body : null;
      } catch {
        seenBody = null;
      }
      return { ok: true, status: 200, json: async () => peliasPayload };
    },
  );
  check('fetch: success returns mapped rows with coordinates',
    fetched.ok && fetched.results.length === 2 && fetched.results[0].lat === 33.8804);
  check('fetch: key travels only in the Authorization header (never URL/body)',
    seenHeaders && seenHeaders.Authorization === 'ors-test-key'
    && !seenUrl.includes('ors-test-key') && !String(seenBody).includes('ors-test-key'));
  check('fetch: 500 maps to failed', !(await fetchOrsAutocomplete(KEY_ENV, { text: 'دكوانة' }, async () => ({ ok: false, status: 500, json: async () => ({}) }))).ok);
  check('fetch: 401 maps to denied (key rejected)',
    (await fetchOrsAutocomplete(KEY_ENV, { text: 'دكوانة' }, async () => ({ ok: false, status: 401, json: async () => ({ error: 'Authorization field missing' }) }))).error === 'denied');
  check('fetch: 403 maps to denied (key rejected)',
    (await fetchOrsAutocomplete(KEY_ENV, { text: 'دكوانة' }, async () => ({ ok: false, status: 403, json: async () => ({}) }))).error === 'denied');
}

const src = (await import('node:fs')).readFileSync(
  (await import('node:path')).join((await import('node:path')).dirname((await import('node:url')).fileURLToPath(import.meta.url)), '..', 'functions', '_shared', 'ors.js'),
  'utf8',
);
check('shared helper never logs', !src.includes('console.'));
check('shared helper never mentions the key name in code paths', !/apiKey|api_key/i.test(src.replace(/ORS_API_KEY/g, '')));

// Route integration: ORS leads when configured.
{
  const kv = makeKV();
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.heigit.org/geocode/autocomplete')) {
        return { ok: true, status: 200, json: async () => peliasPayload };
      }
      if (u.includes('photon.komoot.io')) return { ok: true, status: 200, json: async () => ({ features: [] }) };
      if (u.includes('nominatim.openstreetmap.org')) return { ok: true, status: 200, json: async () => [] };
      if (u.includes('places.googleapis.com')) return { ok: true, status: 200, json: async () => ({ suggestions: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const res = await onRequest({
      request: new Request('https://example.com/api/geo/autocomplete?q=' + encodeURIComponent('دكوانة') + '&lang=ar&country=lb', {
        headers: { 'X-Requested-With': 'menu-customer' },
      }),
      env: { ORS_API_KEY: 'route-ors-key', MENU_KV: kv },
    });
    const body = await readJson(res);
    check('route: ORS leads as the primary keyed pass with coordinates',
      res.status === 200 && body && body.ok === true && body.ors === 'ok'
      && Array.isArray(body.sources) && body.sources[0] === 'ors'
      && body.results.length > 0 && typeof body.results[0].lat === 'number');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// Route integration: spent ORS budget degrades to the free passes.
{
  const kv = makeKV();
  const day = new Date().toISOString().slice(0, 10);
  await kv.put(`geo-ors-day:${day}`, '3000');
  const origFetch = globalThis.fetch;
  try {
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      const u = String(url);
      if (u.includes('photon.komoot.io')) {
        return {
          ok: true, status: 200, json: async () => ({
            features: [{ properties: { name: 'Street 105', city: 'Dekwaneh' }, geometry: { coordinates: [35.55, 33.88] } }],
          }),
        };
      }
      if (u.includes('nominatim.openstreetmap.org')) return { ok: true, status: 200, json: async () => [] };
      if (u.includes('places.googleapis.com')) return { ok: true, status: 200, json: async () => ({ suggestions: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const res = await onRequest({
      request: new Request('https://example.com/api/geo/autocomplete?q=' + encodeURIComponent('شارع 105') + '&lang=ar&country=lb', {
        headers: { 'X-Requested-With': 'menu-customer' },
      }),
      env: { ORS_API_KEY: 'route-ors-key', MENU_KV: kv },
    });
    const body = await readJson(res);
    check('route: spent ORS budget caps ORS but Photon answers',
      res.status === 200 && body && body.ors === 'capped'
      && !seen.some((u) => u.includes('api.heigit.org')));
  } finally {
    globalThis.fetch = origFetch;
  }
}

// Route integration: a rejected key surfaces as denied (not a wiring bug).
{
  const kv = makeKV();
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.heigit.org')) {
        return { ok: false, status: 401, json: async () => ({ error: 'Authorization field missing' }) };
      }
      if (u.includes('photon.komoot.io')) return { ok: true, status: 200, json: async () => ({ features: [] }) };
      if (u.includes('nominatim.openstreetmap.org')) return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const res = await onRequest({
      request: new Request('https://example.com/api/geo/autocomplete?q=' + encodeURIComponent('دكوانة') + '&lang=ar&country=lb', {
        headers: { 'X-Requested-With': 'menu-customer' },
      }),
      env: { ORS_API_KEY: 'route-ors-key', MENU_KV: kv },
    });
    const body = await readJson(res);
    check('route: rejected ORS key reports denied',
      res.status === 200 && body && body.ors === 'denied' && !(body.sources || []).includes('ors'));
  } finally {
    globalThis.fetch = origFetch;
  }
}

summary();
