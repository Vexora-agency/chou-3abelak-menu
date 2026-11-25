import { MenuData } from '@/src/types/menu';

export { ensureSettingsBlocks } from '@/src/utils/menuValidation';

/**
 * Bilingual text picker with automatic fallback: if the requested language
 * is empty, the other language is used instead. Generic text helper, used
 * across menu/cart/admin UI.
 */
export function pickLangText(
  v: { en: string; ar: string } | undefined | null,
  lang: 'en' | 'ar'
): string {
  if (!v) return '';
  const primary = (lang === 'ar' ? v.ar : v.en) || '';
  if (primary.trim()) return primary;
  return (lang === 'ar' ? v.en : v.ar) || '';
}

/**
 * Smart-badge label in the UI language. Badge keys are stored in English
 * ('top' | 'new' | 'spicy'); Arabic visitors see Arabic words.
 */
export function badgeLabel(key: string, lang: 'en' | 'ar'): string {
  const k = (key || '').toLowerCase();
  if (lang === 'ar') {
    if (k === 'top') return 'الأكثر طلبًا';
    if (k === 'spicy') return 'حار';
    if (k === 'new') return 'جديد';
    return key;
  }
  return key.toUpperCase();
}

/**
 * Spicy add-on detection + label. The spicy option travels as zero-price
 * addons. The modern shape is a locked "Make it Spicy" SECTION with three
 * single-choice levels (mild / medium / extra-hot) rendered as a slider in
 * the customer sheet. The legacy shape is one addon with featureId 'spicy'
 * (old menus, old carts); it is still recognised everywhere so old lines
 * keep rendering instead of breaking.
 */
export const SPICY_GROUP_ID = 'spicy';

export const SPICY_LEVEL_IDS = ['spicy-mild', 'spicy-medium', 'spicy-hot'] as const;

export type SpicyLevelId = (typeof SPICY_LEVEL_IDS)[number];

/** Legacy single-option id (pre-levels menus and carts). */
export const SPICY_LEGACY_ID = 'spicy';

export function isSpicyFeatureId(featureId: unknown): boolean {
  if (typeof featureId !== 'string') return false;
  const id = featureId.trim().toLowerCase();
  return id === SPICY_LEGACY_ID || (SPICY_LEVEL_IDS as readonly string[]).includes(id);
}

export function isSpicyName(name: unknown): boolean {
  const t = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return t === 'حار' || t === 'سبايسي' || t === 'spicy';
}

export function isSpicyAddon(featureId: unknown, name: unknown): boolean {
  return isSpicyFeatureId(featureId) || isSpicyName(name);
}

/** 0-based position of a spice level on the customer slider (mild 0,
 *  medium 1, extra-hot 2). Legacy 'spicy' and unknown ids return -1. */
export function spicyLevelIndex(featureId: unknown): number {
  if (typeof featureId !== 'string') return -1;
  const id = featureId.trim().toLowerCase();
  if (id === 'spicy-mild') return 0;
  if (id === 'spicy-medium') return 1;
  if (id === 'spicy-hot') return 2;
  return -1;
}

/** Flame count for a spice level (mild 1, medium 2, extra-hot 3).
 *  Legacy/unknown renders a single flame. */
export function spicyFlames(featureId: unknown): number {
  const i = spicyLevelIndex(featureId);
  return i >= 0 ? i + 1 : 1;
}

/** Short professional label for a spice level (title-case EN). Without an
 *  id (or with the legacy id) it falls back to the generic "Spicy"/"حار". */
export function spicyLabel(lang: 'en' | 'ar', featureId?: unknown): string {
  const i = spicyLevelIndex(featureId);
  if (lang === 'ar') {
    if (i === 0) return 'حار خفيف';
    if (i === 1) return 'حار متوسط';
    if (i === 2) return 'حار جدًا';
    return 'حار';
  }
  if (i === 0) return 'Mild';
  if (i === 1) return 'Medium';
  if (i === 2) return 'Extra Hot';
  return 'Spicy';
}

/** Explicit heat-degree label — always carries the heat word so a degree
 *  can never be mistaken for a size/variant ("(Regular) (Medium)" was
 *  genuinely ambiguous). Canonical degrees get fixed wording (حار خفيف /
 *  حار متوسط / حار جداً); an admin-renamed level keeps its name with the
 *  heat word prefixed. `fallbackLabel` is the stored level name. */
