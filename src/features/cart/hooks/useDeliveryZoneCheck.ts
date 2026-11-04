import * as React from 'react';
import { matchZone, normalizeZoneName, type DeliveryZones, type SubdivEntry } from '@/src/utils/deliveryZones';

/**
 * Resolves a pinned point to its delivery zone (country + subdivision) and
 * reports whether delivery there is served.
 *
 * How it works: the BigDataCloud FREE client-side reverse-geocode endpoint
 * (no key, no signup) turns the pin's coordinates into an ISO country code
 * and a principal subdivision, in the UI language. Called ONLY from the
 * customer's own browser, ONLY with a freshly picked live pin, on explicit
 * user action (picking/confirming a delivery location) — exactly the
 * fair-use shape (client-side, current location, user-initiated). The
 * response is matched against the admin's selected zones (code-first,
 * name-second so geocoder boundary drift can't false-block).
 *
 * Failure is ALWAYS soft (status 'unknown'): an unreachable geocoder or a
 * missing subdivision list must never strand the customer — the message
 * stays a warning and the server-side distance backstop still applies.
 */
export interface ZonePin {
  cc: string;
  subCode: string | null;
  subName: string | null;
}

export type ZoneStatus = 'idle' | 'checking' | 'ok' | 'outside' | 'unknown';

interface SubdivCacheEntry {
  at: number;
  promise: Promise<SubdivEntry[] | null>;
}
const subdivCache = new Map<string, SubdivCacheEntry>();
const SUBDIV_TTL_MS = 30 * 60 * 1000;

function loadSubdivisions(cc: string): Promise<SubdivEntry[] | null> {
  const key = cc.toUpperCase();
  const hit = subdivCache.get(key);
  if (hit && Date.now() - hit.at < SUBDIV_TTL_MS) return hit.promise;
  const promise = (async (): Promise<SubdivEntry[] | null> => {
    try {
      const res = await fetch(`/geo/subdivisions/${encodeURIComponent(key)}.json`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      if (!Array.isArray(data)) return null;
      const list = (data as unknown[])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({
          code: typeof x.code === 'string' ? x.code : '',
          en: typeof x.en === 'string' ? x.en : '',
          ar: typeof x.ar === 'string' ? x.ar : null,
          aliases: Array.isArray(x.aliases) ? (x.aliases as unknown[]).filter((a): a is string => typeof a === 'string') : undefined,
        }))
        .filter((x) => x.code && x.en);
      return list.length ? list : null;
    } catch {
      return null;
    }
  })();
  subdivCache.set(key, { at: Date.now(), promise });
  return promise;
}

const zoneCache = new Map<string, Promise<ZonePin | null>>();

/** Raw reverse-geocode of a live pin. Null on ANY failure (fail-soft). */
export function reverseGeocodeZone(lat: number, lng: number, lang: 'en' | 'ar'): Promise<ZonePin | null> {
  const key = `${Math.round(lat * 1e5) / 1e5},${Math.round(lng * 1e5) / 1e5},${lang}`;
  const hit = zoneCache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<ZonePin | null> => {
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 6000);
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lng))}&localityLanguage=${lang === 'ar' ? 'ar' : 'en'}`;
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      window.clearTimeout(timer);
      if (!res.ok) return null;
      const d = (await res.json()) as Record<string, unknown>;
      const cc = typeof d.countryCode === 'string' ? d.countryCode.trim().toUpperCase() : '';
      if (!/^[A-Z]{2}$/.test(cc)) return null;
      const subCode = typeof d.principalSubdivisionCode === 'string' && d.principalSubdivisionCode.trim()
        ? d.principalSubdivisionCode.trim()
        : null;
      const subName = typeof d.principalSubdivision === 'string' && d.principalSubdivision.trim()
        ? d.principalSubdivision.trim()
        : null;
      return { cc, subCode, subName };
    } catch {
      return null;
    }
  })();
  zoneCache.set(key, p);
  return p;
}

export interface ZoneCheck {
  status: ZoneStatus;
  /** Resolved pin zone (when geocoding succeeded). Sent to the server. */
  pin: ZonePin | null;
  /** Human-readable resolved place (for the blocked panel / debugging). */
  placeName: string | null;
}

/**
 * React binding: re-checks whenever the pin, the zone config, or the UI
 * language changes. Stale-flight safe (a newer pin wins, older resolves
 * are ignored). Only runs the network call for delivery with selected
 * zones configured — everywhere else it stays idle (zero requests).
 */
export function useDeliveryZoneCheck(
  zones: DeliveryZones | undefined,
  orderType: 'delivery' | 'pickup' | 'dinein',
  location: { lat: number; lng: number } | null,
  lang: 'en' | 'ar',
): ZoneCheck {
  const [state, setState] = React.useState<ZoneCheck>({ status: 'idle', pin: null, placeName: null });
  const flight = React.useRef(0);

  React.useEffect(() => {
    if (orderType !== 'delivery' || !zones || zones.mode !== 'selected' || !location) {
      flight.current += 1;
      setState({ status: 'idle', pin: null, placeName: null });
      return;
    }
    const my = ++flight.current;
    setState({ status: 'checking', pin: null, placeName: null });
    void (async () => {
      const pin = await reverseGeocodeZone(location.lat, location.lng, lang);
      if (flight.current !== my) return;
      if (!pin) {
        // Geocoder unreachable/blocked: fail SOFT (warning only). The
        // server-side distance backstop still guards the order.
        setState({ status: 'unknown', pin: null, placeName: null });
        return;
      }
      let subdivs: SubdivEntry[] | null = null;
      try {
        subdivs = await loadSubdivisions(pin.cc);
      } catch {
        subdivs = null;
      }
      if (flight.current !== my) return;
      const ok = matchZone(zones, pin.cc, { code: pin.subCode, name: pin.subName }, subdivs);
      // Display name prefers the admin's own library wording when the
      // subdivision matched a known entry.
      let place: string | null = pin.subName || pin.cc;
      if (subdivs) {
        const norm = normalizeZoneName(pin.subName);
        const hit = subdivs.find(
          (s) => s.code === (pin.subCode || '').toUpperCase() || normalizeZoneName(s.en) === norm || (s.ar && normalizeZoneName(s.ar) === norm),
        );
        if (hit) place = lang === 'ar' ? hit.ar || hit.en : hit.en;
      }
      setState({ status: ok ? 'ok' : 'outside', pin, placeName: place });
    })();
    return () => {
      flight.current += 1;
    };
  }, [orderType, zones, location?.lat, location?.lng, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
