import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { loadStreetIndex, matchRecentPlaces, mergeLocalFirst, saveRecentPlace, searchStreetIndex } from '../utils/streetIndex';

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
}

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;
const CACHE_CAP = 50;

// Session-level cache shared by all hook instances.
const sessionCache = new Map<string, AddressSuggestion[]>();

function cacheKey(lang: string, country: string, query: string, bias: { lat: number; lng: number } | null | undefined): string {
  const b = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)
    ? `${Math.round(bias.lat * 100) / 100},${Math.round(bias.lng * 100) / 100}`
    : '';
  return `${lang}|${country}|${query}|${b}`;
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
 * never per keystroke). Null when the id is malformed, the proxy is
 * unreachable, or the budget is spent — the caller keeps the search open.
 */
export async function fetchPlaceCoords(placeId: string): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    if (typeof placeId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(placeId)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(
        `/api/geo/place-details?placeId=${encodeURIComponent(placeId)}`,
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
}: UseAddressAutocompleteOptions): UseAddressAutocompleteResult {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);

  // A picked suggestion must never trigger a fetch; the marker clears as
  // soon as the user edits the text manually.
  useEffect(() => {
    if (pickedLabel !== null && query.trim() !== pickedLabel) {
      setPickedLabel(null);
    }
  }, [query, pickedLabel]);

  useEffect(() => {
    const trimmed = query.trim();

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

    const key = cacheKey(lang, country, trimmed, bias);
    const cached = sessionCache.get(key);
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
        // Instant local answers first, zero network, most personal first:
        // this device's own picks, then the region street index. The server
        // passes merge behind.
        let local: AddressSuggestion[] = [];
        try {
          local = matchRecentPlaces(trimmed);
          const idx = await loadStreetIndex(country, bias);
          if (controller.signal.aborted) return;
          if (idx) {
            local = mergeLocalFirst(local, searchStreetIndex(idx.entries, trimmed, idx.cityAr, idx.cityEn, lang, 8, bias));
            if (local.length > 0) {
              setSuggestions(local);
              setActiveIndex(-1);
            }
          } else if (local.length > 0) {
            setSuggestions(local);
            setActiveIndex(-1);
          }
        } catch {
          /* local is best-effort; the server pass still runs */
        }
        try {
          const params = new URLSearchParams({ q: trimmed, lang, country });
          if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
            params.set('lat', String(Math.round(bias.lat * 1000) / 1000));
            params.set('lng', String(Math.round(bias.lng * 1000) / 1000));
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
          const items = extractSuggestions(payload);
          const merged = mergeLocalFirst(local, items);
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
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, lang, country, enabled, pickedLabel, bias?.lat, bias?.lng]);

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
  };
}