export function spicyDegreeLabel(lang: 'en' | 'ar', featureId?: unknown, fallbackLabel?: unknown): string {
  const i = spicyLevelIndex(featureId);
  if (lang === 'ar') {
    if (i === 0) return 'حار خفيف';
    if (i === 1) return 'حار متوسط';
    if (i === 2) return 'حار جدًا';
    const t = typeof fallbackLabel === 'string' ? fallbackLabel.trim() : '';
    if (!t) return 'حار';
    return t.includes('حار') ? t : `حار ${t}`;
  }
  if (i === 0) return 'Mild Heat';
  if (i === 1) return 'Medium Heat';
  if (i === 2) return 'Extra Hot';
  const t = typeof fallbackLabel === 'string' ? fallbackLabel.trim() : '';
  if (!t) return 'Spicy';
  return /hot|spicy/i.test(t) ? t : `${t} Heat`;
}

/** Locked library section + level defaults (single source of truth for the
 *  normalizers below and the admin UI). Names survive admin edits: the
 *  normalizer only fills these in when the row is missing. */
export const SPICY_SECTION_DEFAULT = {
  id: SPICY_GROUP_ID,
  name: { en: 'Make it Spicy', ar: 'اجعله حارًّا' },
  selection: 'single' as const,
  prompt: {
    en: 'Want to add some heat?',
    ar: 'هل تريد إضافة الحار؟',
  },
};

export const SPICY_LEVEL_DEFAULTS: ReadonlyArray<{
  id: SpicyLevelId;
  name: { en: string; ar: string };
}> = [
  { id: 'spicy-mild', name: { en: 'Mild', ar: 'حار خفيف' } },
  { id: 'spicy-medium', name: { en: 'Medium', ar: 'حار متوسط' } },
  { id: 'spicy-hot', name: { en: 'Extra Hot', ar: 'حار جدًا' } },
];

/**
 * Built-in features the admin UI must never delete (the library shows them
 * with a locked "built-in" badge instead of a delete button, and the
 * normalizer re-adds the missing levels if an old document lacks them).
 * NOTE: the legacy single 'spicy' id stays in this list for RECOGNITION
 * only (old carts, stored orders, Telegram history) — its library def was
 * retired: normalize no longer creates it and drops it when present, so
 * the Add-ons section never shows the confusing duplicate again.
 */
export const PROTECTED_FEATURE_IDS: readonly string[] = [
  SPICY_LEGACY_ID,
  ...SPICY_LEVEL_IDS,
];

/** Library sections the admin UI must never delete (the spicy levels live
 *  here; the customer sheet, cart and Telegram all key off this section). */
export const PROTECTED_GROUP_IDS: readonly string[] = [SPICY_GROUP_ID];

export function isProtectedFeatureId(featureId: unknown): boolean {
  return typeof featureId === 'string' && PROTECTED_FEATURE_IDS.includes(featureId);
}

export function isProtectedGroupId(groupId: unknown): boolean {
  return typeof groupId === 'string' && PROTECTED_GROUP_IDS.includes(groupId);
}

/**
 * "13:05" (24h) -> "1:05 PM" / "1:05 م", so AM/PM is never ambiguous.
 * Arabic uses the short م/ص (not the long صباحاً/مساءً): compact on phones
 * and the Levantine commercial convention. Shared by the admin preview
 * and every customer-facing hours line.
 */
export function formatTime12h(t: string, lang: 'en' | 'ar'): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((t || '').trim());
  if (!m) return t || '--:--';
  const h = parseInt(m[1], 10) % 24;
  const isAr = lang === 'ar';
  const suffix = h < 12 ? (isAr ? 'ص' : 'AM') : (isAr ? 'م' : 'PM');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

const DAY_ORDER = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
const DAY_SHORT: Record<string, { en: string; ar: string }> = {
  sat: { en: 'Sat', ar: 'السبت' },
  sun: { en: 'Sun', ar: 'الأحد' },
  mon: { en: 'Mon', ar: 'الاثنين' },
  tue: { en: 'Tue', ar: 'الثلاثاء' },
  wed: { en: 'Wed', ar: 'الأربعاء' },
  thu: { en: 'Thu', ar: 'الخميس' },
  fri: { en: 'Fri', ar: 'الجمعة' },
};

