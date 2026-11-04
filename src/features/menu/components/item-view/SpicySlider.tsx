import React, { useCallback, useRef, useState } from 'react';
import { Flame, X } from 'lucide-react';
import { SPICY_SECTION_DEFAULT, spicyFlames } from '@/src/utils/menuHelpers';
import { formatPrice } from '@/src/utils/pricing';

export interface SpicySliderLevel {
  featureId: string;
  price: number;
  nameEn: string;
  nameAr: string;
}

interface SpicySliderProps {
  levels: SpicySliderLevel[];
  selectedId: string | null;
  onPick: (id: string) => void;
  prompt?: { en: string; ar: string };
  lang: 'en' | 'ar';
  isAr: boolean;
  darkMode: boolean;
  currency: string;
}

/**
 * "Make it Spicy" level slider — the locked spicy section rendered as its
 * own heat card, never as generic chips. Three stops (mild / medium /
 * extra-hot): tap a dot, drag anywhere along the track, or use the arrow
 * keys. Tapping the active level (or the "no heat" pill) clears it —
 * spice stays optional.
 *
 * Perf: the card paints once; interaction only flips classes + two
 * percentage widths (fill + knob). No blur, no layout-thrashing reads,
 * transitions are transform/opacity/width-only and gated behind
 * `motion-safe` so reduced-motion users get instant changes.
 */
