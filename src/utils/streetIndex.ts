import type { AddressSuggestion } from '../hooks/useAddressAutocomplete';

export interface StreetEntry {
  ar: string;
  la: string | null;
  lat: number;
  lng: number;
}

/** A named place (district, suburb, village, town, city) from the
 * downloadable per-country places library. Same shape as a street
 * plus its OSM place kind. */
export interface PlaceEntry extends StreetEntry {
  kind: string;
}

export interface LoadedStreetIndex {
  id: string;
  cityAr: string;
  cityEn: string;
  country: string;
  entries: StreetEntry[];
}

export interface LoadedPlacesIndex {
  id: string;
  country: string;
  entries: PlaceEntry[];
}

export const STREET_INDEX_LIMIT = 8;
export const PLACES_INDEX_LIMIT = 4;

/** Same Arabic recall rules as the server and zone matching (alef unify,
 * ة→ه, ى→ي, no tashkeel/tatweel). Merging ه/ة spellings is deliberate:
 * Egyptian users type both, and truly distinct street names differing only
 * by that letter are vanishingly rare. */
export function normalizeStreetText(s: string): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/(^|\s)ش\.?(?=\s|$)/g, '$1شارع')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ٰٟـ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const STREET_TYPE_PAIRS: Array<[string, string]> = [
  ['شارع', 'street'],
  ['ميدان', 'square'],
  ['طريق', 'road'],
  ['كورنيش', 'corniche'],
  ['كوبري', 'bridge'],
  ['كوبرى', 'bridge'],
];

/** Raw query tokens (normalized, lowercased, deduped). */
function queryTokens(query: string): string[] {
  const norm = normalizeStreetText(query).toLowerCase();
  const out: string[] = [];
  for (const t of norm.split(' ').filter(Boolean)) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** A token matches when it (or its street-type alternate شارع↔street) prefixes a word. */
function tokenMatches(words: string[], t: string): boolean {
  const cands = [t];
  for (const [ar, en] of STREET_TYPE_PAIRS) {
    if (t === ar) cands.push(en);
    else if (t === en) cands.push(ar);
  }
  return cands.some((c) => words.some((w) => w.startsWith(c)));
}

function entryWords(e: StreetEntry): string[] {
  const words: string[] = [];
  const pushAll = (s: string) => {
    for (const w of s.toLowerCase().split(' ').filter(Boolean)) {
      if (!words.includes(w)) words.push(w);
    }
  };
  if (e.ar) pushAll(normalizeStreetText(e.ar));
  if (e.la) pushAll(e.la);
  return words;
}

function scoreEntry(e: StreetEntry, tokens: string[]): number {
  const words = entryWords(e);
  if (words.length === 0) return -1;
  let score = 0;
  for (const t of tokens) {
    if (t.length < 2 && !/\d/.test(t)) continue;
    if (!tokenMatches(words, t)) return -1; // every token must match: precision over recall
    score += 1;
    if (/\d/.test(t)) score += 2; // «شارع 16» must surface number matches
    if (words[0].startsWith(t)) score += 1;
  }
  const nameLen = (e.ar || e.la || '').length;
  score += Math.max(0, 30 - nameLen) / 100; // shorter names first on ties
  return score;
}

/** Meters between two points (near-sort only — coarse is fine). */
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {  const rad = (d: number) => (d * Math.PI) / 180;
  const r = 6371000;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Instant local search over a region street index. Every query token must
 * prefix-match a word of the street name (Arabic or Latin) — no fuzzy
 * guessing, so a suggestion is always the street the customer typed. When
 * the full «area + street + number» query matches nothing, the search backs
 * off to the tokens after the first (usually the city/area), mirroring the
 * server variants. With `near` (the map viewport), equally scored streets
 * order nearest-first — «ضع الأقرب». Returns at most `limit` rows shaped
 * like server suggestions.
 */
export function searchStreetIndex(
  entries: StreetEntry[],
  query: string,
  cityAr: string,
  cityEn: string,
  lang: 'en' | 'ar',
  limit: number = STREET_INDEX_LIMIT,
  near: { lat: number; lng: number } | null = null,
): AddressSuggestion[] {
  try {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const core = queryTokens(query).filter((t) => t.length >= 2 || /\d/.test(t));
    if (core.length === 0) return [];
    // Full query first, then progressively shorter suffixes («السيوف شماعة
    // شارع 16» → «شماعة شارع 16» → «شارع 16»): a dialect spelling in the
    // area tokens must not hide the street. First non-empty wins.
    const chains = [core];
    for (let i = 1; i < core.length; i += 1) {
      const suf = core.slice(i);
      if (suf.length >= 2) chains.push(suf);
    }
    const cap = Number.isInteger(limit) && limit > 0 ? limit : STREET_INDEX_LIMIT;
    const city = lang === 'ar' ? cityAr : cityEn;
    const run = (tokens: string[]): AddressSuggestion[] => {
      const ranked: Array<{ s: AddressSuggestion; score: number }> = [];
      for (const e of entries) {
        if (!e || typeof e.lat !== 'number' || typeof e.lng !== 'number') continue;
        if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) continue;
        const name = (lang === 'ar' ? e.ar || e.la : e.la || e.ar) || '';
        if (!name) continue;
        const score = scoreEntry(e, tokens);
        if (score < 0) continue;
        ranked.push({
          s: { label: city ? `${name}، ${city}` : name, line1: name, line2: city || '', lat: e.lat, lng: e.lng },
          score,
        });
      }
      if (ranked.length === 0) return [];
      const hasNear = near && Number.isFinite(near.lat) && Number.isFinite(near.lng);
      ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (hasNear && near) {
          const dist = (s: AddressSuggestion): number => (
            typeof s.lat === 'number' && typeof s.lng === 'number'
            && Number.isFinite(s.lat) && Number.isFinite(s.lng)
              ? distanceM(near.lat, near.lng, s.lat, s.lng)
              : Number.POSITIVE_INFINITY
          );
          return dist(a.s) - dist(b.s);
        }
        return 0;
      });
      return ranked.slice(0, cap).map((r) => r.s);
    };
    for (const tokens of chains) {
      if (tokens.length === 0) continue;
      const hit = run(tokens);
      if (hit.length > 0) return hit;
    }
    // Last resort: the final token alone when it is strong enough to stand
    // on its own (a street number, or a long word like a latinized type).
    if (core.length >= 2) {
      const last = core[core.length - 1];
      if (/\d/.test(last) || last.length >= 4) return run([last]);
    }
    return [];
  } catch {
    return [];
  }
}

