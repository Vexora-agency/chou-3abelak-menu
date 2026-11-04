/**
 * Delivery-zone domain (client copy).
 * MUST stay behavior-identical to functions/_shared/delivery-zones.js.
 *
 * A delivery zone is a country allow-list with optional subdivision
 * (governorate/state) narrowing:
 *   { mode: 'all' | 'selected', maxKm: number, countries: [{ cc, subdivisions }] }
 * where subdivisions is 'ALL' (whole country open — the default when an
 * admin picks a country) or an explicit list of subdivision codes.
 *
 * Matching is code-first, name-second: a subdivision matches when its ISO
 * code equals an allowed code OR its normalized name equals a normalized
 * allowed name/alias. Name matching exists because some geocoders return
 * names without codes (notably Keserwan-Jbeil, which has NO ISO 3166-2
 * code at all) and because boundary definitions drift between providers.
 */
import COUNTRIES from '@/src/data/geo/countries.json';

export interface DeliveryZoneCountry {
  /** ISO 3166-1 alpha-2, uppercase. */
  cc: string;
  /** 'ALL' = whole country open; otherwise explicit subdivision codes. */
  subdivisions: 'ALL' | string[];
}

export interface DeliveryZones {
  mode: 'all' | 'selected';
  /** Server + client backstop radius (km) for delivery pins. */
  maxKm: number;
  countries: DeliveryZoneCountry[];
}

/** Subdivision row as shipped in public/geo/subdivisions/<CC>.json. */
export interface SubdivEntry {
  code: string;
  en: string;
  ar: string | null;
  aliases?: string[];
}

/** What the checkout reverse-geocode resolved for the pinned point. */
export interface ZoneClaim {
  cc: string;
  subCode: string | null;
  subName: string | null;
}

export const DEFAULT_DELIVERY_ZONES: DeliveryZones = { mode: 'all', maxKm: 100, countries: [] };

/** Hard bounds for the admin maxKm input (validation rejects outside). */
export const DELIVERY_ZONES_MAX_KM = 2000;

export interface CountryEntry {
  cc: string;
  en: string;
  ar: string | null;
}

/** Full country list (EN + AR), bundled — safe to import anywhere. */
export const COUNTRY_LIST: CountryEntry[] = COUNTRIES as CountryEntry[];

const KNOWN_CC: ReadonlySet<string> = new Set(COUNTRY_LIST.map((c) => c.cc));

const SUB_CODE_RE = /^[A-Za-z0-9-]{2,16}$/;

/**
 * Normalize a subdivision/country name for comparison: lowercase, trim,
 * collapse whitespace, drop separators, fold Arabic alef forms and strip
 * Arabic diacritics/tatweel. Both sides go through this, so display
 * variants ("Beqaa" vs "Bekaa", "الشمال" vs "شمال") still match.
 */
export function normalizeZoneName(s: unknown): string {
  let t = typeof s === 'string' ? s : '';
  t = t.toLowerCase().trim().replace(/[\s\-_.,'’`]+/g, '');
  t = t
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u0652\u0640]/g, '');
  return t;
}

/** Flag emoji for a country code (regional indicators, no images needed). */
export function flagEmoji(cc: string): string {
  const c = (cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0)));
}

/**
 * Sanitize admin input into canonical DeliveryZones. Unknown country codes
 * are dropped (self-healing, same spirit as the pricing normalizer);
 * subdivisions keep only well-formed codes (existence is guaranteed by the
 * admin UI, which only offers codes from the generated lists). A country
 * left with zero subdivisions is dropped — serving "no areas" is meaningless.
 */
export function normalizeDeliveryZones(input: unknown, knownCc: ReadonlySet<string> = KNOWN_CC): DeliveryZones {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const mode = o.mode === 'selected' ? 'selected' : 'all';
  const maxRaw = o.maxKm;
  const maxKm = typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw >= 1 && maxRaw <= DELIVERY_ZONES_MAX_KM
    ? Math.round(maxRaw)
    : DEFAULT_DELIVERY_ZONES.maxKm;
  const countries: DeliveryZoneCountry[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(o.countries) ? o.countries : [];
  for (const c of list.slice(0, 249)) {
    if (!c || typeof c !== 'object') continue;
    const cc = typeof (c as Record<string, unknown>).cc === 'string' ? ((c as Record<string, unknown>).cc as string).trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(cc) || seen.has(cc) || !knownCc.has(cc)) continue;
    seen.add(cc);
    const sub = (c as Record<string, unknown>).subdivisions;
    if (sub === undefined || sub === null || sub === 'ALL') {
      countries.push({ cc, subdivisions: 'ALL' });
      continue;
    }
    if (!Array.isArray(sub)) continue;
    const codes = [
      ...new Set(
        sub
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim().toUpperCase()),
      ),
    ].filter((x) => SUB_CODE_RE.test(x)).slice(0, 200);
    if (!codes.length) continue;
    countries.push({ cc, subdivisions: codes });
  }
  return { mode, maxKm, countries };
}

/**
 * True when the resolved pin location is inside the served zones.
 * subdivisions = the loaded public/geo/subdivisions/<CC>.json list for the
 * pin's country (or null when not loaded, e.g. offline): without it only
 * code matching is possible, and an unknown subdivision then falls back to
 * the country-level approval rather than wrongly blocking the customer.
 * The server-side distance backstop stays the real guarantee either way.
 */
export function matchZone(
  zones: DeliveryZones,
  cc: unknown,
  sub: { code: string | null; name: string | null } | null,
  subdivisions: SubdivEntry[] | null,
): boolean {
  if (!zones || zones.mode !== 'selected') return true;
  const code = typeof cc === 'string' ? cc.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(code)) return false;
  const entry = (Array.isArray(zones.countries) ? zones.countries : []).find((z) => z && z.cc === code);
  if (!entry) return false;
  if (entry.subdivisions === 'ALL') return true;
  if (!sub || (sub.code == null && sub.name == null)) return true;
  const allowed = Array.isArray(entry.subdivisions) ? entry.subdivisions : [];
  const subCode = typeof sub.code === 'string' ? sub.code.trim().toUpperCase() : '';
  if (subCode && allowed.some((a) => typeof a === 'string' && a.toUpperCase() === subCode)) return true;
  const subName = normalizeZoneName(sub.name);
  if (!subName) return false;
  if (!Array.isArray(subdivisions) || !subdivisions.length) {
    // No subdivision data loaded (offline?): country already approved
    // above, so approve rather than strand the customer. The server-side
    // distance backstop still applies.
    return true;
  }
  const wanted = new Set<string>();
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
export function isDeliveryBlocked(
  zones: DeliveryZones,
  orderType: unknown,
  cc: unknown,
  sub: { code: string | null; name: string | null } | null,
  subdivisions: SubdivEntry[] | null,
): boolean {
  if (orderType !== 'delivery') return false;
  if (!zones || zones.mode !== 'selected') return false;
  return !matchZone(zones, cc, sub, subdivisions);
}
