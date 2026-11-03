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

/** Bare-coords fallback shape (`"33.89352, 35.50161"`): always overwritable. */
export const COORDS_RE = /^-?\d{1,3}\.\d{1,5},\s*-?\d{1,3}\.\d{1,5}$/;

/**
 * Pure address-merge rule for a confirmed pick (testable without React).
 * Overwrite the field when it is empty, still holds our own previous
 * auto-fill, or is a bare coords fallback — genuinely typed text
 * (building, floor, landmark) is preserved. A remembered address paired
 * with a remembered pin must be passed as `prevFill` (see the checkout
 * hook seeding) so the first re-pin overwrites it instead of stranding a
 * stale street with a fresh pin.
 */
export function shouldOverwriteAddress(curAddress: string, prevFill: string | null): boolean {
  const cur = (curAddress ?? '').trim();
  if (!cur) return true;
  if (prevFill !== null && cur === prevFill) return true;
  if (COORDS_RE.test(cur)) return true;
  return false;
}

/** Reverse-geocode via OpenStreetMap Nominatim (called only on Confirm). */
export async function reverseGeocode(lat: number, lng: number, lang: 'en' | 'ar'): Promise<string | null> {
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