/**
 * The live hours range, derived from the ACTUAL settings — never a stale
 * free-text field. "Daily · 12:00 PM – 12:00 AM" when all 7 days are on,
 * otherwise the selected days + range. Changing open/close/days in
 * Working Hours & Status changes every customer-facing line at once
 * (status pill + footer), guaranteed.
 */
export function formatHoursRange(settings: MenuData['settings'], lang: 'en' | 'ar'): string {
  const isAr = lang === 'ar';
  const days = Array.isArray(settings.workingDays) && settings.workingDays.length
    ? [...settings.workingDays]
    : [...DAY_ORDER];
  const all = DAY_ORDER.every((d) => days.includes(d));
  const daysPart = all
    ? (isAr ? 'يوميًا' : 'Daily')
    : days
      .filter((d) => DAY_SHORT[d])
      .sort((a, b) => DAY_ORDER.indexOf(a as typeof DAY_ORDER[number]) - DAY_ORDER.indexOf(b as typeof DAY_ORDER[number]))
      .map((d) => (isAr ? DAY_SHORT[d].ar : DAY_SHORT[d].en))
      .join(isAr ? '، ' : ', ') || (isAr ? 'يوميًا' : 'Daily');
  const open = formatTime12h(settings.openTime || '12:00', lang);
  const close = formatTime12h(settings.closeTime || '00:00', lang);
  return isAr
    ? `${daysPart} · من ${open} إلى ${close}`
    : `${daysPart} · ${open} – ${close}`;
}

export function isOpenNow(settings: MenuData['settings'], nowMs?: number, reopensAt?: string | null): { isOpen: boolean; label: { en: string; ar: string } } {
  if (settings.statusMode === 'open') {
    return {
      isOpen: true,
      label: {
        en: `Open now · ${formatHoursRange(settings, 'en')}`,
        ar: `مفتوح الآن · ${formatHoursRange(settings, 'ar')}`
      }
    };
  }
  if (settings.statusMode === 'closed') {
    return {
      isOpen: false,
      label: {
        en: 'Closed now',
        ar: 'مغلق حاليًا'
      }
    };
  }

  // Auto mode
  try {
    const tz = settings.timezone || 'Asia/Beirut';
    // Server-corrected clock when the caller passes one (header pill):
    // a wrong phone clock must not flip open/closed against the server.
    const now = new Date(Number.isFinite(nowMs) ? (nowMs as number) : Date.now());
    // Current weekday in the restaurant timezone (sat..fri keys)
    let dayKey = '';
    try {
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now).toLowerCase().slice(0, 3);
      const dayMap: Record<string, string> = { sat: 'sat', sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri' };
      dayKey = dayMap[weekday] || '';
    } catch {}
    const workingDays = Array.isArray(settings.workingDays) && settings.workingDays.length
      ? settings.workingDays
      : ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
    if (dayKey && !workingDays.includes(dayKey)) {
      // Prefer the server's real reopen instant (already rolled to the next
      // working day) over today's opening time when the caller knows it.
      let reopenPartEn: string | null = null;
      let reopenPartAr: string | null = null;
      if (reopensAt) {
        const ms = Date.parse(reopensAt);
        if (Number.isFinite(ms)) {
          try {
            const dayEn = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(ms));
            const dayArMap: Record<string, string> = { Sat: 'السبت', Sun: 'الأحد', Mon: 'الاثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة' };
            reopenPartEn = `${dayEn} ${formatTime12h(settings.openTime || '12:00', 'en')}`;
            reopenPartAr = `${dayArMap[dayEn] || dayEn} ${formatTime12h(settings.openTime || '12:00', 'ar')}`;
          } catch {}
        }
      }
      return {
        isOpen: false,
        label: {
          en: `Closed today · Opens ${reopenPartEn || formatTime12h(settings.openTime || '12:00', 'en')}`,
          ar: `مغلق اليوم · يفتح ${reopenPartAr || formatTime12h(settings.openTime || '12:00', 'ar')}`,
        },
      };
    }
    // Get time in target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.format(now).split(':');
    // NB: hourCycle h23 can yield "24" at midnight — normalize like the server does.
    const curHour = parseInt(parts[0], 10) % 24;
    const curMin = parseInt(parts[1], 10);
    const curMinutes = curHour * 60 + curMin;

    const [openH, openM] = (settings.openTime || '12:00').split(':').map(Number);
    const [closeH, closeM] = (settings.closeTime || '00:00').split(':').map(Number);

    const openMinutes = openH * 60 + openM;
    let closeMinutes = closeH * 60 + closeM;

    let isOpen = false;
    if (closeMinutes <= openMinutes) {
      // Closes after midnight (e.g. 12:00 to 02:00 or 00:00)
      if (closeMinutes === 0) closeMinutes = 24 * 60;
      isOpen = curMinutes >= openMinutes || curMinutes < (closeMinutes % (24 * 60));
    } else {
      isOpen = curMinutes >= openMinutes && curMinutes < closeMinutes;
    }

    return {
      isOpen,
      label: {
        en: isOpen ? `Open now · ${formatHoursRange(settings, 'en')}` : `Closed · Opens at ${formatTime12h(settings.openTime || '12:00', 'en')}`,
        ar: isOpen ? `مفتوح الآن · ${formatHoursRange(settings, 'ar')}` : `مغلق · يفتح في ${formatTime12h(settings.openTime || '12:00', 'ar')}`
      }
    };
  } catch {
    return {
      isOpen: true,
      label: {
        en: `Open · ${formatHoursRange(settings, 'en')}`,
        ar: `مفتوح · ${formatHoursRange(settings, 'ar')}`
      }
    };
  }
}

