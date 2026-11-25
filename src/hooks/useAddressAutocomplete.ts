import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface AddressSuggestion {
  label: string;
  line1: string;
  line2: string;
  lat: number;
  lng: number;
  details?: string;
}

export interface UseAddressAutocompleteOptions {
  query: string;
  lang: 'en' | 'ar';
  country: string;
  enabled?: boolean;
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

function cacheKey(lang: string, country: string, query: string): string {
  return `${lang}|${country}|${query}`;
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
  return (
    typeof o.label === 'string' &&
    typeof o.line1 === 'string' &&
    typeof o.line2 === 'string' &&
    typeof o.lat === 'number' &&
    typeof o.lng === 'number' &&
    (o.details === undefined || typeof o.details === 'string')
  );
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

    const key = cacheKey(lang, country, trimmed);
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
        try {
          const res = await fetch(
            `/api/geo/autocomplete?q=${encodeURIComponent(trimmed)}&lang=${encodeURIComponent(lang)}&country=${encodeURIComponent(country)}`,
            {
              headers: { 'X-Requested-With': 'menu-customer' },
              signal: controller.signal,
            },
          );
          if (!res.ok) throw new Error('geo autocomplete failed');
          const payload: unknown = await res.json();
          const items = extractSuggestions(payload);
          cacheSet(key, items);
          setSuggestions(items);
          setActiveIndex(-1);
          setError(false);
          setOpen(true);
        } catch {
          // Aborted by a newer keystroke/unmount: leave state to the next run.
          if (controller.signal.aborted) return;
          // Silent fallback: manual typing keeps working, no banner.
          setSuggestions([]);
          setActiveIndex(-1);
          setError(true);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, lang, country, enabled, pickedLabel]);

  const selectSuggestion = useCallback((s: AddressSuggestion) => {
    setPickedLabel(s.label);
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
