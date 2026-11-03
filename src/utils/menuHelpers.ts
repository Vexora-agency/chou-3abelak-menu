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
    if (k === 'top') return 'الأكثر طلباً';
    if (k === 'spicy') return 'حار';
    if (k === 'new') return 'جديد';
    return key;
  }
  return key.toUpperCase();
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
    ? (isAr ? 'يومياً' : 'Daily')
    : days
      .filter((d) => DAY_SHORT[d])
      .sort((a, b) => DAY_ORDER.indexOf(a as typeof DAY_ORDER[number]) - DAY_ORDER.indexOf(b as typeof DAY_ORDER[number]))
      .map((d) => (isAr ? DAY_SHORT[d].ar : DAY_SHORT[d].en))
      .join(isAr ? '، ' : ', ') || (isAr ? 'يومياً' : 'Daily');
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
        ar: 'مغلق حالياً'
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
export function buildMapUrl(settings: MenuData['settings']): string {
  const direct = normalizeMapLocation(settings.mapUrl).url;
  if (direct) return direct;
  const query = (settings.address?.en || '').trim() || (settings.name?.en || '').trim();
  if (query) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  return '#';
}