export function sanitizeUrl(url: string | undefined): string {
  if (!url) return '#';
  const clean = url.trim();
  if (/^(https?:\/\/|tel:|mailto:)/i.test(clean)) return clean;
  // Bare domain pasted without a scheme (instagram.com/x) — assume https
  // so a missing "https://" never produces a dead "#" link.
  if (/^(www\.)?[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(clean)) return `https://${clean}`;
  return '#';
}

// ---- Customer ↔ restaurant distance (a clear customer-facing answer:
// "≈ 569.5 km from restaurant" instead of a confusing ±accuracy number) ----
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3;
  const t = Math.PI / 180;
  const dLat = (bLat - aLat) * t;
  const dLng = (bLng - aLng) * t;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Plausibility ceiling for a single delivery trip (mirrors
 * MAX_DELIVERY_DISTANCE_KM in functions/_shared/eta.js — keep in sync).
 * Beyond this the geometry is certainly wrong (a test pin, a stale
 * restaurant link) and the UI must hide the distance instead of showing
 * hundreds of kilometres.
 */
export const MAX_DELIVERY_DISTANCE_KM = 60;

/** Extract `lat,lng` from a Google Maps URL in ANY common shape:
 *  bare "lat,lng" · ?q= / ?query= / ?api=1&query= · ?ll= / ?center= ·
 *  directions ?destination= / ?origin= / ?saddr= / ?daddr= ·
 *  path "@lat,lng,zoom" (place/share URLs) · data "…!3dlat!4dlng" ·
 *  DMS "33°52'29.1"N 35°32'44.5"E" (decoded or URL-encoded, hemisphere
 *  suffixes optional — a missing suffix reads positive).
 *  Short links (maps.app.goo.gl) carry no coords — null there (the link
 *  itself still works as a directions URL). Null when absent/invalid.
 *  TWIN: functions/_shared/eta.js parseMapUrlCoordsJs — keep in sync. */
export function parseMapUrlCoords(url: string | undefined): { lat: number; lng: number } | null {
  if (!url) return null;
  const clean = url.trim();
  const inRange = (lat: number, lng: number) =>
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const pair = (a: string | undefined, b: string | undefined) => {
    if (a === undefined || b === undefined) return null;
    const lat = Number(a);
    const lng = Number(b);
    return inRange(lat, lng) ? { lat, lng } : null;
  };
  // Bare "lat,lng" typed by hand.
  let m = clean.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return pair(m[1], m[2]);
  // Query params: ?q=lat,lng · ?query= · ?api=1&query= · ?ll= · ?center=
  // · directions ?destination= / ?origin= / ?saddr= / ?daddr=.
  m = clean.match(/[?&](?:q|query|ll|center|destination|origin|saddr|daddr)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return pair(m[1], m[2]);
  // Path "@lat,lng,…" (desktop place URLs and "share" links).
  m = clean.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|$|[?/])/);
  if (m) return pair(m[1], m[2]);
  // Embed data "…!3dlat!4dlng…".
  m = clean.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return pair(m[1], m[2]);
  // DMS "33°52'29.1"N 35°32'44.5"E" — the shape Google Maps copies when the
  // owner shares coordinates in degrees mode (often URL-encoded, sometimes
  // pasted truncated without the trailing "E). Decoded first so %C2%B0/%22
  // forms parse identically. Suffixes optional (missing = positive);
  // minutes/seconds are range-checked so free text never matches.
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  m = decoded.match(/(\d{1,3})\s*[°ºdD]\s*(\d{1,2})\s*['′’mM]\s*(\d+(?:\.\d+)?)\s*(?:"|″|”|s|S)?\s*([NSns])?\s*[,;]?\s*(\d{1,3})\s*[°ºdD]\s*(\d{1,2})\s*['′’mM]\s*(\d+(?:\.\d+)?)\s*(?:"|″|”|s|S)?\s*([EWew])?/);
  if (m) {
    const dms = (
      deg: string, min: string, sec: string, hemi: string | undefined, neg: string,
    ): number => {
      const dd = Number(deg);
      const mm = Number(min);
      const ss = Number(sec);
      if (!Number.isFinite(dd) || mm >= 60 || ss >= 60) return NaN;
      let v = dd + mm / 60 + ss / 3600;
      if ((hemi || '').toUpperCase() === neg) v = -v;
      return v;
    };
    const lat = dms(m[1], m[2], m[3], m[4], 'S');
    const lng = dms(m[5], m[6], m[7], m[8], 'W');
    if (inRange(lat, lng)) return { lat, lng };
  }
  return null;
}

export type MapLocationKind = 'empty' | 'coords' | 'link' | 'search';

/** Whole-value coordinates check for a decoded Maps query string:
 * anchored decimal pair, or DMS covering the entire text (even truncated
 * mid-suffix, as owners often paste it cut off). Returns coords or null. */
function coordsQueryText(text: string): { lat: number; lng: number } | null {
  const t = (text || '').trim();
  if (!t) return null;
  const dm = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (dm) {
    const lat = Number(dm[1]);
    const lng = Number(dm[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
    return null;
  }
  // The DMS engine matches anywhere, so require nothing-but-coords text:
  // strip every char a DMS reading may contain; anything left means text.
  const stripped = t
    .replace(/[0-9\s.,;°ºdD'′’mM"″”sS+\-]/g, '')
    .replace(/[NSEWnsew]/g, '');
  if (stripped !== '') return null;
  return parseMapUrlCoords(t);
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Repair a Google Maps search URL whose query text IS coordinates
 * (decimal pair or DMS, even truncated mid-suffix): rewrite to canonical
 * decimals so Google always resolves it instead of showing "not found".
 * Place pages, directions, map views and short links ride through
 * untouched (returns null = not a pure coords search).
 */
export function canonicalCoordsSearchUrl(raw: string | undefined): string | null {
  const clean = (raw || '').trim();
  if (!clean) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`);
  } catch {
    return null;
  }
  if (!/^(www\.|maps\.)?google\.[a-z.]+(\.[a-z]{2})?$/i.test(url.hostname)) return null;
  const path = (url.pathname || '').replace(/\/+$/, '') || '/';
  const hasSearchParam = ['q', 'query', 'll', 'center'].some((k) => url.searchParams.get(k) !== null);
  if (path !== '/maps/search' && !(path === '/maps' && hasSearchParam)) return null;
  const rawQ = url.searchParams.get('query')
    ?? url.searchParams.get('q')
    ?? url.searchParams.get('ll')
    ?? url.searchParams.get('center');
  if (rawQ === null) return null;
  let text = rawQ;
  try {
    text = decodeURIComponent(rawQ.replace(/\+/g, ' '));
  } catch {
    /* keep raw */
  }
  const coords = coordsQueryText(text);
  if (!coords) return null;
  return `https://www.google.com/maps/search/?api=1&query=${round6(coords.lat)},${round6(coords.lng)}`;
}

/**
 * True when a WRITTEN-address value isn't really text: a pasted link
 * (scheme or domain+path) or bare coordinates. The footer hides such values
 * (a link must never render as address text) and the admin auto-converts
 * them to real text on sight. Plain names ("Hamra, Beirut") return false.
 */
export function looksLikeMapInput(raw: string | undefined): boolean {
  const clean = (raw || '').trim();
  if (!clean) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(clean)) return true;
  if (parseMapUrlCoords(clean) !== null) return true;
  const m = clean.match(/^(www\.)?[\w-]+(\.[\w-]+)+([/?#].*)?$/);
  return !!m && !!m[3] && m[3].length > 1;
}

/**
 * Accept a work location in ANY form the owner might paste or type and turn
 *  - "" → empty (buttons fall back to the written address search)
 *  - "33.89, 35.50" → coords search URL (also feeds the distance feature)
 *  - any https:// URL (goo.gl short links included) → kept verbatim
 *  - http:// → upgraded to https://
 *  - bare domain/path (maps.google.com/…) → https:// assumed
 *  - anything else ("Hamra, Beirut") → maps search URL for the text
 * Pure — same input always yields the same output, so the admin hint, the
 * client link builder and the backend validator can all share it in spirit
 * (backend mirrors this logic in plain JS; see validate-settings.js).
 */
export function normalizeMapLocation(raw: string | undefined): { url: string; kind: MapLocationKind } {
  const clean = (raw || '').trim();
  if (!clean) return { url: '', kind: 'empty' };
  // Bare "lat,lng" typed by hand (full-string match — a URL never matches).
  const cm = clean.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (cm) {
    const lat = Number(cm[1]);
    const lng = Number(cm[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, kind: 'coords' };
    }
    // Out-of-range numbers are not coords — fall through to text search.
  }
  const coords = parseMapUrlCoords(clean); // kind label for URLs carrying coords
  if (/^http:\/\//i.test(clean)) return { url: clean.replace(/^http:\/\//i, 'https://'), kind: coords ? 'coords' : 'link' };
  if (/^https:\/\//i.test(clean)) return { url: clean, kind: coords ? 'coords' : 'link' };
  // Bare domain/path without a scheme — assume https (never a dead "#" link).
  if (/^(www\.)?[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(clean)) return { url: `https://${clean}`, kind: coords ? 'coords' : 'link' };
  // Free text (a place name typed by hand) → maps search for that text.
  return { url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}`, kind: 'search' };
}

/** Customer-facing distance: whole meters below 1 km, 1-decimal km above. */
export function formatDistance(meters: number, lang: 'en' | 'ar'): string {
  const m = Math.max(0, meters);
  if (m < 1000) {
    const v = Math.round(m);
    return lang === 'ar' ? `≈ ${v} م` : `≈ ${v} m`;
  }
  const v = (Math.round((m / 1000) * 10) / 10).toFixed(1);
  return lang === 'ar' ? `≈ ${v} كم` : `≈ ${v} km`;
}

// Get Directions link: the saved location in whatever form it was stored
// (short link, full URL, raw coords, place name) normalized to a working
// Maps URL — otherwise falls back to a Maps search for the written address.
// A pure coords search is repaired to canonical decimals so Google resolves
// it instead of showing "not found". The text fallback prefers the written
// address in either language (English then Arabic), then the store name in
// either language — a store with only an Arabic address must still open a
// working search instead of "#".
export function buildMapUrl(settings: MenuData['settings']): string {
  const direct = normalizeMapLocation(settings.mapUrl).url;
  if (direct) return canonicalCoordsSearchUrl(direct) ?? direct;
  const query =
    (settings.address?.en || '').trim() ||
    (settings.address?.ar || '').trim() ||
    (settings.name?.en || '').trim() ||
    (settings.name?.ar || '').trim();
  if (query) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  return '#';
}
