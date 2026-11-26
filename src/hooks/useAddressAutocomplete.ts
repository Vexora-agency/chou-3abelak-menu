import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { inScopeBoxes, loadPlacesIndex, loadStreetIndex, matchRecentPlaces, mergeLocalFirst, saveRecentPlace, searchPlaces, searchStreetIndex } from '../utils/streetIndex';

export interface AddressSuggestion {
  label: string;
  line1: string;
  line2: string;
  /** Null for Google rows: coordinates resolve once on pick via
   * /api/geo/place-details (predictions carry no geometry by design). */
  lat: number | null;
  lng: number | null;
  details?: string;
  /** Google placeId (server never exposes the API key to use it). */
  placeId?: string;
}

export interface UseAddressAutocompleteOptions {
  query: string;
  lang: 'en' | 'ar';
  country: string;
  enabled?: boolean;
  /** Live map viewport: ranks nearby streets first. Rounded for cache hits. */
  bias?: { lat: number; lng: number } | null;
  /**
   * True while the viewport is still the untouched opening center (map not
   * panned, pin not dragged, nothing picked). The server then prefers its
   * network location over the fallback center, so a customer whose GPS is
   * still fixing (or denied) gets their own city first — not the
   * restaurant's. Any deliberate move flips this to false.
   */
  autoBias?: boolean;
  /** Selected area name (from the area picker): appended to the SERVER
   * query only («شارع 16، السيوف») — local indexes match street names
   * alone and must not require the area token. */
  area?: string;
}

export interface UseAddressAutocompleteResult {
  suggestions: AddressSuggestion[];
  loading: boolean;
  error: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  selectSuggestion: (s: AddressSuggestion) => void;
  clearPicked: () => void;
  handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => 'pick' | 'close' | null;
  /** Billing-session token for the current search (Google session pricing):
   * stable across this query's keystrokes, rotated after pick or 3 min. */
  takePlaceSession: () => string;
  /** Close the billing session (call after place-details resolves). */
  endPlaceSession: () => void;
  /** Explicit search (the «بحث» button): reruns the full cascade at once,
   * skipping the debounce delay and the session cache. */
  forceSearch: () => void;
}

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;
const CACHE_CAP = 50;
const SESSION_TTL_MS = 180000; // Google billing sessions stay short-lived.

// Session-level cache shared by all hook instances.
const sessionCache = new Map<string, AddressSuggestion[]>();

function cacheKey(lang: string, country: string, query: string, bias: { lat: number; lng: number } | null | undefined, autoBias: boolean): string {
  const b = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)
    ? `${Math.round(bias.lat * 100) / 100},${Math.round(bias.lng * 100) / 100}`
    : '';
  return `${lang}|${country}|${query}|${b}|${autoBias ? 'auto' : 'view'}`;
}

function cacheSet(key: string, value: AddressSuggestion[]): void {
  sessionCache.set(key, value);
  while (sessionCache.size > CACHE_CAP) {
    const oldest = sessionCache.keys().next();
    if (oldest.done) break;
    sessionCache.delete(oldest.value);
  }
}

function isAddressSuggestion(v: unknown): v is AddressSuggestion {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const hasCoords = (typeof o.lat === 'number' && typeof o.lng === 'number')
    || (o.lat === null && o.lng === null && typeof o.placeId === 'string');
  return (
    typeof o.label === 'string' &&
    typeof o.line1 === 'string' &&
    typeof o.line2 === 'string' &&
    hasCoords &&
    (o.details === undefined || typeof o.details === 'string') &&
    (o.placeId === undefined || typeof o.placeId === 'string')
  );
}

/**
 * Resolve one picked Google suggestion to coordinates (one call per PICK,
 * never per keystroke). Pass the session token from takePlaceSession so
 * Google bills autocomplete + details as one session. Null when the id is
 * malformed, the proxy is unreachable, or the budget is spent — the caller
 * keeps the search open.
 */
