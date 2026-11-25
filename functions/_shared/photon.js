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
  // Streets-only fallback: osm_tag=highway drops cities/districts/POIs so a
  // thin retry returns named ways («شارع 16») instead of more localities.
  if (opts.osmTag === 'highway') params.set('osm_tag', 'highway');
  const bias = opts.bias && typeof opts.bias === 'object' ? opts.bias : null;
  const lat = bias ? bias.lat : NaN;
  const lon = bias ? bias.lng : NaN;
  if (typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180) {
    params.set('lat', String(lat));
    params.set('lon', String(lon));
    const box = bboxAround(bias);
    if (box) params.set('bbox', box);
  }
  return `${PHOTON_BASE}?${params.toString()}`;
}

/**
 * Bounding box around a viewport bias (~25 km half-side) so the deep
 * pass stays local: «شارع 16» near Alexandria must not return a
 * namesake street on another continent. Format minLon,minLat,maxLon,maxLat.
 * Returns null for an invalid bias. Never throws.
 */
export function bboxAround(bias, delta = 0.25) {
  try {
    const b = bias && typeof bias === 'object' ? bias : null;
    const lat = b ? b.lat : NaN;
    const lon = b ? b.lng : NaN;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
    if (typeof lon !== 'number' || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;
    const d = typeof delta === 'number' && Number.isFinite(delta) && delta > 0 && delta <= 1 ? delta : 0.25;
    const minLat = Math.max(-90, Math.round((lat - d) * 1e4) / 1e4);
    const maxLat = Math.min(90, Math.round((lat + d) * 1e4) / 1e4);
    const minLon = Math.max(-180, Math.round((lon - d) * 1e4) / 1e4);
    const maxLon = Math.min(180, Math.round((lon + d) * 1e4) / 1e4);
    return `${minLon},${minLat},${maxLon},${maxLat}`;
  } catch {
    return null;
  }
}

/**
 * Conservative Arabic normalization for recall variants: strips tashkeel
 * and tatweel, unifies alef forms (أإآٱ→ا). Deliberately keeps ة/ه and
 * ى/ي untouched — converting them merges distinct place names.
 * Returns '' for non-strings. Never throws.
 */
export function normalizeArabicQuery(text) {
  try {
    if (typeof text !== 'string') return '';
    let s = text.replace(/[ً-ٰٟـ]/g, '');
    s = s.replace(/[أإآٱ]/g, 'ا');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  } catch {
    return '';
  }
}

const STREET_TYPE_SYNONYMS = [
  ['شارع', 'street'],
  ['ميدان', 'square'],
  ['طريق', 'road'],
  ['كورنيش', 'corniche'],
  ['كوبري', 'bridge'],
  ['كوبرى', 'bridge'],
];

/**
 * Replace the first Arabic street-type word with its English equivalent
 * («السيوف شارع 16» → «السيوف street 16»): OSM ways are often tagged in
 * Latin script even inside Arabic-speaking cities. Returns null when no
 * street-type word is present. Never throws.
 */
export function latinizeStreetType(text) {
  try {
    if (typeof text !== 'string' || !text) return null;
    for (const [ar, en] of STREET_TYPE_SYNONYMS) {
      if (text.includes(ar)) return text.replace(ar, en);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Smart recall variants for one customer query (max 3, deduped):
 * original → normalized Arabic → latinized street-type, else backoff that
 * drops the first token (usually the city: «الإسكندرية السيوف شارع 16»
 * → «السيوف شارع 16»).
 * Long multi-token queries almost never match a single index record, so
 * the shorter variants are what surface the side street. Never throws.
 */
export function buildQueryVariants(q) {
  try {
    const out = [];
    const push = (v) => {
      if (typeof v !== 'string') return;
      const t = v.replace(/\s+/g, ' ').trim();
      if (t.length < 3 || t.length > 100) return;
      if (out.some((x) => x === t)) return;
      if (out.length < 3) out.push(t);
    };
    if (typeof q !== 'string') return out;
    const original = q.replace(/\s+/g, ' ').trim();
    push(original);
    const norm = normalizeArabicQuery(original);
    push(norm);
    const latin = latinizeStreetType(norm || original);
    if (latin) {
      push(latin);
    } else {
      const tokens = (norm || original).split(' ').filter(Boolean);
      if (tokens.length >= 4) push(tokens.slice(1).join(' '));
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Digit-aware ordering for the appended deep rows: when the query names a
 * number («شارع 16»), rows carrying that number sort first (stable —
 * otherwise the original provider order is kept). Zone rows are never
 * reordered. Caps the total at `limit`. Never throws.
 */
export function rankAppendedByDigits(zoneRows, deepRows, query, limit = RESULT_LIMIT) {
  try {
    const cap = Number.isInteger(limit) && limit > 0 ? limit : RESULT_LIMIT;
    const zone = Array.isArray(zoneRows) ? zoneRows.filter((r) => r && typeof r === 'object') : [];
    const deep = Array.isArray(deepRows) ? deepRows.filter((r) => r && typeof r === 'object') : [];
    const digits = typeof query === 'string' ? (query.match(/\d+/g) || []) : [];
    if (!digits.length) return [...zone, ...deep].slice(0, cap);
    const hay = (r) => `${r.label || ''} ${r.line1 || ''} ${r.details || ''}`;
    const hit = [];
    const rest = [];
    for (const r of deep) {
      const h = hay(r);
      if (digits.some((d) => h.includes(d))) hit.push(r);
      else rest.push(r);
    }
    return [...zone, ...hit, ...rest].slice(0, cap);
  } catch {
    return [];
  }
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
