import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Check, Flame } from 'lucide-react';
import { SPICY_SECTION_DEFAULT, spicyFlames, spicyLabel } from '@/src/utils/menuHelpers';
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
  chipBase: string;
  /** Required mode (badged-spicy items): the track stays expanded and the
      choice can never be cleared — every tap only changes the level. */
  required?: boolean;
}

/** Canonical slider order: mild → medium → extra-hot, anything else trails.
 *  Guarantees the default (first stop) is mild no matter the item's row
 *  order. */
const LEVEL_RANK = ['spicy-mild', 'spicy-medium', 'spicy-hot'];

/**
 * "Make it Spicy" — a collapsed question + one Spicy chip that expands a
 * compact 3-stop heat track. Collapsed it costs a single chip row; expanded
 * it adds only the rail and its labels — no card, no hint paragraphs.
 *
 *  - Tap the Spicy chip → expands with Mild pre-selected (the default).
 *  - Tap the chip again → clears and collapses. Dots NEVER toggle: every
 *    dot/track gesture is select-only; the chip is the only toggle. (An
 *    earlier revision let the active dot toggle the whole control off from
 *    under the finger — unreadable on phones, removed.)
 *  - Drag anywhere on the rail or tap a dot to change the level.
 *  - Arrow keys move across stops with roving focus (radio pattern).
 *
 * Mobile input notes (iOS Safari + Android Chrome):
 *  - One gesture owner: dot pointerdowns BUBBLE to the track (no
 *    stopPropagation, no explicit setPointerCapture — touch already
 *    implicitly captures to the touched dot and the events bubble up).
 *    Splitting the flow was the v1 bug: fingers always land on the 44px
 *    dots, so the rail-only drag path never ran and taps depended on a
 *    suppressible click that toggled the control away.
 *  - `touch-action: pan-y` (never `none`): vertical pans keep scrolling
 *    the sheet (browser fires pointercancel → we abort, no pick); only
 *    horizontal movement drives picks. `none` trapped sheet scrolls and
 *    read as "stuck".
  *  - Pick on pointerdown + on horizontal move. Exactly one tap path (the
  *    down-pick, select-only): no pointerup fallback — a same-task double
  *    pick would chain off a stale closure and toggle the level back off.
  *    A down lost to scroll-cancel surfaces as pointercancel, which only
  *    resets state. Dots keep an onClick guarded by `e.detail === 0` —
  *    the keyboard-only path (mouse / touch clicks carry detail >= 1 and
  *    were already handled).
 *
 * Layout notes (narrow phones, both languages):
 *  - Geometry is always LTR (mild left → extra-hot right); only TEXT
 *    follows the locale. The two end labels/dots must NEVER overflow the
 *    track box: on old iOS WebKit `overflow-x: clip` is unsupported, the
 *    sheet scroller degrades to scrollable, and the RTL page parks at the
 *    right end — hiding everything but Extra Hot. Margins (mx-8 = 32px)
 *    swallow the worst overhang (44px dot halves = 22px, w-16 label
 *    halves = 32px) so the scroller gets zero x-overflow on any browser.
 *
 * Perf: interaction flips classes + one fill width (transform/width-only,
 * motion-safe). No blur, no layout reads.
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
  chipBase,
  required = false,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const stopRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [dragging, setDragging] = useState(false);
  // Active pointer only — used to ignore stray moves/ups from other touches.
  const downId = useRef<number | null>(null);

  const ordered = useMemo(() => {
    const rank = (id: string) => {
      const i = LEVEL_RANK.indexOf(id);
      return i === -1 ? LEVEL_RANK.length : i;
    };
    return [...levels].sort((a, b) => rank(a.featureId) - rank(b.featureId));
  }, [levels]);

  const n = ordered.length;
  const activeIdx = selectedId ? ordered.findIndex((l) => l.featureId === selectedId) : -1;
  // Required mode never collapses: the choice is mandatory, so the track
  // stays visible until a level is picked (and stays after).
  const expanded = selectedId !== null || required;
  // Geometry is always LTR (mild left → extra-hot right) so dots, fill and
  // labels line up in both languages; only the TEXT follows the locale.
  const pct = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 100);

  const promptText = (() => {
    const p = prompt && typeof prompt === 'object' ? prompt : null;
    const raw = p ? (isAr ? p.ar : p.en).trim() || (isAr ? p.en : p.ar).trim() : '';
    if (raw) return raw;
    return isAr ? SPICY_SECTION_DEFAULT.prompt.ar : SPICY_SECTION_DEFAULT.prompt.en;
  })();

  const selectOnly = useCallback(
    (id: string) => {
      if (id !== selectedId) onPick(id);
    },
    [onPick, selectedId],
  );

  const pickFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || n === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const lvl = ordered[Math.round(ratio * (n - 1))];
      if (lvl) selectOnly(lvl.featureId);
    },
    [ordered, n, selectOnly],
  );

  // Single tap path: pointerdown picks (select-only). There is deliberately
  // NO pointerup fallback pick — down already handled the tap, and a second
  // pick in the same task would chain off a stale closure and toggle the
  // just-picked level back off. A down lost to scroll-cancel arrives as
  // pointercancel (no gesture to complete), never as pointerup.
  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    downId.current = e.pointerId;
    setDragging(true);
    pickFromClientX(e.clientX);
  };
  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (downId.current === null || downId.current !== e.pointerId) return;
    pickFromClientX(e.clientX);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (downId.current === null || downId.current !== e.pointerId) return;
    downId.current = null;
    setDragging(false);
  };
  const cancelDrag = () => {
    downId.current = null;
    setDragging(false);
  };

  const onGroupKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!fwd && !back) return;
    e.preventDefault();
    const dir = fwd ? 1 : -1;
    const base = activeIdx >= 0 ? activeIdx : dir > 0 ? -1 : n;
    const next = Math.min(n - 1, Math.max(0, base + dir));
    const lvl = ordered[next];
    if (lvl && lvl.featureId !== selectedId) {
      onPick(lvl.featureId);
      // Roving focus follows the new value — the standard radio pattern.
      requestAnimationFrame(() => stopRefs.current[next]?.focus());
    }
  };

  if (n === 0) return null;

  const labelOf = (l: SpicySliderLevel) => (isAr ? l.nameAr.trim() || l.nameEn : l.nameEn.trim() || l.nameAr);
  const firstId = ordered[0].featureId;

  return (
    <div>
      <p className={`text-xs font-extrabold mb-2 ${darkMode ? 'text-neutral-300' : 'text-neutral-700'}`}>
        <span dir="auto">{promptText}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            // Required mode has no clear path: tapping the chip only picks
            // (never clears). The chip is the only toggle — dots stay
            // select-only (see header notes).
            if (selectedId) {
              if (!required) onPick(selectedId);
            } else {
              onPick(firstId);
            }
          }}
          aria-pressed={selectedId !== null}
          className={`${chipBase} ${
            selectedId !== null
              ? 'bg-[var(--primary)] text-[#0A0A0A] border-[var(--primary)]'
              : darkMode
                ? 'border-neutral-700 text-neutral-200 hover:border-[var(--primary)]'
                : 'border-neutral-300 text-neutral-800 hover:border-[#0A0A0A]'
          }`}
        >
          {selectedId !== null && <Check size={13} strokeWidth={3} />}
          <Flame size={13} className={selectedId !== null ? '' : 'text-red-500'} aria-hidden="true" />
          <span dir="auto">{spicyLabel(lang)}</span>
        </button>
      </div>

      {expanded && (
        <div className="anim-fade-in mt-1 px-1" dir="ltr">
          <div
            ref={trackRef}
            role="radiogroup"
            aria-label={isAr ? 'درجة الحار' : 'Spice level'}
            aria-orientation="horizontal"
            tabIndex={-1}
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={cancelDrag}
            onKeyDown={onGroupKeyDown}
            className={`relative h-11 mx-8 select-none ${dragging ? 'cursor-grabbing' : 'cursor-pointer'} touch-pan-y`}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            {/* Rail */}
            <div
              className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full ${
                darkMode ? 'bg-neutral-700/70' : 'bg-neutral-300/80'
              }`}
              aria-hidden="true"
            />
            {/* Heat fill (width-only transition = compositor-cheap) */}
            <div
              className="absolute start-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gradient-to-r from-orange-400 via-red-500 to-red-600 motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-out"
              style={{ width: activeIdx >= 0 ? `${pct(activeIdx)}%` : '0%' }}
              aria-hidden="true"
            />
            {/* Stops (the active stop doubles as the knob) */}
            {ordered.map((l, i) => {
              const isActive = i === activeIdx;
              const reached = activeIdx >= 0 && i <= activeIdx;
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
                // Select-only: taps (pointerdown already picked; keyboard
                // clicks carry e.detail === 0) and keyboard Enter/Space all
                // converge here without ever toggling — the Spicy chip is
                // the only toggle. No pointerdown stopPropagation: the
                // gesture must bubble to the track (see header notes).
                onClick={(e) => {
                  if (e.detail === 0) selectOnly(l.featureId);
                }}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center touch-pan-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                style={{ left: `${pct(i)}%` }}
                >
                  <span
                    aria-hidden="true"
                    className={`flex items-center justify-center rounded-full border-2 motion-safe:transition-all motion-safe:duration-150 ${
                      isActive
                        ? 'w-6 h-6 border-red-500 bg-red-500 shadow-md shadow-red-500/50'
                        : reached
                          ? 'w-4 h-4 border-red-500/70 bg-red-500/80'
                          : darkMode
                            ? 'w-4 h-4 border-neutral-500 bg-[#141414] hover:border-red-400'
                            : 'w-4 h-4 border-neutral-400 bg-white hover:border-red-500'
                    }`}
                  >
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Level names + flames (same geometry box as the track; the mx-8
              gutters swallow the w-16 label halves exactly, so no pixel of
              this subtree can overflow horizontally — see header notes) */}
          <div className="relative mx-8 h-12" aria-hidden="true">
            {ordered.map((l, i) => {
              const isActive = i === activeIdx;
              const flames = spicyFlames(l.featureId);
              return (
                <div
                  key={l.featureId}
                  className="absolute top-0 -translate-x-1/2 w-16 flex flex-col items-center gap-px"
                  style={{ left: `${pct(i)}%` }}
                >
                  <span className={`flex items-center ${isActive ? 'text-red-500' : darkMode ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    {Array.from({ length: flames }).map((_, f) => (
                      <Flame key={f} size={isActive ? 12 : 10} className={isActive ? 'fill-red-500/30' : undefined} />
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
        </div>
      )}
    </div>
  );
};
