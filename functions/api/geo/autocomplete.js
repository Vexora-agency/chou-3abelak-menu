/**
 * GET /api/geo/autocomplete?q=…&lang=…&country=…
 *
 * Server-side Geoapify autocomplete proxy. The API key never leaves the
 * server: the browser calls this route with only the customer CSRF header
 * (no session — guests also type delivery addresses), the route calls
 * Geoapify with the key, strips the provider payload to
 * [{ label, line1, line2, lat, lng }], and returns that.
 *
 * - q missing / <3 / >100 chars → 400 { error: 'invalid_query' }.
 * - Per-IP burst cap (60/min) plus a global daily cap
 *   (GEOAPIFY_DAILY_MAX, default 2500) → 429 { error: 'rate_limited' }.
 *   Both ride the shared KV limiter, which fails OPEN when KV is missing.
 * - Key missing → 503 { error: 'autocomplete_unavailable' }.
 * - Upstream failure → 502 { error: 'autocomplete_failed' }.
 * - Success → 200 { ok: true, results } via jsonNoStore (no-store).
 *
 * Ranking combines owner places first, then a strict area filter with
 * proximity bias: owner-curated names («جنب فرن فلان») outrank every
 * provider; the filter is a circle around the restaurant pin with the
 * delivery radius when the pin is known (else the delivery-zone countries
 * — the phone-dial country is NOT used — else the client `country` hint,
 * else unfiltered). The bias is the client's live map viewport (`lat`/`lng`)
 * when supplied, else the restaurant pin parsed from the stored
 * menu.settings.mapUrl with parseMapUrlCoordsJs (skipped when missing).
 * Deep search: when the filtered pass returns fewer than MIN_RICH_RESULTS
 * rows, the same query runs once more unfiltered, then once in English for
 * Arabic queries (a different Geoapify index slice), then up to 2 keyless
 * Photon passes over smart recall variants — all merged behind the owner
 * and area matches, so side streets outside the list still surface.
 * Responses and logs never carry the key, the provider body, or the full query.
 * A non-sensitive `sources` trail names the passes that answered
 * (custom/geoapify/geoapify-open/geoapify-en/photon/google) for verification.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { checkCustomerApiHeaders } from '../../_shared/auth-session.js';
import { hitRateLimit } from '../../_shared/ratelimit.js';
import { parseMapUrlCoordsJs } from '../../_shared/eta.js';
import {
  extractServiceCountries,
  extractServiceRadiusM,
  fetchAutocomplete,
  isGeoapifyConfigured,
  mergeAutocompleteResults,
  MIN_RICH_RESULTS,
  normalizeCountryCodes,
  parseLatLng,
  validateAutocompleteQuery,
} from '../../_shared/geoapify.js';
import { fetchPhoton, buildQueryVariants, rankAppendedByDigits } from '../../_shared/photon.js';
import { fetchGoogleAutocomplete, googleDailyMax, isGoogleConfigured } from '../../_shared/google.js';
import { searchCustomPlaces, customPlaceToSuggestion } from '../../_shared/repositories/places.repo.js';

const IP_RATE_MAX = 60;
const IP_RATE_WINDOW_SEC = 60;
const DAY_RATE_WINDOW_SEC = 86400;
const DEFAULT_DAILY_MAX = 2500;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function dailyMax(env) {
  const raw = env && typeof env.GEOAPIFY_DAILY_MAX === 'string'
    ? env.GEOAPIFY_DAILY_MAX.trim()
    : env && env.GEOAPIFY_DAILY_MAX;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_MAX;
}

/**
 * Stored menu (best effort) — feeds the restaurant-pin bias and the
 * service-area country filter. Null when the KV/menu is missing.
 */
async function readMenu(env) {
  try {
    const kv = env ? env.MENU_KV : null;
    if (!kv || typeof kv.get !== 'function') return null;
    const menu = await kv.get('menu', { type: 'json' });
    return menu && typeof menu === 'object' ? menu : null;
  } catch {
    return null;
  }
}

