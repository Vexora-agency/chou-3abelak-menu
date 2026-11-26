/**
 * GET /api/geo/autocomplete?q=…&lang=…&country=…&lat=…&lng=…&session=…
 *
 * Multi-provider suggestion cascade. No provider key ever leaves the
 * server: the browser calls this route with only the customer CSRF header
 * (no session — guests also type delivery addresses), the route fans out
 * server-to-server and returns stripped rows plus verification flags.
 *
 * - q missing / <3 / >100 chars → 400 { error: 'invalid_query' }.
 * - Per-IP burst cap (60/min) plus a global daily cap
 *   (GEO_AC_DAILY_MAX, default 2500; Google calls have their own
 *   GOOGLE_PLACES_DAILY_MAX, default 300) → 429.
 *   Both ride the shared KV limiter, which fails OPEN when KV is missing.
 * - Success → 200 { ok:true, results, sources, google } via jsonNoStore.
 *   Failures degrade to thinner results, never to 5xx for missing keys:
 *   the search always answers with what the free passes found.
 *
 * Order: Google Places (primary external provider, session-billed,
 * biased by the live map viewport) → Google Text Search (up to 10 full
 * detailed places) → Photon (free, keyless smart-recall backstop) →
 * Nominatim full-text search (free, keyless; catches named POIs buried
 * mid-query that prefix indexes miss). Geoapify was retired from this
 * path by owner decision (module kept as tested standby).
 * The bias is the client's live map viewport (`lat`/`lng`) when supplied,
 * else the restaurant pin parsed from the stored menu.settings.mapUrl
 * with parseMapUrlCoordsJs (skipped when missing).
 * Responses and logs never carry keys, provider bodies, or the full query.
 * `sources` names the passes that answered (google/google-text/photon/nominatim);
 * `google` is off/rich/ok/empty/capped/error so the owner can confirm
 * the paid pass is actually armed.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { checkCustomerApiHeaders } from '../../_shared/auth-session.js';
import { hitRateLimit } from '../../_shared/ratelimit.js';
import { parseMapUrlCoordsJs } from '../../_shared/eta.js';
import {
  extractServiceCountries,
  mergeAutocompleteResults,
  MIN_RICH_RESULTS,
  normalizeCountryCodes,
  parseLatLng,
  validateAutocompleteQuery,
} from '../../_shared/geoapify.js';
import { fetchPhoton, buildQueryVariants, pickFallbackVariant, rankAppendedByDigits } from '../../_shared/photon.js';
import { fetchGoogleAutocomplete, fetchTextSearch, googleDailyMax, isGoogleConfigured, validateSessionToken } from '../../_shared/google.js';
import { fetchNominatim } from '../../_shared/nominatim.js';

const IP_RATE_MAX = 60;
const IP_RATE_WINDOW_SEC = 60;
const DAY_RATE_WINDOW_SEC = 86400;
const DEFAULT_DAILY_MAX = 2500;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function dailyMax(env) {
  const trim = (v) => (typeof v === 'string' ? v.trim() : v);
  // GEO_AC_DAILY_MAX is the current knob; the retired Geoapify name still
  // works as a fallback so older dashboards keep their cap.
  const raw = trim(env && (env.GEO_AC_DAILY_MAX ?? env.GEOAPIFY_DAILY_MAX));
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

  const rawLang = params.get('lang');
  const lang = typeof rawLang === 'string' && rawLang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
  const rawCountry = params.get('country');
  const clientCountry = typeof rawCountry === 'string' ? rawCountry : '';
  const sessionToken = validateSessionToken(params.get('session'));
  const menu = await readMenu(env);
  // Viewport bias first: when the customer is looking at a map area (the
  // picker sends its live center), rank nearby streets first instead of
  // the restaurant pin. Falls back to the restaurant pin when absent.
  // Deliberately a SOFT bias only — never a hard fence: undeliverable pins
  // are blocked at order submit (country/subdivision + maxKm check), while
  // hiding them from search would strand customers who typed correctly.
  const viewBias = parseLatLng(params.get('lat'), params.get('lng'));
  const pin = readBias(menu);
  const bias = viewBias || pin;
  const zoneCountries = extractServiceCountries(menu);
  const region = (zoneCountries.length > 0 ? zoneCountries[0] : normalizeCountryCodes(clientCountry)[0]) || '';

  // Non-sensitive source + Google-status trail for verification (never the
  // query or a key). The client ignores them; the owner reads them.
  // google: off (no key) | rich (free passes sufficed) | ok | empty |
  // capped (daily budget spent) | error (billing/API/quota on Google's side).
  const sources = [];
  let google = isGoogleConfigured(env) ? 'rich' : 'off';

  // Google Places is the primary external provider. One bounded call per
  // distinct query (debounced + cached client-side); coordinates resolve
  // once on pick. Free passes below cover thin results and capped budgets.
  let results = [];
  if (results.length < MIN_RICH_RESULTS && isGoogleConfigured(env)) {
    try {
      if (await hitRateLimit(kv, `geo-gg-day:${day}`, googleDailyMax(env), DAY_RATE_WINDOW_SEC)) {
        const g = await fetchGoogleAutocomplete(env, {
          text: q,
          lang,
          bias,
          region,
          sessionToken,
        });
        if (g && g.ok && Array.isArray(g.results) && g.results.length > 0) {
          results = mergeAutocompleteResults(results, g.results);
          sources.push('google');
          google = 'ok';
        } else if (g && g.ok) {
          google = 'empty';
        } else {
          google = 'error';
        }
      } else {
        google = 'capped';
      }
    } catch {
      google = 'error';
    }
  }
  // Text Search fallback for MORE detailed rows: autocomplete returns at
  // most 5 predictions BY DESIGN, so when it stays thin this pass fetches
  // up to 10 full places (name + formatted address + coordinates included —
  // no follow-up needed to pin). Bounded: queries under 6 chars and spent
  // budgets never reach Google; each call shares the same daily cap.
  if (results.length < MIN_RICH_RESULTS && isGoogleConfigured(env) && q.length >= 6) {
    try {
      if (await hitRateLimit(kv, `geo-gg-day:${day}`, googleDailyMax(env), DAY_RATE_WINDOW_SEC)) {
        const t = await fetchTextSearch(env, { text: q, lang, bias, region });
        if (t && t.ok && Array.isArray(t.results) && t.results.length > 0) {
          results = mergeAutocompleteResults(results, t.results);
          if (!sources.includes('google')) sources.push('google');
          sources.push('google-text');
          google = 'ok';
        }
      } else if (google === 'empty') {
        google = 'capped';
      }
    } catch {
      /* keep the autocomplete flag: the fallback alone must not rewrite it */
    }
  }
  // Free keyless backstop: when owner places + Google stay thin — typical
  // for numbered side streets the filtered index misses — run the same
  // query against Photon (Komoot OSM typeahead) and merge behind. Smart
  // recall: up to 2 calls over normalized/latinized/backoff variants;
  // fallback variants search streets only (osm_tag=highway); rows carrying
  // the query's street number rank first behind the earlier matches.
  if (results.length < MIN_RICH_RESULTS) {
    try {
      const zoneRows = [...results];
      let fresh = [];
      const variants = buildQueryVariants(q);
      // Full query first, then the sharpest suffix: a dialect spelling in
      // the area tokens must not cost the second (and last) deep call.
      const passes = [];
      if (variants.length > 0) passes.push(variants[0]);
      const fallback = pickFallbackVariant(variants);
      if (fallback && fallback !== passes[0]) passes.push(fallback);
      for (let vi = 0; vi < passes.length && vi < 2; vi += 1) {
        if (zoneRows.length + fresh.length >= MIN_RICH_RESULTS) break;
        // Fallback variants (shorter/latinized) search streets only: they
        // exist to surface named ways, not more cities or POIs.
        const deep = await fetchPhoton(null, {
          text: passes[vi],
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
      /* keep the Google results */
    }
  }
  // Final free pass — Nominatim full-text search. Autocomplete/typeahead
  // indexes match from the START of a record, so a named POI buried mid-query
  // («كنيسة الانبا اثناسيوس السيوف في الاسكندرية») can miss everywhere above
  // while a token search still finds it. Only for long specific queries,
  // throttled to the provider's 1 req/s policy (1 call per 2s per IP).
  if (results.length < MIN_RICH_RESULTS && q.trim().length >= 8) {
    try {
      if (await hitRateLimit(kv, `rl:geo-nm:${clientIp(request)}`, 1, 2)
        && await hitRateLimit(kv, `geo-nm-day:${day}`, dailyMax(env), DAY_RATE_WINDOW_SEC)) {
        const nm = await fetchNominatim(env, {
          text: q,
          lang,
          country: region || clientCountry,
          bias,
        });
        if (nm && nm.ok && Array.isArray(nm.results) && nm.results.length > 0) {
          results = mergeAutocompleteResults(results, nm.results);
          sources.push('nominatim');
        }
      }
    } catch {
      /* keep everything found so far */
    }
  }
  return jsonNoStore({ ok: true, results, sources, google });
}
