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
  // Soft viewport bias only (lat/lon rank nearby results first). Deliberately
  // NO hard bbox: it would amputate cross-region queries (a Beirut-centered
  // map asking about Alexandria) instead of merely deprioritizing them.
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
 * Smart recall variants for one customer query (max 6, deduped):
 * original → normalized Arabic → latinized street-type, then a deep
 * suffix chain that drops leading tokens one by one
 * («الإسكندرية السويف شماعة شارع 16» → … → «شماعة شارع 16» →
 * «شارع 16»). A dialect spelling in the area tokens (السويف vs السيوف)
 * no longer kills the street match: the street+number suffix still hits.
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
      if (out.length < 6) out.push(t);
    };
    if (typeof q !== 'string') return out;
    const original = q.replace(/\s+/g, ' ').trim();
    push(original);
    const norm = normalizeArabicQuery(original);
    push(norm);
    const base = norm || original;
    const latin = latinizeStreetType(base);
    if (latin) push(latin);
    const tokens = base.split(' ').filter(Boolean);
    for (let i = 1; i < tokens.length; i += 1) {
      const suf = tokens.slice(i).join(' ');
      if (suf.split(' ').filter(Boolean).length < 2) break;
      push(suf);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Pick the fallback variant for the second deep pass: the shortest
 * non-full variant (sharpest retry — «شارع 16» beats a five-token
 * misspelled area string), ties broken toward the earlier entry.
 * Null when there is nothing but the full query. Never throws.
 */
export function pickFallbackVariant(variants) {
  try {
    if (!Array.isArray(variants) || variants.length < 2) return null;
    const rest = variants.slice(1).filter((v) => typeof v === 'string' && v);
    let best = null;
    for (const v of rest) {
      const len = v.split(' ').filter(Boolean).length;
      if (!best || len < best.len) best = { v, len };
    }
    return best ? best.v : null;
  } catch {
    return null;
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
