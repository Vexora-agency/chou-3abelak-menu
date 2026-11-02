import React, { useEffect, useState } from 'react';
import { useBodyScrollLock } from '@/src/hooks/useBodyScrollLock';
import { useGuardedText } from '@/src/hooks/useGuardedText';
import { MenuData, MenuItem, CartLine } from '@/src/types/menu';
import { X, Plus, Minus, Flame, Sparkles, Award } from 'lucide-react';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import {
  cartLineKey, hasOptions, hasVariants, getVariant,
  lineTotal, perUnitPrice, featureName, normalizePricing, priceLabel, formatPrice,
  validatePicks,
} from '@/src/utils/pricing';
import { addonBlocks, clampSplitPicks, effectiveAddonQty } from '@/src/utils/splitPicks';
import { VariantPicker } from './item-view/VariantPicker';
import { AddonPicker } from './item-view/AddonPicker';

interface ItemDetailsModalProps {
  item: MenuItem | null;
  menu: MenuData;
  onClose: () => void;
  cart: Record<string, CartLine>;
  onAddItem: (item: MenuItem) => void;
  onAddConfigured: (item: MenuItem, variantId: string | undefined, addonIds: string[], qty: number, addonQty?: Record<string, number>) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

export const ItemDetailsModal: React.FC<ItemDetailsModalProps> = ({
  item,
  menu,
  onClose,
  cart,
  onAddItem,
  onAddConfigured,
  onUpdateLine,
  currency,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';

  // Configurator state (reset whenever a different item opens).
  // Render-phase adjustment (blessed pattern): applies before paint, so the
  // sheet never flashes the previous item's selection.
  // Picks model: `addonIds` holds every selected option; `addonCounts`
  // holds explicit split counts ONLY for partial single-group picks
  // (0 < count < qty) — full selections ride the ids alone (legacy shape).
  const [variantId, setVariantId] = useState<string | undefined>(undefined);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [addonCounts, setAddonCounts] = useState<Record<string, number>>({});
  const [qty, setQty] = useState(1);
  const [lastItemId, setLastItemId] = useState<string | null>(null);
  const openItemId = item?.id ?? null;
  if (openItemId !== lastItemId) {
    setLastItemId(openItemId);
    if (item) {
      setVariantId(getVariant(item)?.featureId);
      // Default-on add-ons open pre-selected — the customer can remove them.
      // 'multi' groups take every default; 'single' groups take the FIRST
      // default in item order (deterministic when several are flagged).
      const blocks = addonBlocks(menu, item);
      const ids: string[] = [];
      for (const b of blocks) {
        const defs = b.addons.filter((a) => a && a.default);
        if (b.selection === 'single') {
          if (defs.length) ids.push(defs[0].featureId);
        } else {
          for (const d of defs) ids.push(d.featureId);
        }
      }
      setAddonIds(ids);
      setAddonCounts({});
      setQty(normalizePricing(item).minQty);
    }
  }

  // Shared counter lock (iOS-safe) — replaces the bare overflow flag that
  // iOS Safari ignores, which let the page scroll behind the sheet.
  useBodyScrollLock(!!item);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (item) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [item, onClose]);

  // Rules of Hooks: EVERYTHING in this block runs on EVERY render, including
  // when closed (item === null). The two useGuardedText calls must never sit
  // after an early return: adding hooks on a later render crashes React with
  // "Rendered more hooks than during the previous render", which unmounts the
  // whole app (black screen). Closed state uses empty fallbacks.
  const pricing = item ? normalizePricing(item) : null;
  const options = item ? hasOptions(item) : false;
  const variants = item && hasVariants(item) ? item.variants || [] : [];
  const blocks = item ? addonBlocks(menu, item) : [];
  const hasAddons = blocks.length > 0;
  const singleKey = item ? cartLineKey(item.id) : '';
  const singleQty = (item && cart[singleKey]?.quantity) || 0;

  // Canonical split map (undefined while the picks are legacy-shaped, so
  // keys/validation/money stay byte-identical to today until a real split).
  const effAddonQty = item ? effectiveAddonQty(addonIds, addonCounts, qty) : undefined;
  // Live total for the configured selection + group-rule validity. lineTotal
  // is pure math (it does NOT enforce single/multi caps), so the Add button
  // additionally gates on validatePicks.
  let liveTotal: number | null = null;
  let picksValid = true;
  if (item) {
    try {
      validatePicks(menu, item, addonIds, effAddonQty, qty);
    } catch {
      picksValid = false;
    }
    try {
      liveTotal = lineTotal(item, { variantId, addonIds, addonQty: effAddonQty, qty });
    } catch {
      liveTotal = null;
    }
  }

  // Live header: title gains the selected variant name, price pill shows the
  // live per-unit price (variant + add-ons, qty 1) so every tap updates both.
  const selectedVariantName = variants.length > 0 && variantId
    ? featureName(menu, variantId, lang)
    : null;
  const headerTitle = !item
    ? ''
    : selectedVariantName
      ? `${pickLangText(item.name, lang)} — ${selectedVariantName}`
      : pickLangText(item.name, lang);
  let headerPrice: string | null = null;
  if (item && options) {
    try {
      headerPrice = formatPrice(perUnitPrice(item, { variantId, addonIds, addonQty: effAddonQty, qty }), currency);
    } catch {
      headerPrice = null;
    }
  }
  // Both money displays are tamper-guarded: external DOM edits snap back.
  // (Hooks must stay above the early return — see the Rules-of-Hooks note
  // at the top of this block; the unguarded variant crashes the whole app.)
  const headerPriceText = item ? (headerPrice ?? priceLabel(item, lang, currency)) : '';
  const headerPriceRef = useGuardedText<HTMLDivElement>(headerPriceText);
  const addTotalText = liveTotal !== null ? `· ${formatPrice(liveTotal, currency)}` : '';
  const addTotalRef = useGuardedText(addTotalText);

  if (!item) return null;

  // 'multi' groups: independent checkbox toggles (unchanged behavior).
  const toggleMulti = (id: string) => {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  // 'single' groups at qty 1: radio — at most one selected, tapping the
  // selected one deselects (add-ons stay optional). Counts are trivial at
  // qty 1, so any stale entries for the group are dropped.
  const selectRadio = (groupId: string, id: string) => {
    const block = blocks.find((b) => (b.groupId ?? '') === groupId);
    const members = block ? block.addons.map((a) => a.featureId) : [id];
    setAddonIds((prev) =>
      prev.includes(id)
        ? prev.filter((a) => a !== id)
        : [...prev.filter((a) => !members.includes(a)), id],
    );
    setAddonCounts((prev) => {
      if (!Object.keys(prev).length) return prev;
      const next = { ...prev };
      for (const m of members) delete next[m];
      return next;
    });
  };

  // 'single' groups at qty > 1: smart-split stepper (0..qty per option; the
  // picker disables + once the group sum reaches qty). Full counts ride the
  // ids alone, so reaching full collapses back to the legacy shape.
  const setSplitCount = (id: string, count: number) => {
    const next = Math.max(0, Math.min(qty, Math.round(count)));
    setAddonIds((prev) =>
      next === 0 ? prev.filter((a) => a !== id) : prev.includes(id) ? prev : [...prev, id],
    );
    setAddonCounts((prev) => {
      const n = { ...prev };
      if (next === 0 || next === qty) delete n[id];
      else n[id] = next;
      return n;
    });
  };

  const stepQty = (dir: 1 | -1) => {
    // pricing is non-null whenever this can fire (the sheet only renders
    // its controls when open); the assertion documents that invariant.
    const newQ = Math.max(pricing!.minQty, Math.min(pricing!.maxQty, qty + dir * pricing!.step));
    if (newQ === qty || !item) return;
    if (newQ === 1) {
      // Collapse every 'single' group to radio, keeping its largest pick
      // (ties → first in item order); counts are trivial at qty 1.
      let nextIds = [...addonIds];
      for (const b of blocks) {
        if (b.selection !== 'single') continue;
        const members = b.addons.map((a) => a.featureId).filter((fid) => nextIds.includes(fid));
        if (members.length > 1) {
          let keep = members[0];
          let best = -1;
          for (const m of members) {
            const c = addonCounts[m] ?? qty;
            if (c > best) {
              best = c;
              keep = m;
            }
          }
          nextIds = nextIds.filter((fid) => fid === keep || !members.includes(fid));
        }
      }
      setAddonIds(nextIds);
      setAddonCounts({});
      setQty(newQ);
      return;
    }
    // Clamp split counts to the new qty (decrement-largest per group);
    // multi picks ride full automatically. Never invalid, never crashes.
    const clamped = clampSplitPicks(menu, item, addonIds, addonCounts, newQ);
    const explicit: Record<string, number> = {};
    if (clamped.addonQty) {
      for (const [k, v] of Object.entries(clamped.addonQty)) {
        if (v > 0 && v < newQ) explicit[k] = v;
      }
    }
    setAddonIds(clamped.ids);
    setAddonCounts(explicit);
    setQty(newQ);
  };

  const chipBase = 'px-3.5 h-10 rounded-full text-xs font-bold border transition-colors btn-tactile inline-flex items-center gap-1.5';

  return (
    // Container height is 100dvh (not inset-0's bottom edge): on iOS Chrome
    // the layout viewport extends behind the bottom toolbar, so a bottom edge
    // would pin the sheet too low and leave a dark strip / cut the Close
    // button. dvh tracks the VISIBLE height — identical to inset-0 wherever
    // they agree, correct where they don't.
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 anim-fade-in"
        aria-hidden="true"
      />

      {/* Drawer on mobile, Centered Modal on Desktop.
          Entrance animation on the wrapper, scrolling on the inner div —
          never both on one element (phone scroll glitches). */}
      {/* Bottom-flush, content-sized sheet: NO bottom margin (the old
          mb-[env(safe-area-inset-bottom)] lifted the sheet and exposed a
          permanent backdrop strip underneath) and NO forced full height (a
          full-height sheet with short content left a big empty area under
          the Close button). The sheet hugs its content down to the
          viewport edge; 92dvh caps long content so it scrolls inside.
          Home-indicator clearance lives INSIDE the scroller below. */}
      <div
        className={`anim-slide-up relative z-10 w-full max-w-[520px] max-h-[92vh] max-h-[92dvh] flex flex-col rounded-t-[28px] md:rounded-[28px] border-t-[5px] border-t-[var(--primary)] md:border-2 md:border-[var(--primary)] shadow-2xl overflow-hidden transition-colors duration-200 ${
          darkMode ? 'bg-[#141414] text-white' : 'bg-white text-[#0A0A0A]'
        }`}
      >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={headerTitle}
        className="overflow-y-auto overscroll-contain smooth-scroll-touch no-scrollbar flex-1 min-h-0 px-6 sm:px-8 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-x-clip"
      >
        {/* Drag Pill Handle (Mobile only) */}
        <div className={`w-11 h-1.5 rounded-full mx-auto mt-4 mb-4 md:hidden ${darkMode ? 'bg-neutral-600' : 'bg-neutral-300'}`} />

        {/* Sticky header: title + live price + close stay visible while the
            options scroll — the standard food-app sheet pattern. Full-bleed
            (-mx/px mirror the scroller padding) so content slides under a
            solid bar, not under text. */}
        <div className={`sticky top-0 z-10 -mx-6 sm:-mx-8 px-6 sm:px-8 pt-4 sm:pt-6 pb-3 flex justify-between items-start gap-3 border-b ${
          darkMode ? 'bg-[#141414] border-neutral-800' : 'bg-white border-neutral-200'
        }`}>
          <div className="min-w-0 flex-1">
            <h3 dir="auto" className={`text-lg min-[380px]:text-xl sm:text-2xl font-black leading-tight ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {headerTitle}
            </h3>
            {/* Badges */}
            <div className="flex items-center gap-1.5 mt-2">
              {item.badges.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#0A0A0A] text-[var(--primary)] border border-[var(--primary)]"
                >
                    {b === 'spicy' && <Flame size={12} className="fill-[var(--primary)]" />}
                    {b === 'top' && <Award size={12} className="fill-[var(--primary)]" />}
                    {b === 'new' && <Sparkles size={12} />}
                    {badgeLabel(b, lang)}
                </span>
              ))}
              {!item.available && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-neutral-600 text-white">
                  {isAr ? 'نفذت الكمية' : 'Sold out'}
                </span>
              )}
            </div>
          </div>

      <div ref={headerPriceRef} className="flex-shrink-0 px-3 py-1 min-[380px]:px-3.5 min-[380px]:py-1.5 rounded-full text-base min-[380px]:text-lg font-black bg-[var(--primary)] text-[#0A0A0A] shadow-sm whitespace-nowrap tabular-nums" dir="ltr">
        {headerPriceText}
      </div>

          {/* In-flow close: always in the sticky bar (never scrolled away,
              never overlapped — no absolute corner to reserve for). */}
          <button
            type="button"
            onClick={onClose}
            className={`shrink-0 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
              darkMode
                ? 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'
                : 'bg-neutral-100 text-neutral-700 hover:text-black hover:bg-neutral-200'
            }`}
            aria-label={isAr ? 'إغلاق' : 'Close modal'}
          >
            <X size={20} />
          </button>
        </div>

        {/* Description (hidden when the admin leaves it empty) */}
        {pickLangText(item.description, lang).trim() ? (
          <p
            className={`mt-4 text-sm leading-relaxed ${
              darkMode ? 'text-neutral-300' : 'text-neutral-700 font-medium'
            }`}
          >
            {pickLangText(item.description, lang)}
          </p>
        ) : null}

        {/* Ordering Actions (no top border: the sticky header above already
            ends with border-b — a second rule here rendered as a double
            line). */}
        <div className="mt-6 space-y-4">
          {item.available ? (
            options ? (
              <>
                {/* Variants (required — first is the default) */}
                <VariantPicker variants={variants} variantId={variantId} onSelect={setVariantId} menu={menu} lang={lang} currency={currency} darkMode={darkMode} isAr={isAr} chipBase={chipBase} />

                {/* Add-ons */}
                {hasAddons && (
                  <AddonPicker
                    menu={menu}
                    item={item}
                    qty={qty}
                    addonIds={addonIds}
                    addonCounts={addonCounts}
                    onToggleMulti={toggleMulti}
                    onSelectRadio={selectRadio}
                    onSetCount={setSplitCount}
                    lang={lang}
                    currency={currency}
                    darkMode={darkMode}
                    isAr={isAr}
                    chipBase={chipBase}
                  />
                )}

                {/* Quantity stepper */}
                <div className="flex items-center justify-between gap-4">
                  <span className={`font-bold text-sm ${darkMode ? 'text-neutral-200' : 'text-neutral-800'}`}>
                    {isAr ? 'الكمية:' : 'Quantity:'}
                  </span>
                  <div className="flex items-center gap-1.5 bg-[var(--primary)] text-[#0A0A0A] rounded-full p-1 shadow-sm">
                    <button
                      type="button"
                      onClick={() => stepQty(-1)}
                      className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold text-[#0A0A0A]"
                      aria-label={isAr ? 'إنقاص' : 'Decrease'}
                    >
                      <Minus size={18} className="stroke-[3]" />
                    </button>
                    <span className="font-black text-base px-2 min-w-[28px] text-center text-[#0A0A0A] tabular-nums" dir="ltr">
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => stepQty(1)}
                      className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold text-[#0A0A0A]"
                      aria-label={isAr ? 'زيادة' : 'Increase'}
                    >
                      <Plus size={18} className="stroke-[3]" />
                    </button>
                  </div>
                </div>

                {/* Add button with live total */}
                <button
                  type="button"
                  disabled={liveTotal === null || !picksValid}
                  onClick={() => onAddConfigured(item, variantId, addonIds, qty, effAddonQty)}
                  className="btn-tactile w-full h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-extrabold text-base flex items-center justify-center gap-2 shadow-lg hover:brightness-110 disabled:opacity-50"
                >
                  <Plus size={20} className="stroke-[3]" />
                  <span>{isAr ? 'إضافة إلى الطلب' : 'Add to Order'}</span>
                  {liveTotal !== null && (
                    <span ref={addTotalRef} className="tabular-nums" dir="ltr">{addTotalText}</span>
                  )}
                </button>
              </>
            ) : singleQty === 0 ? (
              <button
                type="button"
                onClick={() => onAddItem(item)}
                className="btn-tactile w-full h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-extrabold text-base flex items-center justify-center gap-2 shadow-lg hover:brightness-110"
              >
                <Plus size={20} className="stroke-[3]" />
                <span>{isAr ? 'إضافة إلى الطلب' : 'Add to Order'}</span>
              </button>
            ) : (
              <div className={`flex items-center justify-between gap-4 p-2 rounded-full ${
                darkMode ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-[#0A0A0A]'
              }`}>
                <span className="font-bold text-sm px-4">
                  {isAr ? 'الكمية في السلة:' : 'In your cart:'}
                </span>
                <div className="flex items-center gap-1.5 bg-[var(--primary)] text-[#0A0A0A] rounded-full p-1 shadow-sm shrink-0">
                  <button
                    type="button"
                    onClick={() => onUpdateLine(singleKey, -1)}
                    className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold text-[#0A0A0A]"
                  >
                    <Minus size={18} className="stroke-[3]" />
                  </button>
                  <span className="font-black text-base px-2 min-w-[28px] text-center text-[#0A0A0A] tabular-nums" dir="ltr">
                    {singleQty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateLine(singleKey, 1)}
                    className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold text-[#0A0A0A]"
                  >
                    <Plus size={18} className="stroke-[3]" />
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className={`text-center py-2 text-sm font-semibold ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {isAr ? 'هذا العنصر غير متوفر حالياً' : 'This item is currently unavailable'}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className={`btn-tactile w-full h-11 min-h-[44px] rounded-full border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
              darkMode
                ? 'border-neutral-700 text-neutral-300 hover:bg-white/5'
                : 'border-neutral-300 text-neutral-700 hover:bg-black/5'
            }`}
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};
