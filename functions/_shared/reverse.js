/**
 * Server-side reverse-geocode helpers (Nominatim, zoom=18 building level).
 *
 * Why a proxy: browsers cannot set the identifying User-Agent Nominatim's
 * usage policy requires, and one shared UA + per-IP rate limiting keeps the
 * free service healthy. The client (`reverseGeocode` in
 * src/features/cart/hooks/useMidSplitLocationMap.ts) calls
 * GET /api/geo/reverse first and only falls back to a direct lookup when
 * the proxy is unreachable.
 *
 * Conventions mirror functions/_shared/geoapify.js: per-request env reads,
 * 6s AbortController timeouts, and NEVER any logging of coordinates.
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/reverse';
const REQUEST_TIMEOUT_MS = 6000;
const MAX_ADDR_CHARS = 200;
const CONTACT_UA = 'chou-3abelak-menu/1.0 (delivery address lookup)';

/**
 * Finite lat/lng inside range, rounded to 5 decimals. Null otherwise.
 * Accepts strings (query params) or numbers. Never throws.
 */
export function validateLatLng(latRaw, lngRaw) {
  try {
    const lat = typeof latRaw === 'string' ? Number(latRaw.trim()) : latRaw;
    const lng = typeof lngRaw === 'string' ? Number(lngRaw.trim()) : lngRaw;
    if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
    if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
  } catch {
    return null;
  }
}

/** 'ar' passes through, everything else falls back to 'en'. */
export function normalizeReverseLang(lang) {
  return typeof lang === 'string' && lang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
}

/** Nominatim reverse URL (zoom=18 = building level, not street level). */
export function buildReverseUrl(lat, lng, lang) {
  const coords = validateLatLng(lat, lng);
  if (!coords) return null;
  const params = new URLSearchParams();
  params.set('format', 'jsonv2');
  params.set('lat', String(coords.lat));
  params.set('lon', String(coords.lng));
  params.set('zoom', '18');
  params.set('accept-language', normalizeReverseLang(lang));
  return `${NOMINATIM_BASE}?${params.toString()}`;
}

/**
 * Place + road + district + city — the deliverable address.
 * Wide key coverage: OSM data often tags roads as footway/residential and
 * districts as borough/hamlet — a narrow lookup returns just the city.
 * A nearby named place (shop/amenity/building) is kept as a landmark
 * prefix: the kitchen delivers faster with "near X" than a bare road.
 * Falls back to the first 4 display_name parts. Null when unusable.
 * Never throws.
 */
export function formatReverseAddress(data) {
  try {
    if (!data || typeof data !== 'object') return null;
    const d = data;
    const addr = d.address && typeof d.address === 'object' ? d.address : null;
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    if (addr) {
      const road = [
        addr.house_number,
        addr.road || addr.street || addr.pedestrian || addr.footway
        || addr.residential || addr.cycleway || addr.path || '',
      ].map(str).filter(Boolean).join(' ');
      const district = str(
        addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district
        || addr.borough || addr.municipality || addr.hamlet || addr.subdivision,
      );
      const city = str(
        addr.city || addr.town || addr.village || addr.municipality
        || addr.county || addr.state_district || addr.state,
      );
      const place = str(d.name || addr.amenity || addr.shop || addr.building || addr.leisure);
      const full = [place && place !== road ? place : '', road, district, city]
        .map(str).filter(Boolean).join(', ');
      if (full) return full.slice(0, MAX_ADDR_CHARS);
    }
    if (typeof d.display_name === 'string' && d.display_name.trim()) {
      return d.display_name.split(',').slice(0, 4).join(',').trim().slice(0, MAX_ADDR_CHARS) || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Server-side reverse lookup with an identifying User-Agent per the
 * Nominatim usage policy. Never throws and never logs coordinates.
 * Result: { ok: true, address: string|null } or { ok: false, error }.
 */
export async function fetchReverse(env, params, fetchFn = fetch) {
  void env;
  try {
    const opts = params && typeof params === 'object' ? params : {};
    const coords = validateLatLng(opts.lat, opts.lng);
    if (!coords) return { ok: false, error: 'bad_query' };
    const url = buildReverseUrl(coords.lat, coords.lng, opts.lang);
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
      return { ok: true, address: formatReverseAddress(json) };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/**
 * Reverse-geocode to an uppercase ISO country code only (for validating a
 * pasted pin against the delivery zones). Never throws, never logs.
 * Returns { ok:true, country:'EG'|…|null } — null country means Nominatim
 * answered but named no country (open water); the caller decides.
 */
export async function fetchReverseCountry(env, params, fetchFn = fetch) {
  void env;
  try {
    const opts = params && typeof params === 'object' ? params : {};
    const coords = validateLatLng(opts.lat, opts.lng);
    if (!coords) return { ok: false, error: 'bad_query' };
    const url = buildReverseUrl(coords.lat, coords.lng, 'en');
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
      const addr = json && typeof json === 'object' && json.address && typeof json.address === 'object' ? json.address : null;
      const cc = addr && typeof addr.country_code === 'string' ? addr.country_code.trim().toUpperCase() : '';
      return { ok: true, country: /^[A-Z]{2}$/.test(cc) ? cc : null };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
}