/** Restaurant-pin bias from the stored menu (best effort). */
function readBias(menu) {
  try {
    const mapUrl = menu && menu.settings ? menu.settings.mapUrl : null;
    if (typeof mapUrl !== 'string' || !mapUrl) return null;
    const coords = parseMapUrlCoordsJs(mapUrl);
    if (!coords) return null;
    return { lng: coords.lng, lat: coords.lat };
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const gate = checkCustomerApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  let params;
  try {
    params = new URL(request.url).searchParams;
  } catch {
    return jsonNoStore({ error: 'invalid_query' }, 400);
  }
  const q = validateAutocompleteQuery(params.get('q'));
  if (!q) return jsonNoStore({ error: 'invalid_query' }, 400);

  const kv = env ? env.MENU_KV : null;
  if (!(await hitRateLimit(kv, `rl:geo-ac:${clientIp(request)}`, IP_RATE_MAX, IP_RATE_WINDOW_SEC))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }
  const day = new Date().toISOString().slice(0, 10);
  if (!(await hitRateLimit(kv, `geo-ac-day:${day}`, dailyMax(env), DAY_RATE_WINDOW_SEC))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }

  if (!isGeoapifyConfigured(env)) {
    return jsonNoStore({ error: 'autocomplete_unavailable' }, 503);
  }

  const rawLang = params.get('lang');
  const lang = typeof rawLang === 'string' && rawLang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
  const rawCountry = params.get('country');
  const clientCountry = typeof rawCountry === 'string' ? rawCountry : '';
  const menu = await readMenu(env);
  // Viewport bias first: when the customer is looking at a map area (the
  // picker sends its live center), rank nearby streets first instead of
  // the restaurant pin. Falls back to the restaurant pin when absent.
  const viewBias = parseLatLng(params.get('lat'), params.get('lng'));
  const pin = readBias(menu);
  const bias = viewBias || pin;
  // Primary filter: a circle around the restaurant pin with the delivery
  // radius (the served area itself) — strictly better than a country guess.
  // Without a stored pin, fall back to the delivery-zone countries (the
  // phone-dial country is NOT the service area), then the client hint.
  const radiusM = extractServiceRadiusM(menu);
  const circle = pin && radiusM ? { lat: pin.lat, lng: pin.lng, radiusM } : null;
  const zoneCountries = extractServiceCountries(menu);
  const countries = circle
    ? []
    : (zoneCountries.length > 0 ? zoneCountries : normalizeCountryCodes(clientCountry));

  // Owner-curated places first («جنب فرن فلان» beats any provider): the
  // names customers actually use, with the exact pin the owner dropped.
  // D1 missing/unreachable reads as empty — never a failure.
  let head = [];
  try {
    const db = env ? env.ORDERS_DB : null;
    if (db) {
      const places = await searchCustomPlaces(db, q, lang);
      head = (Array.isArray(places) ? places : [])
        .map((p) => customPlaceToSuggestion(p, lang))
        .filter(Boolean);
    }
  } catch {
    head = [];
  }

  let upstream;
  try {
    upstream = await fetchAutocomplete(env, { text: q, lang, countries, circle, bias });
  } catch {
    return jsonNoStore({ error: 'autocomplete_failed' }, 502);
  }
  if (!upstream || !upstream.ok) {
    if (upstream && upstream.error === 'not_configured') {
      return jsonNoStore({ error: 'autocomplete_unavailable' }, 503);
    }
    return jsonNoStore({ error: 'autocomplete_failed' }, 502);
  }
  let results = mergeAutocompleteResults(head, upstream.results);
  // Non-sensitive source trail for verification (which providers answered —
  // never the query or the key). The client ignores it; the owner reads it.
  const sources = [];
  if (head.length > 0) sources.push('custom');
  sources.push('geoapify');
  // Deep second pass: when the area filter leaves almost nothing (a side
  // street outside the radius, a new alley, a transliterated name),
  // run the same query unfiltered and append. Owner places and area
  // matches keep priority; rows dedupe by coordinates. Costs one extra
  // provider call only when the first pass is thin.
  if (results.length < MIN_RICH_RESULTS && (countries.length > 0 || circle)) {
    try {
      const open = await fetchAutocomplete(env, { text: q, lang, countries: [], circle: null, bias });
      if (open && open.ok) {
        results = mergeAutocompleteResults(results, open.results);
        sources.push('geoapify-open');
      }
    } catch {
      /* keep the first-pass results */
    }
  }
  // English retry for Arabic queries: Geoapify's Latin records are a
  // different index slice than Photon's — one bounded call surfaces them.
  if (results.length < MIN_RICH_RESULTS && lang === 'ar') {
    try {
      const en = await fetchAutocomplete(env, { text: q, lang: 'en', countries, circle, bias });
      if (en && en.ok) {
        results = mergeAutocompleteResults(results, en.results);
        sources.push('geoapify-en');
      }
    } catch {
      /* keep what we have */
    }
  }
  // Deep third pass (free, keyless): when both Geoapify passes stay thin —
  // typical for numbered side streets such as «شارع 16» that the filtered
  // index does not cover — run the same query against Photon (Komoot,
  // OSM typeahead) with the same viewport bias and merge behind. Smart
  // recall: up to 2 Photon calls over normalized/latinized/backoff query
  // variants (long 4-token queries almost never match one index record),
  // rows carrying the query's street number rank first, and a bbox around
  // the bias keeps namesake streets on other continents out.
  if (results.length < MIN_RICH_RESULTS) {
    try {
      const zoneRows = [...results];
      let fresh = [];
      const variants = buildQueryVariants(q).slice(0, 3);
      let photonCalls = 0;
      for (let vi = 0; vi < variants.length; vi += 1) {
        if (zoneRows.length + fresh.length >= MIN_RICH_RESULTS || photonCalls >= 2) break;
        photonCalls += 1;
        // Fallback variants (shorter/latinized) search streets only: they
        // exist to surface named ways, not more cities or POIs.
        const deep = await fetchPhoton(null, {
          text: variants[vi],
          lang,
          bias,
          osmTag: vi > 0 ? 'highway' : undefined,
        });
        if (!deep || !deep.ok || !Array.isArray(deep.results) || deep.results.length === 0) continue;
        fresh = mergeAutocompleteResults(fresh, deep.results);
      }
      if (fresh.length > 0) {
        const merged = mergeAutocompleteResults(zoneRows, fresh);
        results = rankAppendedByDigits(zoneRows, merged.slice(zoneRows.length), q);
        sources.push('photon');
      }
    } catch {
      /* keep the Geoapify results */
    }
  }
  // Paid last resort (Google Places, quota-guarded): only when every free
  // pass stays thin AND a key is configured. Coordinates resolve once on
  // pick via /api/geo/place-details — never per keystroke — and both call
  // types share one daily budget (GOOGLE_PLACES_DAILY_MAX, default 300).
  if (results.length < MIN_RICH_RESULTS && isGoogleConfigured(env)) {
    try {
      if (await hitRateLimit(kv, `geo-gg-day:${day}`, googleDailyMax(env), DAY_RATE_WINDOW_SEC)) {
        const g = await fetchGoogleAutocomplete(env, {
          text: q,
          lang,
          bias,
          region: zoneCountries.length > 0 ? zoneCountries[0] : clientCountry,
        });
        if (g && g.ok && Array.isArray(g.results) && g.results.length > 0) {
          results = mergeAutocompleteResults(results, g.results);
          sources.push('google');
        }
      }
    } catch {
      /* keep the free results */
    }
  }
  return jsonNoStore({ ok: true, results, sources });
}