export async function fetchPlaceCoords(placeId: string, sessionToken?: string): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    if (typeof placeId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(placeId)) return null;
    const query = `/api/geo/place-details?placeId=${encodeURIComponent(placeId)}`
      + (typeof sessionToken === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(sessionToken)
        ? `&session=${encodeURIComponent(sessionToken)}`
        : '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(
        query,
        { signal: ctrl.signal, headers: { Accept: 'application/json', 'X-Requested-With': 'menu-customer' } },
      );
      if (!res.ok) return null;
      const data: unknown = await res.json().catch(() => null);
      if (!data || typeof data !== 'object') return null;
      const d = data as { ok?: unknown; lat?: unknown; lng?: unknown; label?: unknown };
      if (d.ok !== true || typeof d.lat !== 'number' || !Number.isFinite(d.lat)) return null;
      if (typeof d.lng !== 'number' || !Number.isFinite(d.lng)) return null;
      return { lat: d.lat, lng: d.lng, label: typeof d.label === 'string' && d.label ? d.label : `${d.lat}, ${d.lng}` };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function extractSuggestions(payload: unknown): AddressSuggestion[] {
  const raw: unknown = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null
      ? ((payload as Record<string, unknown>).results ??
        (payload as Record<string, unknown>).suggestions ??
        [])
      : [];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isAddressSuggestion);
}

/**
 * Shared address-autocomplete client used by cart checkout and account
 * settings address fields. Debounced fetch against
 * GET /api/geo/autocomplete; any failure degrades silently to manual typing.
 */
