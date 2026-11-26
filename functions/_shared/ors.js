/**
 * OpenRouteService (HeiGIT) geocode helpers — the primary keyed suggestion
 * pass, replacing Google Places (which needs a billing-enabled project).
 *
 * The public ORS geocoder is a hosted Pelias instance with a type-ahead
 * autocomplete endpoint. Free Standard plan (0 €, no card, email signup):
 * 3000 geocode requests/day, 100/minute. Key travels only in the server
 * `Authorization` header, never in a URL or body. Coordinates arrive WITH
 * each suggestion (no follow-up details call), and `boundary.country`
 * hard-filters to the admin's delivery countries while `focus.point`
 * stays a soft viewport ranking hint — never a fence.
 *
 * Conventions mirror functions/_shared/google.js: per-request env reads,
 * 6s AbortController timeouts, and NEVER any logging of the key or query.
 */

const ORS_AUTOCOMPLETE_URL = 'https://api.heigit.org/geocode/autocomplete';
const REQUEST_TIMEOUT_MS = 6000;
const MAX_LABEL_CHARS = 120;
export const ORS_RESULT_LIMIT = 10;

/** Trimmed string env read (per request). Returns '' when missing. */
export function trimOrsEnv(env, key) {
  const value = env && typeof env[key] === 'string' ? env[key].trim() : '';
  return value;
}

/** True when a non-empty ORS_API_KEY is present. */
export function isOrsConfigured(env) {
  return !!trimOrsEnv(env, 'ORS_API_KEY');
}

/** Shared daily budget for hosted geocode calls (default 3000 = plan quota). */
export function orsDailyMax(env) {
  const raw = env && typeof env.ORS_GEOCODING_DAILY_MAX === 'string'
    ? env.ORS_GEOCODING_DAILY_MAX.trim()
    : env && env.ORS_GEOCODING_DAILY_MAX;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000;
}

/** 'ar' passes through, everything else falls back to 'en'. */
export function normalizeOrsLang(lang) {
  return typeof lang === 'string' && lang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
}

/** Uppercase 2-letter country list (unique, capped at 10) for boundary.country. */
export function normalizeOrsCountries(v) {
  const list = Array.isArray(v) ? v : [v];
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const code = item.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && !out.includes(code)) out.push(code);
    if (out.length >= 10) break;
  }
  return out;
}

function trimText(v) {
  return typeof v === 'string' ? v.trim().slice(0, MAX_LABEL_CHARS) : '';
}

/**
 * Build the Pelias autocomplete URL. Returns null for an invalid query.
 * lang 'ar' passes through, regions become a comma-joined boundary.country
 * allow-list, and bias becomes a soft focus.point ranking hint.
 */
export function buildOrsAutocompleteUrl(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const raw = typeof opts.text === 'string' ? opts.text.trim() : '';
  if (raw.length < 3 || raw.length > 100) return null;
  const params = new URLSearchParams();
  params.set('text', raw);
  params.set('lang', normalizeOrsLang(opts.lang));
  params.set('size', String(ORS_RESULT_LIMIT));
  const countries = normalizeOrsCountries(
    Array.isArray(opts.regions) && opts.regions.length > 0 ? opts.regions : opts.region,
  );
  if (countries.length > 0) params.set('boundary.country', countries.join(','));
  const bias = opts.bias && typeof opts.bias === 'object' ? opts.bias : null;
  const lat = bias ? bias.lat : NaN;
  const lng = bias ? bias.lng : NaN;
  if (typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180) {
    params.set('focus.point.lat', String(lat));
    params.set('focus.point.lon', String(lng));
  }
  return `${ORS_AUTOCOMPLETE_URL}?${params.toString()}`;
}

/**
 * Map a Pelias autocomplete payload to client rows. Coordinates arrive
 * with every feature (geometry.coordinates = [lng, lat]), so no follow-up
 * call is ever needed. Drops features without a usable label or finite
 * coordinates. Never throws.
 */
export function sanitizeOrsResults(json) {
  const list = json && typeof json === 'object' && Array.isArray(json.features) ? json.features : [];
  const out = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const props = f.properties && typeof f.properties === 'object' ? f.properties : null;
    if (!props) continue;
    const label = trimText(typeof props.label === 'string' ? props.label : '');
    if (!label) continue;
    const name = trimText(typeof props.name === 'string' ? props.name : '');
    const parts = label.split(',').map((p) => p.trim()).filter(Boolean);
    const line1 = name || parts[0] || label;
    const rest = name && label.toLowerCase().indexOf(name.toLowerCase()) === 0
      ? label.slice(name.length).replace(/^,?\s*/, '')
      : parts.slice(1).join(', ');
    const geo = f.geometry && typeof f.geometry === 'object' ? f.geometry : null;
    const coords = geo && Array.isArray(geo.coordinates) ? geo.coordinates : null;
    const lng = coords ? Number(coords[0]) : NaN;
    const lat = coords ? Number(coords[1]) : NaN;
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    if (!Number.isFinite(lng) || Math.abs(lng) > 180) continue;
    out.push({
      label: label.slice(0, MAX_LABEL_CHARS),
      line1: line1.slice(0, MAX_LABEL_CHARS),
      line2: (rest || '').slice(0, MAX_LABEL_CHARS),
      lat,
      lng,
    });
    if (out.length >= ORS_RESULT_LIMIT) break;
  }
  return out;
}

/**
 * Server-side Pelias autocomplete call. Never throws, never logs the key
 * or query. Accepts { text, lang, bias, regions } — regions hard-filter
 * countries, focus.point only ranks. Result: { ok:true, results } or
 * { ok:false, error }.
 */
export async function fetchOrsAutocomplete(env, params, fetchFn = fetch) {
  try {
    if (!isOrsConfigured(env)) return { ok: false, error: 'not_configured' };
    const opts = params && typeof params === 'object' ? params : {};
    const url = buildOrsAutocompleteUrl(opts);
    if (!url) return { ok: false, error: 'bad_query' };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: trimOrsEnv(env, 'ORS_API_KEY'),
        },
      });
      if (!res || !res.ok) return { ok: false, error: 'failed' };
      let json = null;
      try {
        json = await res.json();
      } catch {
        return { ok: false, error: 'failed' };
      }
      return { ok: true, results: sanitizeOrsResults(json) };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
}