export const SpicySlider: React.FC<SpicySliderProps> = ({
  levels,
  selectedId,
  onPick,
  prompt,
  lang,
  isAr,
  darkMode,
  currency,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const stopRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [dragging, setDragging] = useState(false);
  const dragId = useRef<number | null>(null);

  const n = levels.length;
  const activeIdx = selectedId ? levels.findIndex((l) => l.featureId === selectedId) : -1;
  const active = activeIdx >= 0;
  // Geometry is always LTR (mild left → extra-hot right) so dots, fill and
  // labels line up in both languages; only the TEXT follows the locale.
  const pct = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 100);

  const promptText = (() => {
    const p = prompt && typeof prompt === 'object' ? prompt : null;
    const raw = p ? (isAr ? p.ar : p.en).trim() || (isAr ? p.en : p.ar).trim() : '';
    if (raw) return raw;
    return isAr ? SPICY_SECTION_DEFAULT.prompt.ar : SPICY_SECTION_DEFAULT.prompt.en;
  })();

  // Drag/tap-on-empty-track SELECTS only — never toggles off. Clearing is
  // explicit: tap the active dot or the "no heat" pill. Without this guard
  // a small drag wiggle over the active stop would wipe the pick.
  const pickFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || n === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const idx = Math.round(ratio * (n - 1));
      const lvl = levels[idx];
      if (lvl && lvl.featureId !== selectedId) onPick(lvl.featureId);
    },
    [levels, n, onPick, selectedId],
  );

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragId.current = e.pointerId;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* older engines: dragging still works via move/up */
    }
    pickFromClientX(e.clientX);
  };
  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragId.current !== e.pointerId) return;
    pickFromClientX(e.clientX);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragId.current !== e.pointerId) return;
    dragId.current = null;
    setDragging(false);
  };

  const onGroupKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!fwd && !back) return;
    e.preventDefault();
    const base = active ? activeIdx : fwd ? -1 : n;
    const next = Math.min(n - 1, Math.max(0, base + (fwd ? 1 : -1)));
    const lvl = levels[next];
    if (lvl && lvl.featureId !== selectedId) {
      onPick(lvl.featureId);
      // Roving focus follows the new value — the standard radio pattern.
      requestAnimationFrame(() => stopRefs.current[next]?.focus());
    }
  };

  if (n === 0) return null;

  const labelOf = (l: SpicySliderLevel) => (isAr ? l.nameAr.trim() || l.nameEn : l.nameEn.trim() || l.nameAr);

  return (
    <div
      className={`rounded-2xl border p-4 ${
        darkMode
          ? 'border-red-500/25 bg-red-500/[0.07]'
          : 'border-red-500/30 bg-red-500/[0.05]'
      }`}
    >
      {/* Header: flame mark + customer title (admin-editable prompt) */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white shadow-md shadow-red-500/30 bg-gradient-to-br from-red-500 to-orange-500"
            aria-hidden="true"
          >
            <Flame size={17} className="fill-white/20" />
          </span>
          <p dir="auto" className={`text-xs font-extrabold leading-relaxed ${darkMode ? 'text-neutral-100' : 'text-neutral-900'}`}>
            {promptText}
          </p>
        </div>
        {active && (
          <button
            type="button"
            onClick={() => selectedId && onPick(selectedId)}
            className={`shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-[11px] font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
              darkMode
                ? 'border-neutral-700 text-neutral-300 hover:border-red-400 hover:text-red-300'
                : 'border-neutral-300 text-neutral-600 hover:border-red-500 hover:text-red-600'
            }`}
            aria-label={isAr ? 'بدون حار' : 'No heat'}
          >
            <X size={13} strokeWidth={3} />
            {isAr ? 'بدون حار' : 'No heat'}
          </button>
        )}
      </div>

      {/* Track: drag surface + stops. role=radiogroup over real buttons. */}
      <div className="mt-4 px-2" dir="ltr">
        <div
          ref={trackRef}
          role="radiogroup"
          aria-label={isAr ? 'درجة الحار' : 'Spice level'}
          aria-orientation="horizontal"
          tabIndex={-1}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onGroupKeyDown}
          className={`relative h-12 mx-5 select-none ${dragging ? 'cursor-grabbing' : 'cursor-pointer'} touch-none`}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {/* Rail */}
          <div
            className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full ${
              darkMode ? 'bg-neutral-700/70' : 'bg-neutral-300/80'
            }`}
            aria-hidden="true"
          />
          {/* Heat fill (width-only transition = compositor-cheap) */}
          <div
            className="absolute start-0 top-1/2 -translate-y-1/2 h-2 rounded-full bg-gradient-to-r from-orange-400 via-red-500 to-red-600 motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-out"
            style={{ width: active ? `${pct(activeIdx)}%` : '0%' }}
            aria-hidden="true"
          />
          {/* Stops (the active stop scales up and doubles as the knob) */}
          {levels.map((l, i) => {
            const isActive = i === activeIdx;
            const reached = active && i <= activeIdx;
            return (
              <button
                key={l.featureId}
                type="button"
                role="radio"
                aria-checked={isActive}
                ref={(el) => {
                  stopRefs.current[i] = el;
                }}
                aria-label={`${labelOf(l)}${l.price !== 0 ? ` (+${formatPrice(l.price)} ${currency})` : ''}`}
                onClick={() => onPick(l.featureId)}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                style={{ left: `${pct(i)}%`, touchAction: 'none' }}
              >
                <span
                  aria-hidden="true"
                  className={`flex items-center justify-center rounded-full border-2 motion-safe:transition-all motion-safe:duration-150 ${
                    isActive
                      ? 'w-7 h-7 border-red-500 bg-red-500 shadow-lg shadow-red-500/50 scale-110'
                      : reached
                        ? 'w-5 h-5 border-red-500/70 bg-red-500/80'
                        : darkMode
                          ? 'w-5 h-5 border-neutral-500 bg-[#141414] hover:border-red-400'
                          : 'w-5 h-5 border-neutral-400 bg-white hover:border-red-500'
                  }`}
                >
                  {isActive && <span className="w-2 h-2 rounded-full bg-white" />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Level names + flames (same geometry box as the track, so each
            label sits exactly under its dot) */}
        <div className="relative mt-1 mx-5 h-14" aria-hidden="true">
          {levels.map((l, i) => {
            const isActive = i === activeIdx;
            const flames = spicyFlames(l.featureId);
            return (
              <div
                key={l.featureId}
                className="absolute top-0 -translate-x-1/2 w-20 flex flex-col items-center gap-0.5"
                style={{ left: `${pct(i)}%` }}
              >
                <span className={`flex items-center gap-px ${isActive ? 'text-red-500' : darkMode ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  {Array.from({ length: flames }).map((_, f) => (
                    <Flame key={f} size={isActive ? 13 : 11} className={isActive ? 'fill-red-500/30' : undefined} />
                  ))}
                </span>
                <span
                  dir="auto"
                  className={`text-[11px] leading-tight text-center break-words motion-safe:transition-colors ${
                    isActive
                      ? 'font-black text-red-500'
                      : `font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`
                  }`}
                >
                  {labelOf(l)}
                  {l.price !== 0 && (
                    <span className="tabular-nums opacity-80"> <bdi dir="ltr">+{formatPrice(l.price)}</bdi></span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <p className={`mt-1.5 text-center text-[11px] font-semibold ${darkMode ? 'text-neutral-500' : 'text-neutral-400'}`}>
          {lang === 'ar' ? 'اسحب المؤشر أو اضغط على الدرجة' : 'Drag the slider or tap a level'}
        </p>
      </div>
    </div>
  );
};
