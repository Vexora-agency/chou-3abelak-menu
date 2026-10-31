import { MenuData } from '@/src/types/menu';

export { pickLangText, badgeLabel, buildWhatsAppMessage } from '@/src/utils/whatsapp';
export type { WhatsAppLine } from '@/src/utils/whatsapp';
export { ensureSettingsBlocks } from '@/src/utils/menuValidation';

export function isOpenNow(settings: MenuData['settings']): { isOpen: boolean; label: { en: string; ar: string } } {
  if (settings.statusMode === 'open') {
    return {
      isOpen: true,
      label: {
        en: `Open now · ${settings.hoursText.en || 'Welcome'}`,
        ar: `مفتوح الآن · ${settings.hoursText.ar || 'أهلاً بكم'}`
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
    const now = new Date();
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
      return {
        isOpen: false,
        label: {
          en: `Closed today · Opens ${settings.openTime || '12:00'}`,
          ar: `مغلق اليوم · يفتح ${settings.openTime || '12:00'}`,
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
        en: isOpen ? `Open now · ${settings.hoursText.en}` : `Closed · Opens at ${settings.openTime}`,
        ar: isOpen ? `مفتوح الآن · ${settings.hoursText.ar}` : `مغلق · يفتح في ${settings.openTime}`
      }
    };
  } catch {
    return {
      isOpen: true,
      label: {
        en: `Open · ${settings.hoursText?.en || '12:00 PM – 12:00 AM'}`,
        ar: `مفتوح · ${settings.hoursText?.ar || '12:00 ظهراً – 12:00 صباحاً'}`
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

/** Extract `lat,lng` from a Google Maps URL in ANY common shape:
 *  bare "lat,lng" · ?q= / ?query= / ?api=1&query= · ?ll= / ?center= ·
 *  directions ?destination= / ?origin= / ?saddr= / ?daddr= ·
 *  path "@lat,lng,zoom" (place/share URLs) · data "…!3dlat!4dlng".
 *  Short links (maps.app.goo.gl) carry no coords — null there (the link
 *  itself still works as a directions URL). Null when absent/invalid. */
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
