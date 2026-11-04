/**
 * Delivery-zone domain (server copy).
 * MUST stay behavior-identical to src/utils/deliveryZones.ts.
 *
 * A delivery zone is a country allow-list with optional subdivision
 * (governorate/state) narrowing:
 *   { mode: 'all' | 'selected', maxKm: number, countries: [{ cc, subdivisions }] }
 * where subdivisions is 'ALL' (whole country open) or explicit codes.
 * Matching is code-first, name-second (see the client copy for why).
 */
import COUNTRIES from './geodata/countries.js';

export const DEFAULT_DELIVERY_ZONES = { mode: 'all', maxKm: 100, countries: [] };

/** Hard bounds for the admin maxKm input (validation rejects outside). */
export const DELIVERY_ZONES_MAX_KM = 2000;

const KNOWN_CC = new Set((Array.isArray(COUNTRIES) ? COUNTRIES : []).map((c) => c && c.cc).filter((cc) => typeof cc === 'string'));

const SUB_CODE_RE = /^[A-Za-z0-9-]{2,16}$/;

/**
 * Normalize a subdivision/country name for comparison: lowercase, trim,
 * collapse whitespace, drop separators, fold Arabic alef forms and strip
 * Arabic diacritics/tatweel. Both sides go through this, so display
 * variants ("Beqaa" vs "Bekaa", "الشمال" vs "شمال") still match.
 */
export function normalizeZoneName(s) {
  let t = typeof s === 'string' ? s : '';
  t = t.toLowerCase().trim().replace(/[\s\-_.,'’`]+/g, '');
  t = t
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ٲٰـ]/g, '');
  return t;
}

/**
 * Sanitize admin input into canonical DeliveryZones. Unknown country codes
 * are dropped (self-healing); subdivisions keep only well-formed codes
 * (existence is guaranteed by the admin UI). A country left with zero
 * subdivisions is dropped.
 */
export function normalizeDeliveryZones(input, knownCc) {
  const known = knownCc instanceof Set ? knownCc : KNOWN_CC;
  const o = input && typeof input === 'object' ? input : {};
  const mode = o.mode === 'selected' ? 'selected' : 'all';
  const maxRaw = o.maxKm;
  const maxKm = typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw >= 1 && maxRaw <= DELIVERY_ZONES_MAX_KM
    ? Math.round(maxRaw)
    : DEFAULT_DELIVERY_ZONES.maxKm;
  const countries = [];
  const seen = new Set();
  const list = Array.isArray(o.countries) ? o.countries : [];
  for (const c of list.slice(0, 249)) {
    if (!c || typeof c !== 'object') continue;
    const cc = typeof c.cc === 'string' ? c.cc.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(cc) || seen.has(cc) || !known.has(cc)) continue;
    seen.add(cc);
    const sub = c.subdivisions;
    if (sub === undefined || sub === null || sub === 'ALL') {
      countries.push({ cc, subdivisions: 'ALL' });
      continue;
    }
    if (!Array.isArray(sub)) continue;
    const codes = [...new Set(
      sub
        .filter((x) => typeof x === 'string')
        .map((x) => x.trim().toUpperCase()),
    )].filter((x) => SUB_CODE_RE.test(x)).slice(0, 200);
    if (!codes.length) continue;
    countries.push({ cc, subdivisions: codes });
  }
  return { mode, maxKm, countries };
}

/**
 * True when the resolved pin location is inside the served zones.
 * subdivisions = the loaded subdivision list for the pin's country (or
 * null when unavailable): without it only code matching is possible, and
 * an unknown subdivision then falls back to the country-level approval
 * rather than wrongly blocking. The distance backstop is the guarantee.
 */
export function matchZone(zones, cc, sub, subdivisions) {
  if (!zones || zones.mode !== 'selected') return true;
  const code = typeof cc === 'string' ? cc.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(code)) return false;
  const list = Array.isArray(zones.countries) ? zones.countries : [];
  const entry = list.find((z) => z && z.cc === code);
  if (!entry) return false;
  if (entry.subdivisions === 'ALL') return true;
  if (!sub || (sub.code == null && sub.name == null)) return true;
  const allowed = Array.isArray(entry.subdivisions) ? entry.subdivisions : [];
  const subCode = typeof sub.code === 'string' ? sub.code.trim().toUpperCase() : '';
  if (subCode && allowed.some((a) => typeof a === 'string' && a.toUpperCase() === subCode)) return true;
  const subName = normalizeZoneName(sub.name);
  if (!subName) return false;
  if (!Array.isArray(subdivisions) || !subdivisions.length) {
    // No subdivision data loaded: country already approved above, so
    // approve rather than strand the customer. The server-side distance
    // backstop still applies.
    return true;
  }
  const wanted = new Set();
  for (const a of allowed) {
    if (typeof a !== 'string') continue;
    wanted.add(normalizeZoneName(a));
    const def = subdivisions.find((d) => d && typeof d.code === 'string' && d.code.toUpperCase() === a.toUpperCase());
    if (!def) continue;
    wanted.add(normalizeZoneName(def.en));
    if (def.ar) wanted.add(normalizeZoneName(def.ar));
    if (Array.isArray(def.aliases)) for (const al of def.aliases) wanted.add(normalizeZoneName(al));
  }
  if (wanted.has(subName)) return true;
  if (subCode && wanted.has(normalizeZoneName(subCode))) return true;
  return false;
}

/** True when delivery to this pin must be hard-blocked (selected zones set). */
export function isDeliveryBlocked(zones, orderType, cc, sub, subdivisions) {
  if (orderType !== 'delivery') return false;
  if (!zones || zones.mode !== 'selected') return false;
  return !matchZone(zones, cc, sub, subdivisions);
}
