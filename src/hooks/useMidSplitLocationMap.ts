import { useEffect, useRef, useState } from 'react';
import { readJson } from '@/src/utils/safeJson';

export const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

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

/** House number + road + district + city — the deliverable address. */
export function formatNominatim(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { address?: Record<string, string>; display_name?: string; name?: string };
  const addr = d.address && typeof d.address === 'object' ? d.address : null;
  if (addr) {
    const road = [addr.house_number, addr.road || addr.street || addr.pedestrian].filter((p) => typeof p === 'string' && p.trim()).join(' ');
    const district = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || '';
    const city = addr.city || addr.town || addr.village || addr.state || '';
    const full = [road, district, city].filter((p) => p && p.trim()).join(', ');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point, ready]);
  return { addrPreview, addrLoading, previewKey };
}
