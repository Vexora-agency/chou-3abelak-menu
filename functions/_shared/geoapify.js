/**
 * Geoapify address-autocomplete proxy helpers (pure, no dependencies).
 *
 * The browser never talks to Geoapify directly: the API key lives only in
 * the Pages `env` and rides server-to-server inside
 * `functions/api/geo/autocomplete.js`. Everything that crosses back to the
 * client is the stripped shape produced by `sanitizeAutocompleteResults`:
 * [{ label, line1, line2, lat, lng }].
 *
 * Conventions (mirror functions/_shared/unimtx.js): per-request env reads
 * with trim, fail-closed generic errors, 6s AbortController timeouts, and
 * NEVER any logging of the API key or the query text.
 */

const GEOAPIFY_BASE = 'https://api.geoapify.com/v1/geocode/autocomplete';
const REQUEST_TIMEOUT_MS = 6000;
const MAX_LABEL_CHARS = 120;
/** Max suggestions returned per search (room for street-level rows). */
export const RESULT_LIMIT = 20;
/**
 * Rich-enough threshold: when the zone-filtered pass returns fewer rows
 * than this, the server runs a second unfiltered pass (same query + bias)
 * and merges — deep side-street search without losing zone priority.
 */
export const MIN_RICH_RESULTS = 3;

/** Trimmed string env read (per request). Returns '' when missing. */
export function trimEnv(env, key) {
  const value = env && typeof env[key] === 'string' ? env[key].trim() : '';
  return value;
}

/** True when a non-empty GEOAPIFY_API_KEY is present. */
export function isGeoapifyConfigured(env) {
  return !!trimEnv(env, 'GEOAPIFY_API_KEY');
}

/** Lowercase 2-letter country list (unique, capped at 10). Accepts a
 *  single code, an array, or anything else (→ []). */
export function normalizeCountryCodes(value) {
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const code = v.trim().toLowerCase();
    if (/^[a-z]{2}$/.test(code) && !out.includes(code)) out.push(code);
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * Service-area countries from the stored menu (delivery zones). Only the
 * explicit `selected` zone list counts — anything else means worldwide
 * service and must NOT filter. Returns [] when unknown.
 */
export function extractServiceCountries(menu) {
  try {
    const settings = menu && typeof menu === 'object' ? menu.settings : null;
    const ordering = settings && typeof settings === 'object' ? settings.ordering : null;
    const zones = ordering && typeof ordering === 'object' ? ordering.deliveryZones : null;
    if (!zones || typeof zones !== 'object' || zones.mode !== 'selected') return [];
    const list = Array.isArray(zones.countries) ? zones.countries : [];
    return normalizeCountryCodes(list.map((c) => (c && typeof c === 'object' ? c.cc : c)));
  } catch {
    return [];
  }
}

/**
 * Trimmed query when it is a 3..100 char string, else null.
 * The route maps null to 400 { error: 'invalid_query' }.
 */
export function validateAutocompleteQuery(q) {
  if (typeof q !== 'string') return null;
  const text = q.trim();
  if (text.length < 3 || text.length > 100) return null;
  return text;
}

/**
 * Build the Geoapify autocomplete URL. Returns null when the query is
 * invalid or the key is missing (callers map that to bad_query, never to
 * a thrown error).
 *
 * - lang: 'ar' passes through, everything else falls back to 'en'.
 * - country/countries: lowercased 2-letter codes, sent as
 *   filter=countrycode:xx[,yy] (Geoapify accepts comma-separated codes).
 *   Anything else is dropped (fail open: the search still runs, just
 *   unfiltered).
 * - bias: { lng, lat } finite numbers only, sent as
 *   bias=proximity:LON,LAT (longitude first, per the Geoapify contract).
 */
export function buildAutocompleteUrl(env, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const text = validateAutocompleteQuery(opts.text);
  if (!text) return null;
  const apiKey = trimEnv(env, 'GEOAPIFY_API_KEY');
  if (!apiKey) return null;
  const langRaw = typeof opts.lang === 'string' ? opts.lang.trim().toLowerCase() : '';
  const lang = langRaw === 'ar' ? 'ar' : 'en';
  const params = new URLSearchParams();
  params.set('text', text);
  params.set('format', 'json');
  params.set('apiKey', apiKey);
  params.set('lang', lang);
  params.set('limit', String(RESULT_LIMIT));
  const codes = normalizeCountryCodes(
    Array.isArray(opts.countries) ? opts.countries : opts.country,
  );
  if (codes.length > 0) {
    params.set('filter', `countrycode:${codes.join(',')}`);
  }
  const bias = opts.bias && typeof opts.bias === 'object' ? opts.bias : null;
  const lng = bias ? bias.lng : NaN;
  const lat = bias ? bias.lat : NaN;
  if (
    typeof lng === 'number' && Number.isFinite(lng) &&
    typeof lat === 'number' && Number.isFinite(lat)
  ) {
    params.set('bias', `proximity:${lng},${lat}`);
  }
  return `${GEOAPIFY_BASE}?${params.toString()}`;
}

/**
 * Strip a Geoapify format=json payload down to the client-safe shape.
 * Drops rows without a non-empty formatted label or finite lat/lon, and
 * strips provider-only fields (rank, datasource, result_type, …).
 * Keeps label/line1/line2/lat/lng plus an optional `details` string built
 * from side-street parts (house number, street, suburb, district, city,
 * postcode) so small alleys stay distinguishable. Never throws for
 * garbage input — returns [].
 */
export function sanitizeAutocompleteResults(json) {
  const raw = json && typeof json === 'object' && Array.isArray(json.results) ? json.results : [];
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.formatted !== 'string') continue;
    const label = row.formatted.trim().slice(0, MAX_LABEL_CHARS);
    if (!label) continue;
    if (typeof row.lat !== 'number' || !Number.isFinite(row.lat)) continue;
    if (typeof row.lon !== 'number' || !Number.isFinite(row.lon)) continue;
    const line1 = typeof row.address_line1 === 'string' ? row.address_line1 : '';
    let line2 = typeof row.address_line2 === 'string' ? row.address_line2 : '';
    const details = buildDetails(row);
    // Side-street fallback: when the provider leaves line2 empty (common
    // for street/building rows), reuse the composed details so the row
    // still shows neighbourhood/city context instead of a bare street.
    if (!line2 && details) line2 = details;
    const item = {
      label,
      line1,
      line2,
      lat: row.lat,
      lng: row.lon,
    };
    if (details && details !== line2) item.details = details;
    else if (details) item.details = details;
    out.push(item);
  }
  return out;
}

