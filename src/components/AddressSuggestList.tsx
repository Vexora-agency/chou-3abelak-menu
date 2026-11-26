import { Loader2, MapPin } from 'lucide-react';
import type { ReactElement } from 'react';
import type { AddressSuggestion } from '../hooks/useAddressAutocomplete';

export interface AddressSuggestListProps {
  lang: 'en' | 'ar';
  darkMode: boolean;
  loading: boolean;
  items: AddressSuggestion[];
  activeIndex: number;
  listId: string;
  onPick: (item: AddressSuggestion) => void;
  /**
   * Attached mode renders the list as a static section inside the parent's
   * own bordered card (input row on top, divider, results below — one
   * continuous border instead of a floating box). Default `false` keeps the
   * legacy floating overlay (used by account settings).
   */
  attached?: boolean;
}

/**
 * Pure presentational dropdown for address suggestions. In overlay mode the
 * parent must be `relative`; the parent also owns the empty state (this
 * renders null when there is nothing to show).
 */
export function AddressSuggestList({
  lang,
  darkMode,
  loading,
  items,
  activeIndex,
  listId,
  onPick,
  attached = false,
}: AddressSuggestListProps): ReactElement | null {
  const isAr = lang === 'ar';

  if (!loading && items.length === 0) return null;

  const hasGoogleRows = items.some((item) => typeof item.placeId === 'string' && item.placeId);

  return (
    <div
      id={listId}
      role="listbox"
      className={
        attached
          ? `relative inset-x-0 top-auto z-auto max-h-[38dvh] overflow-y-auto divide-y ${
            darkMode ? 'divide-neutral-800' : 'divide-neutral-100'
          }`
          : `absolute inset-x-0 top-full z-50 mt-1 max-h-[38dvh] min-h-[52px] overflow-y-auto rounded-2xl border shadow-xl ${
            darkMode ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'
          }`
      }
    >
      {loading && (
        <div
          className={`flex items-center gap-2 px-4 py-3 text-sm ${
            darkMode ? 'text-neutral-300' : 'text-neutral-600'
          }`}
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{isAr ? 'جارٍ البحث عن العناوين…' : 'Searching addresses…'}</span>
        </div>
      )}
      {items.map((item, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={`${item.lat}:${item.lng}:${i}`}
            type="button"
            role="option"
            id={`${listId}-opt-${i}`}
            aria-selected={active}
            onMouseDown={(e) => {
              // Fires before input blur so the pick is not lost.
              e.preventDefault();
              onPick(item);
            }}
            className={`flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2 text-start ${
              active ? 'bg-[var(--primary)]/10' : ''
            }`}
          >
            <MapPin
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                darkMode ? 'text-neutral-400' : 'text-neutral-500'
              }`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span
                dir="auto"
                className={`block truncate text-sm font-bold ${
                  darkMode ? 'text-white' : 'text-[#0A0A0A]'
                }`}
              >
                {item.line1 || item.label}
              </span>
              <span
                dir="auto"
                className={`block truncate text-xs ${
                  darkMode ? 'text-neutral-400' : 'text-neutral-500'
                }`}
              >
                {item.line2}
              </span>
              {item.details && item.details !== item.line2 && (
                <span
                  dir="auto"
                  className={`block truncate text-[11px] ${
                    darkMode ? 'text-neutral-500' : 'text-neutral-400'
                  }`}
                >
                  {item.details}
                </span>
              )}
            </span>
          </button>
        );
      })}
      {hasGoogleRows && (
        <span
          className={`flex items-center justify-between gap-2 border-t px-4 py-2 text-[12px] ${
            darkMode ? 'border-neutral-700 text-neutral-500' : 'border-neutral-200 text-neutral-400'
          }`}
        >
          <span>{isAr ? 'تشمل اقتراحات من:' : 'Includes suggestions from:'}</span>
          {/* Exact untouched brand string per the Google Maps attribution policy. */}
          <span translate="no" dir="ltr">Google Maps</span>
        </span>
      )}
    </div>
  );
}
