/**
 * Nominatim full-text search fallback (OpenStreetMap, keyless).
 *
 * Runs LAST for specific queries (numbered streets like «شارع 16», POI
 * names like «كنيسة الانبا اثناسيوس»): autocomplete/typeahead indexes match from the
 * start of a record, while Nominatim search matches tokens anywhere, so it
 * catches what prefix search misses. 1 req/s provider policy is honored
 * with a dedicated per-IP throttle (1 call per 2s) plus the same daily
 * cap as the reverse proxy.
 *
 * Conventions mirror functions/_shared/reverse.js: 6s AbortController
 * timeouts, identifying User-Agent, and NEVER any logging of the query.
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const REQUEST_TIMEOUT_MS = 6000;
const MAX_ADDR_CHARS = 200;
const CONTACT_UA = 'chou-3abelak-menu/1.0 (delivery address search)';
export const NOMINATIM_RESULT_LIMIT = 8;

/** Trimmed 6..100 char query (shorter queries never reach this pass). */
export function validateNominatimQuery(q) {
  if (typeof q !== 'string') return null;
  const text = q.trim().replace(/\s+/g, ' ');
  if (text.length < 6 || text.length > 100) return null;
  return text;
}

/** 'ar' passes through, everything else falls back to 'en'. */
function normalizeLang(lang) {
  return typeof lang === 'string' && lang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
}

/**
 * Build the Nominatim search URL. viewbox = soft viewport bias
 * (left,top,right,bottom); bounded=0 keeps it a bias, not a fence.
 * Returns null for an invalid query.
 */
export function buildNominatimUrl(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const text = validateNominatimQuery(opts.text);
  if (!text) return null;
  const lang = normalizeLang(opts.lang);
  const params = new URLSearchParams();
  params.set('format', 'jsonv2');
  params.set('q', text);
  params.set('accept-language', lang);
  params.set('addressdetails', '1');
  params.set('namedetails', '1');
  params.set('limit', String(NOMINATIM_RESULT_LIMIT));
  const codes = opts.country;
  if (typeof codes === 'string' && /^[a-z]{2}$/i.test(codes.trim())) {
    params.set('countrycodes', codes.trim().toLowerCase());
  }
  const bias = opts.bias && typeof opts.bias === 'object' ? opts.bias : null;
  const lat = bias ? bias.lat : NaN;
  const lng = bias ? bias.lng : NaN;
  if (typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180) {
    const d = 0.5;
    params.set('viewbox', `${lng - d},${lat + d},${lng + d},${lat - d}`);
    params.set('bounded', '0');
  }
  return `${NOMINATIM_BASE}?${params.toString()}`;
}

/**
 * Strip a Nominatim search payload to the shared client-safe shape:
 * [{ label, line1, line2, lat, lng }]. Prefers the Arabic name, keeps a
 * landmark prefix when the record is a named POI, drops rows without
 * finite coordinates. Never throws.
 */
export function sanitizeNominatimResults(json) {
  const raw = Array.isArray(json) ? json : (json && typeof json === 'object' && Array.isArray(json.results) ? json.results : []);
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) continue;
    const named = row.namedetails && typeof row.namedetails === 'object' ? row.namedetails : {};
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const name = str(named['name:ar']) || str(named.name) || str(row.name) || '';
    const addr = row.address && typeof row.address === 'object' ? row.address : {};
    const road = str(addr.house_number ? `${addr.house_number} ` : '') + str(addr.road || addr.street || addr.pedestrian || addr.footway || '');
    const district = str(addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || addr.borough);
    const city = str(addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state);
    const bits = [name && name !== road.trim() ? name : '', road.trim(), district, city].map(str).filter(Boolean);
    if (bits.length === 0) {
      const fallback = str(row.display_name).split(',').slice(0, 4).join(',').trim();
      if (!fallback) continue;
      bits.push(fallback);
    }
    const shownName = name || bits[0];
    const rest = bits[0] === shownName ? bits.slice(1, 4) : bits.slice(0, 3);
    const label = bits.slice(0, 4).join(', ').slice(0, MAX_ADDR_CHARS);
    out.push({
      label,
      line1: shownName.slice(0, MAX_ADDR_CHARS),
      line2: rest.join(', ').slice(0, MAX_ADDR_CHARS),
      lat,
      lng: lon,
    });
    if (out.length >= NOMINATIM_RESULT_LIMIT) break;
  }
  return out;
}

/**
 * Server-side Nominatim search. Never throws and never logs the query text.
 * Result: { ok: true, results } or { ok: false, error: 'bad_query' | 'failed' }.
 */
export async function fetchNominatim(env, params, fetchFn = fetch) {
  void env;
  try {
    const opts = params && typeof params === 'object' ? params : {};
    const url = buildNominatimUrl(opts);
    if (!url) return { ok: false, error: 'bad_query' };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': CONTACT_UA },
      });
      if (!res || !res.ok) return { ok: false, error: 'failed' };
      let json = null;
      try {
        json = await res.json();
      } catch {
        return { ok: false, error: 'failed' };
      }
      return { ok: true, results: sanitizeNominatimResults(json) };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
}