/**
 * Parse a client map-viewport bias (strings or numbers). Returns rounded
 * { lat, lng } or null when either side is missing, non-numeric or
 * out of range. Used so a search follows the map the customer is looking
 * at instead of always the restaurant pin.
 */
export function parseLatLng(latRaw, lngRaw) {
  const lat = typeof latRaw === 'string' ? Number(latRaw.trim()) : latRaw;
  const lng = typeof lngRaw === 'string' ? Number(lngRaw.trim()) : lngRaw;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

/** Dedup key for merging two autocomplete passes (coords first, label fallback). */
function resultKey(row) {
  if (!row || typeof row !== 'object') return '';
  if (typeof row.lat === 'number' && Number.isFinite(row.lat) && typeof row.lng === 'number' && Number.isFinite(row.lng)) {
    return `${row.lat.toFixed(4)},${row.lng.toFixed(4)}`;
  }
  return typeof row.label === 'string' && row.label ? `t:${row.label}` : '';
}

/**
 * Merge a second (unfiltered) autocomplete pass behind a first
 * (zone-filtered) one: zone matches keep their priority, new rows append
 * deduplicated, total capped at RESULT_LIMIT. Never throws.
 */
export function mergeAutocompleteResults(primary, secondary, limit = RESULT_LIMIT) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : RESULT_LIMIT;
  const out = Array.isArray(primary) ? [...primary] : [];
  const seen = new Set();
  for (const r of out) {
    const k = resultKey(r);
    if (k) seen.add(k);
  }
  const rest = Array.isArray(secondary) ? secondary : [];
  for (const r of rest) {
    const k = resultKey(r);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= cap) break;
  }
  return out.slice(0, cap);
}

/**
 * Compose a short side-street context from Geoapify address parts.
 * Example: "12, Gouraud Street, Mar Mikhael, Beirut" from housenumber +
 * street + suburb + city. Deduplicated, capped at 120 chars, '' when empty.
 */
function buildDetails(row) {
  try {
    const parts = [];
    const push = (v) => {
      if (typeof v !== 'string') return;
      const t = v.trim();
      if (!t) return;
      if (parts.some((p) => p.toLowerCase() === t.toLowerCase())) return;
      parts.push(t);
    };
    const hn = typeof row.housenumber === 'string' ? row.housenumber.trim() : '';
    const st = typeof row.street === 'string' ? row.street.trim() : '';
    if (hn && st) push(`${hn} ${st}`);
    else {
      push(hn);
      push(st);
    }
    push(typeof row.suburb === 'string' ? row.suburb : '');
    push(typeof row.neighbourhood === 'string' ? row.neighbourhood : '');
    push(typeof row.district === 'string' ? row.district : '');
    push(typeof row.city === 'string' ? row.city : '');
    push(typeof row.town === 'string' ? row.town : '');
    push(typeof row.village === 'string' ? row.village : '');
    push(typeof row.postcode === 'string' ? row.postcode : '');
    if (parts.length === 0) return '';
    return parts.slice(0, 5).join(', ').slice(0, MAX_LABEL_CHARS);
  } catch {
    return '';
  }
}

/**
 * Server-side autocomplete call. Never throws and never logs the key or
 * the query text. Result: { ok: true, results } or
 * { ok: false, error: 'not_configured' | 'bad_query' | 'failed' }.
 * Non-OK status, 429, 5xx, timeouts and network errors all map to
 * 'failed' so the route can answer with a generic 502.
 */
export async function fetchAutocomplete(env, params, fetchFn = fetch) {
  try {
    if (!isGeoapifyConfigured(env)) return { ok: false, error: 'not_configured' };
    const opts = params && typeof params === 'object' ? params : {};
    if (!validateAutocompleteQuery(opts.text)) return { ok: false, error: 'bad_query' };
    const url = buildAutocompleteUrl(env, opts);
    if (!url) return { ok: false, error: 'bad_query' };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, { signal: controller.signal });
      if (!res || !res.ok) return { ok: false, error: 'failed' };
      let json = null;
      try {
        json = await res.json();
      } catch {
        return { ok: false, error: 'failed' };
      }
      return { ok: true, results: sanitizeAutocompleteResults(json) };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
}
