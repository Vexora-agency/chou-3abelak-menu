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
  params.set('limit', '5');
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
 * strips EVERYTHING else (rank, datasource, name, street, city,
 * result_type, …). Never throws for garbage input — returns [].
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
    out.push({
      label,
      line1: typeof row.address_line1 === 'string' ? row.address_line1 : '',
      line2: typeof row.address_line2 === 'string' ? row.address_line2 : '',
      lat: row.lat,
      lng: row.lon,
    });
  }
  return out;
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
