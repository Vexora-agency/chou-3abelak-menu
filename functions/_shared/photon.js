/**
 * Photon (Komoot) deep-search fallback — free, no API key, OSM-based.
 *
 * Used ONLY as the last cascade pass when the Geoapify passes come back
 * thin (a side street, a new alley, a transliterated name): same query,
 * same language, same map-viewport bias, never zone-filtered. Photon is
 * built for typeahead (prefix matching), so it complements Geoapify's
 * filtered ranking instead of replacing it.
 *
 * Conventions mirror functions/_shared/geoapify.js: per-request reads,
 * 6s AbortController timeouts, and NEVER any logging of the query text.
 */

import { RESULT_LIMIT } from './geoapify.js';

const PHOTON_BASE = 'https://photon.komoot.io/api/';
const REQUEST_TIMEOUT_MS = 6000;
const MAX_LABEL_CHARS = 120;

/**
 * Build the Photon search URL. Returns null when the query is invalid.
 * lang 'ar' passes through, everything else falls back to 'en'.
 * lat/lng bias the ranking toward the map the customer is looking at.
 */
export function buildPhotonUrl(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const raw = typeof opts.text === 'string' ? opts.text.trim() : '';
  if (raw.length < 3 || raw.length > 100) return null;
  const langRaw = typeof opts.lang === 'string' ? opts.lang.trim().toLowerCase() : '';
  const lang = langRaw === 'ar' ? 'ar' : 'en';
  const params = new URLSearchParams();
  params.set('q', raw);
  params.set('lang', lang);
  params.set('limit', String(RESULT_LIMIT));
  const bias = opts.bias && typeof opts.bias === 'object' ? opts.bias : null;
  const lat = bias ? bias.lat : NaN;
  const lon = bias ? bias.lng : NaN;
  if (typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180) {
    params.set('lat', String(lat));
    params.set('lon', String(lon));
  }
  return `${PHOTON_BASE}?${params.toString()}`;
}

/** Compose a readable label from Photon address parts (best effort). */
function composeLabel(p) {
  const parts = [];
  const push = (v) => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (!t) return;
    if (parts.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    parts.push(t);
  };
  const hn = typeof p.housenumber === 'string' ? p.housenumber.trim() : '';
  const st = typeof p.street === 'string' ? p.street.trim() : '';
  if (hn && st) push(`${hn} ${st}`);
  else { push(hn); push(st); }
  if (!parts.length) push(typeof p.name === 'string' ? p.name : '');
  push(typeof p.district === 'string' ? p.district : '');
  push(typeof p.suburb === 'string' ? p.suburb : '');
  push(typeof p.city === 'string' ? p.city : '');
  push(typeof p.town === 'string' ? p.town : '');
  push(typeof p.village === 'string' ? p.village : '');
  push(typeof p.state === 'string' ? p.state : '');
  push(typeof p.country === 'string' ? p.country : '');
  return parts.slice(0, 6).join(', ').slice(0, MAX_LABEL_CHARS);
}

/**
 * Strip a Photon GeoJSON payload down to the client-safe shape shared with
 * Geoapify rows: [{ label, line1, line2, lat, lng, details? }].
 * Drops rows without a usable label or finite coordinates. Never throws.
 */
export function sanitizePhotonResults(json) {
  const feats = json && typeof json === 'object' && Array.isArray(json.features) ? json.features : [];
  const out = [];
  for (const f of feats) {
    if (!f || typeof f !== 'object') continue;
    const p = f.properties && typeof f.properties === 'object' ? f.properties : {};
    const g = f.geometry && typeof f.geometry === 'object' ? f.geometry : {};
    const coords = Array.isArray(g.coords) ? g.coords : Array.isArray(g.coordinates) ? g.coordinates : null;
    if (!coords || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const label = composeLabel(p);
    if (!label) continue;
    const hn = typeof p.housenumber === 'string' ? p.housenumber.trim() : '';
    const st = typeof p.street === 'string' ? p.street.trim() : '';
    const line1 = hn && st ? `${hn} ${st}` : st || (typeof p.name === 'string' ? p.name.trim() : '');
    const bits = [];
    const pushBit = (v) => {
      if (typeof v !== 'string') return;
      const t = v.trim();
      if (t && !bits.some((x) => x.toLowerCase() === t.toLowerCase())) bits.push(t);
    };
    pushBit(typeof p.district === 'string' ? p.district : '');
    pushBit(typeof p.suburb === 'string' ? p.suburb : '');
    pushBit(typeof p.city === 'string' ? p.city : '');
    pushBit(typeof p.town === 'string' ? p.town : '');
    const line2 = bits.slice(0, 3).join(', ');
    out.push({
      label: label.slice(0, MAX_LABEL_CHARS),
      line1: (typeof line1 === 'string' ? line1 : '').slice(0, MAX_LABEL_CHARS),
      line2: (typeof line2 === 'string' ? line2 : '').slice(0, MAX_LABEL_CHARS),
      lat,
      lng: lon,
    });
  }
  return out;
}

/**
 * Server-side Photon search. Never throws and never logs the query text.
 * Result: { ok: true, results } or { ok: false, error: 'bad_query' | 'failed' }.
 */
export async function fetchPhoton(env, params, fetchFn = fetch) {
  void env;
  try {
    const opts = params && typeof params === 'object' ? params : {};
    const url = buildPhotonUrl(opts);
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
      return { ok: true, results: sanitizePhotonResults(json) };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
}