/** Dedup key shared with the server merge (coords first, label fallback). */
function rowKey(r: { lat?: unknown; lng?: unknown; label?: unknown }): string {
  const lat = typeof r.lat === 'number' && Number.isFinite(r.lat) ? r.lat : NaN;
  const lng = typeof r.lng === 'number' && Number.isFinite(r.lng) ? r.lng : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat.toFixed(4)},${lng.toFixed(4)}`;
  return typeof r.label === 'string' && r.label ? `t:${r.label.toLowerCase()}` : '';
}

/** Local streets first, server rows appended deduplicated. Never throws. */
export function mergeLocalFirst(local: AddressSuggestion[], server: AddressSuggestion[]): AddressSuggestion[] {
  try {
    const out = Array.isArray(local) ? [...local] : [];
    const seen = new Set<string>();
    for (const r of out) {
      const k = rowKey(r);
      if (k) seen.add(k);
    }
    const rest = Array.isArray(server) ? server : [];
    for (const r of rest) {
      const k = rowKey(r);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  } catch {
    return Array.isArray(local) ? [...local] : [];
  }
}

/* ---------- lazy region index loading ---------- */

interface ManifestHit { id: string; country: string; bbox: [number, number, number, number] }

const manifests = new Map<string, {
  promise: Promise<{ indexes: ManifestHit[] } | null> | null;
  failedAt: number;
}>();
const MANIFEST_RETRY_MS = 30000;
const indexCache = new Map<string, Promise<LoadedStreetIndex | LoadedPlacesIndex | null>>();

const EGYPT_BBOX = { minLat: 21.5, minLng: 24.5, maxLat: 31.8, maxLng: 36.0 };
const LEBANON_BBOX = { minLat: 32.9, minLng: 35.0, maxLat: 34.8, maxLng: 36.7 };
const COUNTRY_BBOX: Record<string, { minLat: number; minLng: number; maxLat: number; maxLng: number }> = {
  eg: EGYPT_BBOX,
  lb: LEBANON_BBOX,
};

function inBbox(lat: number, lng: number, b: { minLat: number; minLng: number; maxLat: number; maxLng: number }): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

async function readManifest(base: string): Promise<{ indexes: ManifestHit[] } | null> {
  try {
    const res = await fetch(`/data/${base}/manifest.json`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return null;
    const idx = (data as { indexes?: unknown }).indexes;
    if (!Array.isArray(idx)) return null;
    return { indexes: idx.filter((x) => x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string') as Array<{ id: string; country: string; bbox: [number, number, number, number] }> };
  } catch {
    return null;
  }
}

function loadManifest(base: string): Promise<{ indexes: ManifestHit[] } | null> {
  let state = manifests.get(base);
  if (!state) {
    state = { promise: null, failedAt: 0 };
    manifests.set(base, state);
  }
  // A failed manifest fetch is retried (at most every 30s) instead of
  // poisoning the whole session — first load often races offline startup.
  if (!state.promise) {
    if (Date.now() - state.failedAt < MANIFEST_RETRY_MS) return Promise.resolve(null);
    state.promise = readManifest(base).then((m) => {
      if (!m) {
        state!.promise = null;
        state!.failedAt = Date.now();
      }
      return m;
    });
  }
  return state.promise;
}

function pickIndex(
  m: { indexes: ManifestHit[] } | null,
  country: string,
  bias: { lat: number; lng: number } | null,
): ManifestHit | null {
  try {
    if (!m) return null;
    const cc = typeof country === 'string' ? country.trim().toLowerCase() : '';
    const b = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng) ? bias : null;
    const hasBbox = (x: ManifestHit): boolean => Array.isArray(x.bbox) && x.bbox.length === 4
      && Number.isFinite(x.bbox[0]) && Number.isFinite(x.bbox[1])
      && Number.isFinite(x.bbox[2]) && Number.isFinite(x.bbox[3]);
    const inside = (x: ManifestHit): boolean => hasBbox(x) && b !== null
      && b.lat >= (x.bbox as [number, number, number, number])[0]
      && b.lat <= (x.bbox as [number, number, number, number])[2]
      && b.lng >= (x.bbox as [number, number, number, number])[1]
      && b.lng <= (x.bbox as [number, number, number, number])[3];
    // A live bias is ground truth: a file covering it wins even when the
    // country code points elsewhere, and — critically — a bias OUTSIDE
    // every file never falls back to a wrong-city file. A Cairo bias must
    // not load the Alexandria-only index just because both are `eg`.
    if (b) {
      const geoHit = m.indexes.find((x) => inside(x));
      if (geoHit) return geoHit;
      // No file covers this viewport: serve nothing local rather than a
      // wrong city. Legacy manifests without any bbox keep country match.
      const anyBbox = m.indexes.some((x) => hasBbox(x));
      if (anyBbox) return null;
      return (cc !== '' ? m.indexes.find((x) => x.country === cc) : undefined) || null;
    }
    return (cc !== '' ? m.indexes.find((x) => x.country === cc) : undefined)
      || (cc === '' ? m.indexes[0] : undefined)
      || null;
  } catch {
    return null;
  }
}

function countryRelevant(country: string, bias: { lat: number; lng: number } | null): boolean {
  const cc = typeof country === 'string' ? country.trim().toLowerCase() : '';
  const b = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng) ? bias : null;
  if (cc === 'eg' || cc === 'lb' || cc === '') return true;
  if (!b) return false;
  const box = COUNTRY_BBOX[cc];
  return box ? inBbox(b.lat, b.lng, box) : false;
}

async function loadRowFile(base: string, id: string): Promise<{ id: string; country: string; cityAr: string; cityEn: string; entries: unknown } | null> {
  try {
    const res = await fetch(`/data/${base}/${id}.json`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return null;
    const d = data as { id?: unknown; country?: unknown; cityAr?: unknown; cityEn?: unknown; entries?: unknown };
    if (typeof d.id !== 'string' || !Array.isArray(d.entries)) return null;
    return {
      id: d.id,
      country: typeof d.country === 'string' ? d.country : '',
      cityAr: typeof d.cityAr === 'string' ? d.cityAr : '',
      cityEn: typeof d.cityEn === 'string' ? d.cityEn : '',
      entries: d.entries,
    };
  } catch {
    return null;
  }
}

function toStreetEntry(row: unknown): StreetEntry | null {
  if (!Array.isArray(row) || row.length < 4) return null;
  const [ar, la, lat, lng] = row as [unknown, unknown, unknown, unknown];
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  return { ar: typeof ar === 'string' ? ar : '', la: typeof la === 'string' ? la : null, lat, lng };
}

/**
 * Pick the region street index for this search: a live bias inside a file's
 * bbox wins first; a bias outside every file serves nothing local (never a
 * wrong-city file); without a bias the country match wins. Manifest (and
 * files) load once per session and only when the region is plausibly
 * relevant. Never throws (null = no local index).
 */
export function loadStreetIndex(
  country: string,
  bias: { lat: number; lng: number } | null | undefined,
): Promise<LoadedStreetIndex | null> {
  try {
    const b = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng) ? bias : null;
    if (!countryRelevant(country, b)) return Promise.resolve(null);
    return loadManifest('street-index').then((m) => {
      const hit = pickIndex(m, country, b);
      if (!hit) return null;
      const key = `street-index:${hit.id}`;
      let p = indexCache.get(key) as Promise<LoadedStreetIndex | null> | undefined;
      if (!p) {
        p = (async (): Promise<LoadedStreetIndex | null> => {
          const file = await loadRowFile('street-index', hit.id);
          if (!file) return null;
          const entries: StreetEntry[] = [];
          for (const row of file.entries as unknown[]) {
            const e = toStreetEntry(row);
            if (e) entries.push(e);
          }
          return { id: file.id, cityAr: file.cityAr, cityEn: file.cityEn, country: file.country, entries };
        })();
        indexCache.set(key, p);
      }
      return p;
    }).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/** Arabic + English kind labels for place rows (line2 context). */
const KIND_LABEL: Record<string, { ar: string; en: string }> = {
  city: { ar: 'مدينة', en: 'City' },
  town: { ar: 'مدينة', en: 'Town' },
  village: { ar: 'قرية', en: 'Village' },
  suburb: { ar: 'حي', en: 'District' },
  neighbourhood: { ar: 'حي', en: 'Neighborhood' },
  quarter: { ar: 'حي', en: 'Quarter' },
  hamlet: { ar: 'عزبة', en: 'Hamlet' },
  isolated_dwelling: { ar: 'نجع', en: 'Hamlet' },
  farm: { ar: 'مزرعة', en: 'Farm' },
  locality: { ar: 'منطقة', en: 'Locality' },
  borough: { ar: 'حي', en: 'Borough' },
  municipality: { ar: 'بلدية', en: 'Municipality' },
};

export function kindLabel(kind: string, lang: 'en' | 'ar'): string {
  const k = KIND_LABEL[kind];
  if (!k) return '';
  return lang === 'ar' ? k.ar : k.en;
}

/**
 * Same token rules as streets, but the label context is the place kind
 * (district/village/…) instead of a city — an area name always deserves a
 * visible row even when no street matches it.
 */
export function searchPlaces(
  entries: PlaceEntry[],
  query: string,
  lang: 'en' | 'ar',
  limit: number = PLACES_INDEX_LIMIT,
  near: { lat: number; lng: number } | null = null,
): AddressSuggestion[] {
  try {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const core = queryTokens(query).filter((t) => t.length >= 2 || /\d/.test(t));
    if (core.length === 0) return [];
    const chains: string[][] = [core];
    for (let i = 1; i < core.length; i += 1) {
      const suf = core.slice(i);
      if (suf.length >= 2) chains.push(suf);
    }
    const cap = Number.isInteger(limit) && limit > 0 ? limit : PLACES_INDEX_LIMIT;
    const run = (tokens: string[]): AddressSuggestion[] => {
      const ranked: Array<{ s: AddressSuggestion; score: number }> = [];
      for (const e of entries) {
        if (!e || typeof e.lat !== 'number' || typeof e.lng !== 'number') continue;
        if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) continue;
        const name = (lang === 'ar' ? e.ar || e.la : e.la || e.ar) || '';
        if (!name) continue;
        const score = scoreEntry(e, tokens);
        if (score < 0) continue;
        const kind = kindLabel(typeof e.kind === 'string' ? e.kind : '', lang);
        ranked.push({
          s: { label: kind ? `${name}، ${kind}` : name, line1: name, line2: kind, lat: e.lat, lng: e.lng },
          score,
        });
      }
      if (ranked.length === 0) return [];
      const hasNear = near && Number.isFinite(near.lat) && Number.isFinite(near.lng);
      ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (hasNear && near) {
          const dist = (s: AddressSuggestion): number => (
            typeof s.lat === 'number' && typeof s.lng === 'number'
            && Number.isFinite(s.lat) && Number.isFinite(s.lng)
              ? distanceM(near.lat, near.lng, s.lat, s.lng)
              : Number.POSITIVE_INFINITY
          );
          return dist(a.s) - dist(b.s);
        }
        return 0;
      });
      return ranked.slice(0, cap).map((r) => r.s);
    };
    for (const tokens of chains) {
      if (tokens.length === 0) continue;
      const hit = run(tokens);
      if (hit.length > 0) return hit;
    }
    if (core.length >= 2) {
      const last = core[core.length - 1];
      if (/\d/.test(last) || last.length >= 4) return run([last]);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Pick the downloadable places library for this search: a live bias inside
 * a file's bbox wins first; a bias outside every file serves nothing local
 * (never a wrong-city file); without a bias the country match wins. Same
 * once-per-session caching as streets. Never throws (null = no places index).
 */
export function loadPlacesIndex(
  country: string,
  bias: { lat: number; lng: number } | null | undefined,
): Promise<LoadedPlacesIndex | null> {
  try {
    const b = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng) ? bias : null;
    if (!countryRelevant(country, b)) return Promise.resolve(null);
    return loadManifest('places-index').then((m) => {
      const hit = pickIndex(m, country, b);
      if (!hit) return null;
      const key = `places-index:${hit.id}`;
      let p = indexCache.get(key) as Promise<LoadedPlacesIndex | null> | undefined;
      if (!p) {
        p = (async (): Promise<LoadedPlacesIndex | null> => {
          const file = await loadRowFile('places-index', hit.id);
          if (!file) return null;
          const entries: PlaceEntry[] = [];
          for (const row of file.entries as unknown[]) {
            if (!Array.isArray(row) || row.length < 5) continue;
            const [ar, la, lat, lng, kind] = row as [unknown, unknown, unknown, unknown, unknown];
            if (typeof lat !== 'number' || !Number.isFinite(lat)) continue;
            if (typeof lng !== 'number' || !Number.isFinite(lng)) continue;
            entries.push({
              ar: typeof ar === 'string' ? ar : '',
              la: typeof la === 'string' ? la : null,
              lat,
              lng,
              kind: typeof kind === 'string' ? kind : '',
            });
          }
          return { id: file.id, country: file.country, entries };
        })();
        indexCache.set(key, p);
      }
      return p;
    }).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/* ---------- device-local recent places (private learning) ---------- */

const RECENT_KEY = 'cbx-recent-places-v1';
const RECENT_CAP = 5;
const RECENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface RecentPlace extends Omit<AddressSuggestion, 'lat' | 'lng'> {
  lat: number;
  lng: number;
  ts: number;
}

function readRecents(): RecentPlace[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const now = Date.now();
    return data.filter((r): r is RecentPlace => (
      !!r && typeof r === 'object'
      && typeof (r as { label?: unknown }).label === 'string'
      && typeof (r as { lat?: unknown }).lat === 'number'
      && typeof (r as { lng?: unknown }).lng === 'number'
      && typeof (r as { ts?: unknown }).ts === 'number'
      && now - (r as { ts: number }).ts < RECENT_TTL_MS
    ));
  } catch {
    return [];
  }
}

/**
 * This device's own picks (never leaves the browser — the shared-learning
 * alternative would expose one customer's apartment to strangers, so the
 * history stays per-device by design). Newest first.
 */
export function loadRecentPlaces(): RecentPlace[] {
  try {
    return readRecents().sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/** Remember a pick on this device only (dedupe by coordinates, cap 5). */
export function saveRecentPlace(s: AddressSuggestion): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!s || typeof s.label !== 'string' || !s.label) return;
    if (typeof s.lat !== 'number' || !Number.isFinite(s.lat)) return;
    if (typeof s.lng !== 'number' || !Number.isFinite(s.lng)) return;
    const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
    const rest = readRecents().filter((r) => `${r.lat.toFixed(4)},${r.lng.toFixed(4)}` !== key);
    rest.unshift({
      label: s.label,
      line1: typeof s.line1 === 'string' ? s.line1 : '',
      line2: typeof s.line2 === 'string' ? s.line2 : '',
      ...(typeof s.details === 'string' && s.details ? { details: s.details } : {}),
      lat: s.lat,
      lng: s.lng,
      ts: Date.now(),
    });
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(rest.slice(0, RECENT_CAP)));
  } catch {
    /* private mode — history simply does not persist */
  }
}

/** Recents matching this query (substring on the normalized label). */
export function matchRecentPlaces(query: string, limit: number = 3): AddressSuggestion[] {
  try {
    const needle = normalizeStreetText(query);
    if (needle.length < 2) return [];
    const cap = Number.isInteger(limit) && limit > 0 ? limit : 3;
    const out: AddressSuggestion[] = [];
    for (const r of loadRecentPlaces()) {
      if (normalizeStreetText(r.label).includes(needle)) {
        out.push({ label: r.label, line1: r.line1, line2: r.line2, ...(r.details ? { details: r.details } : {}), lat: r.lat, lng: r.lng });
        if (out.length >= cap) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}
