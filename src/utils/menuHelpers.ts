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

/** Extract `lat,lng` from a Google Maps URL (?q= / ?query=). Null when absent/invalid. */
export function parseMapUrlCoords(url: string | undefined): { lat: number; lng: number } | null {
  if (!url) return null;
  const m = url.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
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

// Get Directions link: uses the saved Google Maps URL when valid,
// otherwise falls back to a Maps search for the written address.
export function buildMapUrl(settings: MenuData['settings']): string {
  const direct = (settings.mapUrl || '').trim();
  if (direct.startsWith('https://')) return direct;
  const query = (settings.address?.en || '').trim() || (settings.name?.en || '').trim();
  if (query) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  return '#';
}