export function useAddressAutocomplete({
  query,
  lang,
  country,
  enabled = true,
  bias = null,
  area = '',
  autoBias = false,
}: UseAddressAutocompleteOptions): UseAddressAutocompleteResult {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  // Explicit search (the «بحث» button / Enter on empty results): reruns the
  // full cascade immediately, skipping the debounce delay and the session
  // cache. An in-flight keystroke still wins — it aborts this run.
  const [forceNonce, setForceNonce] = useState(0);
  const forceSearch = useCallback(() => {
    setPickedLabel(null);
    setForceNonce((n) => n + 1);
  }, []);
  const nonceRef = useRef(forceNonce);
  // Live viewport, decoupled from fetching: the map recenters constantly
  // on mobile (GPS drift, auto-pan, programmatic setView) and every center
  // change used to abort the in-flight search and restart it — a perpetual
  // cancel loop where suggestions never arrive. The bias is now read at
  // fetch time only; a moved map clears stale rows instead of refetching.
  const biasRef = useRef<{ lat: number; lng: number } | null>(null);
  biasRef.current = bias;
  // Admin subdivision scope, cached from the last server answer
  // (`zoneScope: [{ cc, bboxes }]`): the on-device indexes filter their
  // rows with it, mirroring the server post-filter. Null = unrestricted
  // (first search, or the admin serves whole countries).
  const scopeRef = useRef<Array<[number, number, number, number]> | null>(null);
  const biasKey = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)
    ? `${Math.round(bias.lat * 100) / 100},${Math.round(bias.lng * 100) / 100}`
    : '';
  const prevBiasKeyRef = useRef(biasKey);
  useEffect(() => {
    if (prevBiasKeyRef.current !== biasKey) {
      prevBiasKeyRef.current = biasKey;
      // Drop rows ranked for the old viewport; the next keystroke fetches
      // with the fresh center. Never aborts: an in-flight search keeps its
      // (slightly older) bias and still resolves.
      setSuggestions([]);
      setActiveIndex(-1);
    }
  }, [biasKey]);
  // Billing session for Google session pricing: one token per search,
  // shared by this query's autocomplete calls and closed by the
  // place-details call on pick (rotates after 3 minutes regardless).
  const placeSessionRef = useRef<{ id: string; startedAt: number } | null>(null);
  const takePlaceSession = useCallback((): string => {
    const now = Date.now();
    if (!placeSessionRef.current || now - placeSessionRef.current.startedAt > SESSION_TTL_MS) {
      const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : `s${Math.random().toString(36).slice(2)}${now.toString(36)}`;
      placeSessionRef.current = { id, startedAt: now };
    }
    return placeSessionRef.current.id;
  }, []);
  const endPlaceSession = useCallback(() => {
    placeSessionRef.current = null;
  }, []);

  // A picked suggestion must never trigger a fetch; the marker clears as
  // soon as the user edits the text manually.
  useEffect(() => {
    if (pickedLabel !== null && query.trim() !== pickedLabel) {
      setPickedLabel(null);
    }
  }, [query, pickedLabel]);

  useEffect(() => {
    const trimmed = query.trim();
    // Server query = typed text + selected area («شارع 16، السيوف»):
    // providers rank far better with the area attached, while the local
    // indexes keep matching the street alone.
    const areaSuffix = typeof area === 'string' ? area.trim().slice(0, 60) : '';
    const serverQuery = areaSuffix && !trimmed.includes(areaSuffix)
      ? `${trimmed}، ${areaSuffix}`
      : trimmed;

    // Just-picked text: never fetch.
    if (pickedLabel !== null && trimmed === pickedLabel) {
      setLoading(false);
      return;
    }

    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setLoading(false);
      setError(false);
      setActiveIndex(-1);
      setOpen(false);
      return;
    }

    const key = cacheKey(lang, country, serverQuery, bias, autoBias);
    const forced = nonceRef.current !== forceNonce;
    nonceRef.current = forceNonce;
    const cached = forced ? undefined : sessionCache.get(key);
    if (cached) {
      setSuggestions(cached);
      setActiveIndex(-1);
      setError(false);
      setLoading(false);
      setOpen(true);
      return;
    }

    setOpen(true);
    setError(false);
    setLoading(true);

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        // Instant local answers first when the viewport is trusted (human
        // pan/pick or GPS fix), zero network, most personal first: this
        // device's own picks, then the downloadable places library, then
        // the region street index. On an untouched fallback viewport the
        // server (network location) leads instead — see merge below.
        // Viewport bias is read here — at fetch time — so map movement
        // never aborts typing (see biasRef above).
        const liveBias = biasRef.current;
        let local: AddressSuggestion[] = [];
        let recentCount = 0;
        try {
          local = matchRecentPlaces(trimmed);
          recentCount = local.length;
          const [placesIdx, streetIdx] = await Promise.all([
            loadPlacesIndex(country, liveBias),
            loadStreetIndex(country, liveBias),
          ]);
          if (controller.signal.aborted) return;
          // Admin subdivision scope (cached from the last server answer):
          // index rows outside every selected box are hidden, exactly like
          // the server post-filter. The device's own recents always stay.
          const scope = scopeRef.current;
          if (placesIdx) {
            const rows = searchPlaces(placesIdx.entries, trimmed, lang, 4, liveBias)
              .filter((r) => inScopeBoxes(r.lat, r.lng, scope));
            local = mergeLocalFirst(local, rows);
          }
          if (streetIdx) {
            const rows = searchStreetIndex(streetIdx.entries, trimmed, streetIdx.cityAr, streetIdx.cityEn, lang, 8, liveBias)
              .filter((r) => inScopeBoxes(r.lat, r.lng, scope));
            local = mergeLocalFirst(local, rows);
          }
          if (local.length > 0) {
            setSuggestions(local);
            setActiveIndex(-1);
          }
        } catch {
          /* local is best-effort; the server pass still runs */
        }
        try {
          const params = new URLSearchParams({ q: serverQuery, lang, country });
          if (liveBias && Number.isFinite(liveBias.lat) && Number.isFinite(liveBias.lng)) {
            params.set('lat', String(Math.round(liveBias.lat * 1000) / 1000));
            params.set('lng', String(Math.round(liveBias.lng * 1000) / 1000));
          }
          // Untouched opening viewport (or a bias-less field): let the
          // server prefer its network location over the fallback center.
          // Sent even without lat/lng so bias-less fields still get it.
          if (autoBias) params.set('auto', '1');
          // Billing session groups this search's autocomplete calls with
          // the eventual place-details call (Google session pricing).
          try {
            params.set('session', takePlaceSession());
          } catch {
            /* session is best-effort; the search runs without it */
          }
          const res = await fetch(
            `/api/geo/autocomplete?${params.toString()}`,
            {
              headers: { 'X-Requested-With': 'menu-customer' },
              signal: controller.signal,
            },
          );
          if (!res.ok) throw new Error('geo autocomplete failed');
          const payload: unknown = await res.json();
          try {
            const zs = (payload as { zoneScope?: unknown }).zoneScope;
            if (Array.isArray(zs) && zs.length > 0) {
              const boxes: Array<[number, number, number, number]> = [];
              for (const entry of zs) {
                const b = (entry as { bboxes?: unknown }).bboxes;
                if (Array.isArray(b)) {
                  for (const box of b) {
                    if (Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === 'number' && Number.isFinite(n))) {
                      boxes.push([box[0], box[1], box[2], box[3]]);
                    }
                  }
                }
              }
              scopeRef.current = boxes.length > 0 ? boxes : null;
            } else {
              scopeRef.current = null;
            }
          } catch {
            scopeRef.current = null;
          }
          const items = extractSuggestions(payload);
          // Trusted viewport (human pan/pick or GPS fix): instant local
          // rows lead. Untouched fallback viewport: the fallback center is
          // unreliable (wrong city possible), so the server — which prefers
          // the network location — leads; only the device's own recents
          // keep their head start.
          const merged = autoBias
            ? mergeLocalFirst(mergeLocalFirst(local.slice(0, recentCount), items), local.slice(recentCount))
            : mergeLocalFirst(local, items);
          cacheSet(key, merged);
          setSuggestions(merged);
          setActiveIndex(-1);
          setError(false);
          setOpen(true);
        } catch {
          // Aborted by a newer keystroke/unmount: leave state to the next run.
          if (controller.signal.aborted) return;
          // Silent fallback: local streets (when any) keep working, else
          // manual typing keeps working, no banner.
          if (local.length > 0) {
            setSuggestions(local);
            setActiveIndex(-1);
            setError(false);
          } else {
            setSuggestions([]);
            setActiveIndex(-1);
            setError(true);
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    }, forced ? 0 : DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, lang, country, enabled, pickedLabel, area, autoBias, forceNonce]);

  const selectSuggestion = useCallback((s: AddressSuggestion) => {
    setPickedLabel(s.label);
    // Remember this device's own pick for instant future suggestions.
    try { saveRecentPlace(s); } catch {}
    // Drop stale results so refocusing the field never pops the old list
    // back open without the user typing again.
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const clearPicked = useCallback(() => {
    setPickedLabel(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): 'pick' | 'close' | null => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        if (suggestions.length > 0) {
          setActiveIndex((prev) => (prev + 1) % suggestions.length);
        }
        return null;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
        if (suggestions.length > 0) {
          setActiveIndex(
            (prev) => (prev - 1 + suggestions.length) % suggestions.length,
          );
        }
        return null;
      }
      if (e.key === 'Enter') {
        if (open && suggestions.length > 0) {
          e.preventDefault();
          return 'pick';
        }
        return null;
      }
      if (e.key === 'Escape') {
        if (!open) return null;
        setOpen(false);
        setActiveIndex(-1);
        return 'close';
      }
      return null;
    },
    [open, suggestions.length],
  );

  return {
    suggestions,
    loading,
    error,
    open,
    setOpen,
    activeIndex,
    setActiveIndex,
    selectSuggestion,
    clearPicked,
    handleKeyDown,
    takePlaceSession,
    endPlaceSession,
    forceSearch,
  };
}
