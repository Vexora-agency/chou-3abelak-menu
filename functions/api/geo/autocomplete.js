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
 * Ranking combines a strict country filter with proximity bias: the
 * filter comes from the delivery-zone countries (the service area —
 * the phone-dial country is NOT used), falling back to the client's
 * `country` hint only when zones are unknown; worldwide service means
 * no filter. The bias is best-effort: the restaurant pin is parsed
 * from the stored menu.settings.mapUrl with parseMapUrlCoordsJs and
 * skipped when the KV/menu/pin is missing or unparseable. Responses
 * and logs never carry the key, the provider body, or the full query.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { checkCustomerApiHeaders } from '../../_shared/auth-session.js';
import { hitRateLimit } from '../../_shared/ratelimit.js';
import { parseMapUrlCoordsJs } from '../../_shared/eta.js';
import {
  extractServiceCountries,
  fetchAutocomplete,
  isGeoapifyConfigured,
  normalizeCountryCodes,
  validateAutocompleteQuery,
} from '../../_shared/geoapify.js';

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
  const bias = readBias(menu);
  // Service-area countries first (the delivery-zone list is the source of
  // truth — the phone-dial country is NOT the service area); the client
  // hint is only a fallback when zones are unknown, and worldwide service
  // means no filter at all.
  const zoneCountries = extractServiceCountries(menu);
  const countries = zoneCountries.length > 0
    ? zoneCountries
    : normalizeCountryCodes(clientCountry);

  let upstream;
  try {
    upstream = await fetchAutocomplete(env, { text: q, lang, countries, bias });
  } catch {
    return jsonNoStore({ error: 'autocomplete_failed' }, 502);
  }
  if (!upstream || !upstream.ok) {
    if (upstream && upstream.error === 'not_configured') {
      return jsonNoStore({ error: 'autocomplete_unavailable' }, 503);
    }
    return jsonNoStore({ error: 'autocomplete_failed' }, 502);
  }
  return jsonNoStore({ ok: true, results: upstream.results });
}
