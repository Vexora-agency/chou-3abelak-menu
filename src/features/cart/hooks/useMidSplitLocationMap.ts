import { useEffect, useRef, useState } from 'react';
import { readJson } from '@/src/utils/safeJson';

export const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** Single silent on-open fix: high accuracy, ~8s, no retry (see picker). */
export const AUTO_LOCATE_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 0,
};

/** True only when there is no saved/pinned point to center on. */
export function shouldAutoLocateOnOpen(
  initial: { lat: number; lng: number } | null | undefined,
): boolean {
  return initial == null;
}

/**
 * A confirmed pin is the source of truth for the delivery address.
 *
 * The picker's reverse-geocoded text (or the bare coords fallback when
 * geocoding fails) always replaces whatever was in the address field. A
 * manually typed address belongs to the PREVIOUS pin; keeping it after a new
 * pin created a mismatched ticket (old text + new coords). The customer can
 * still refine the fresh address afterwards (building, floor, landmark).
 */
export function pinAddress(lat: number, lng: number, addressText: string | null): string {
  const text = typeof addressText === 'string' ? addressText.trim() : '';
  return (text || `${lat}, ${lng}`).slice(0, 200);
}

/** Optional exact-delivery details (Talabat-style): building, floor,
 * apartment and landmark composed into the confirmed address so the
 * driver gets one exact deliverable line with the pin. Pure — unit
 * tested in scripts/test-pin-precision.mjs. */
export interface PreciseDetails {
  building: string;
  floor: string;
  apt: string;
  landmark: string;
}

/** Base reverse text (or the coords fallback) + structured details, ≤200 chars. */
export function composePreciseAddress(
  base: string | null,
  d: PreciseDetails,
  lat: number,
  lng: number,
  lang: 'en' | 'ar',
): string {
  const clean = (s: string) => (typeof s === 'string' ? s.trim().slice(0, 60) : '');
  const b = clean(d.building);
  const f = clean(d.floor);
  const a = clean(d.apt);
  const l = clean(d.landmark);
  const parts: string[] = [];
  if (lang === 'ar') {
    if (b) parts.push(`مبنى ${b}`);
    if (f) parts.push(`الدور ${f}`);
    if (a) parts.push(`شقة ${a}`);
    if (l) parts.push(`علامة: ${l}`);
  } else {
    if (b) parts.push(`Bldg ${b}`);
    if (f) parts.push(`Floor ${f}`);
    if (a) parts.push(`Apt ${a}`);
    if (l) parts.push(`Landmark: ${l}`);
  }
  const head = typeof base === 'string' && base.trim() ? base.trim() : `${lat}, ${lng}`;
  const sep = lang === 'ar' ? '، ' : ', ';
  return (parts.length > 0 ? `${head} — ${parts.join(sep)}` : head).slice(0, 200);
}

/** Reverse-geocode via the server proxy (building level), direct Nominatim
 * only as a fallback when the proxy is unreachable. The proxy carries the
 * identifying User-Agent the Nominatim usage policy requires — browsers
 * cannot set one themselves. */
export async function reverseGeocode(lat: number, lng: number, lang: 'en' | 'ar'): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(
        `/api/geo/reverse?lat=${lat}&lng=${lng}&lang=${lang === 'ar' ? 'ar' : 'en'}`,
        { signal: ctrl.signal, headers: { Accept: 'application/json', 'X-Requested-With': 'menu-customer' } },
      );
      if (res.ok) {
        const data: unknown = await readJson(res);
        const addr = data && typeof data === 'object' ? (data as { ok?: unknown; address?: unknown }) : null;
        if (addr && addr.ok === true) {
          if (typeof addr.address === 'string' && addr.address.trim()) return addr.address.slice(0, 200);
          if (addr.address === null) return await directReverseGeocode(lat, lng, lang);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* fall through to the direct lookup */
  }
  return directReverseGeocode(lat, lng, lang);
}

/** Direct Nominatim lookup (fallback only — no identifying UA possible). */
async function directReverseGeocode(lat: number, lng: number, lang: 'en' | 'ar'): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    // zoom=18 = building level (not street level).
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=${lang === 'ar' ? 'ar' : 'en'}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data: unknown = await readJson(res);
    return formatNominatim(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Place + road + district + city — the deliverable address.
 * Key coverage is deliberately wide: Lebanese OSM data often tags roads
 * as footway/residential and districts as borough/hamlet — the narrow
 * lookup used to return just "Beirut" (the "wrong address" bug). A nearby
 * named place (shop/amenity/building) is kept as a landmark prefix: the
 * kitchen delivers faster with "near X" than with a bare road. */
export function formatNominatim(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { address?: Record<string, string>; display_name?: string; name?: string };
  const addr = d.address && typeof d.address === 'object' ? d.address : null;
  if (addr) {
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const road = [addr.house_number, addr.road || addr.street || addr.pedestrian || addr.footway || addr.residential || addr.cycleway || addr.path || '']
      .map(str).filter(Boolean).join(' ');
    const district = str(addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || addr.borough || addr.municipality || addr.hamlet || addr.subdivision);
    const city = str(addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state_district || addr.state);
    // Landmark: the named feature itself (building/shop) when it is not
    // already the road — "near X" is what the driver actually needs.
    const place = str(d.name || addr.amenity || addr.shop || addr.building || addr.leisure);
    const full = [place && place !== road ? place : '', road, district, city].map(str).filter(Boolean).join(', ');
    if (full) return full;
  }
  if (typeof d.display_name === 'string' && d.display_name.trim()) {
    return d.display_name.split(',').slice(0, 4).join(',').trim() || null;
  }
  return null;
}

interface PreviewPoint { lat: number; lng: number }

export function useMidSplitLocationMap(
  point: (PreviewPoint & { accuracy: number }) | null,
  ready: boolean,
  lang: 'en' | 'ar'
): {
  addrPreview: string | null;
  addrLoading: boolean;
  previewKey: React.MutableRefObject<string>;
} {
  // Live address preview: re-looked-up (debounced) on every pin move so the
  // customer verifies the exact text BEFORE confirming.
  const [addrPreview, setAddrPreview] = useState<string | null>(null);
  const [addrLoading, setAddrLoading] = useState(false);
  const previewKey = useRef('');
  useEffect(() => {
    if (!point || !ready) {
      return;
    }
    const key = `${point.lat},${point.lng}`;
    // Loading flag for the async geocode below (settles in its finally).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading flag for async work, see above
    setAddrLoading(true);
    let alive = true;
    const runReverse = async () => {
      try {
        const addr = await reverseGeocode(point.lat, point.lng, lang);
        if (!alive) return;
        previewKey.current = key;
        setAddrPreview(addr);
      } catch {
        if (!alive) return;
        previewKey.current = key;
        setAddrPreview(null);
      } finally {
        if (alive) setAddrLoading(false);
      }
    };
    const timer = window.setTimeout(() => { void runReverse(); }, 700);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // lang included: switching language re-looks-up the preview in the new
    // language instead of showing a stale one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point, ready, lang]);
  return { addrPreview, addrLoading, previewKey };
}
