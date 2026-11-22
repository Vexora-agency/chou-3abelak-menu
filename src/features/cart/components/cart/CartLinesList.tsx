import React, { useEffect, useRef, useState } from 'react';
import { MenuData, ResolvedCartLine } from '@/src/types/menu';
import { pickLangText, isSpicyFeatureId } from '@/src/utils/menuHelpers';
import { getVariant, featureName, unitPrice, formatPrice, normalizePricing, unitLabel } from '@/src/utils/pricing';
import { Plus, Minus, Trash2, X } from 'lucide-react';
import { HeatPill } from '@/src/components/HeatPill';

interface CartLinesListProps {
  menu: MenuData;
  lines: ResolvedCartLine[];
  lang: 'en' | 'ar';
  darkMode: boolean;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onRemoveLine: (key: string) => void;
  onRemoveAddon: (lineKey: string, featureId: string) => void;
  /** Line that just arrived from the menu: gets the one-shot gold landing. */
  highlightKey?: string | null;
}

/**
 * Quantity chip. The span is keyed by qty, so a real change remounts it and
 * replays the one-shot pop; `popReady` latches after the first observed
 * change so a boot/reopen never pops (a class appearing on an already
 * mounted span would otherwise animate every row at once).
 */
const CartLineQty: React.FC<{ qty: number; landed: boolean }> = ({ qty, landed }) => {
  const [popReady, setPopReady] = useState(false);
  const prevQtyRef = useRef(qty);
  useEffect(() => {
    const prev = prevQtyRef.current;
    prevQtyRef.current = qty;
    if (prev !== qty) setPopReady(true);
  }, [qty]);
  return (
    <span
      key={qty}
      className={`font-black text-[13px] sm:text-sm px-1 min-w-[24px] sm:min-w-[28px] text-center text-[#0A0A0A] tabular-nums${landed || popReady ? ' anim-qty-pop' : ''}`}
    >
      {qty}
    </span>
  );
};

export const CartLinesList: React.FC<CartLinesListProps> = ({
  menu,
  lines,
  lang,
  darkMode,
  onUpdateLine,
  onRemoveLine,
  onRemoveAddon,
  highlightKey,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="space-y-2.5">
      {lines.map((l) => {
        const variant = getVariant(l.item, l.variantId);
        const justLanded = highlightKey === l.key;
        // Base (size or fixed price) — shown next to the name so the full
        // math reads: small pizza 450,000 + cheese 30,000.
        const baseUnit = unitPrice(l.item, l.variantId);
        let pricingUnit = 'pc';
        try {
          const pu = normalizePricing(l.item).unit;
          if (typeof pu === 'string' && pu) pricingUnit = pu;
        } catch {}
        return (
          <div
            key={l.key}
            data-testid={`cart-line-${l.item.id}`}
            data-line-key={l.key}
            data-qty={l.quantity}
            className={`p-3 sm:p-3.5 rounded-xl border transition-colors ${
              darkMode
                ? 'bg-[#1c1c1c] border-neutral-800 text-white'
                : 'bg-neutral-100 border-neutral-200 text-[#0A0A0A]'
            }${justLanded ? ' cart-line-land' : ''}`}
          >
           <div className="flex items-start justify-between gap-2 sm:gap-3">
            <div className="flex-1 min-w-0">
              <h4 className={`font-bold text-sm ${isAr ? 'leading-relaxed' : ''} ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                <span dir="auto" title={pickLangText(l.item.name, lang)} className="block truncate">
                  {pickLangText(l.item.name, lang)}
                </span>
                {variant ? (
                  <span className={`mt-0.5 block text-xs font-semibold tabular-nums ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    (<span dir="auto">{featureName(menu, l.variantId as string, lang)}</span>{baseUnit !== 0 && (<> · <span dir="ltr">{formatPrice(baseUnit)}</span></>)})
                  </span>
                ) : l.addonIds.length > 0 ? (
                  <span className={`mt-0.5 block text-xs font-semibold tabular-nums ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    {baseUnit !== 0 && (<span dir="ltr">{formatPrice(baseUnit)}</span>)}
                  </span>
                ) : null}
              </h4>
            </div>

            {/* Quantity Stepper & Remove */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <div className="flex items-center gap-1 sm:gap-1.5 bg-[var(--primary)] text-[#0A0A0A] rounded-full p-1 sm:p-1.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => onUpdateLine(l.key, -1)}
                  className="relative w-9 h-9 min-w-[36px] min-h-[36px] sm:w-11 sm:h-11 sm:min-w-[44px] sm:min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center transition-all text-[#0A0A0A] after:absolute after:-inset-1 after:content-['']"
                  aria-label="Decrease quantity"
                >
                  <Minus size={16} className="stroke-[3] sm:h-[18px] sm:w-[18px]" />
                </button>
                <CartLineQty qty={l.quantity} landed={justLanded} />
                <button
                  type="button"
                  onClick={() => onUpdateLine(l.key, 1)}
                  className="relative w-9 h-9 min-w-[36px] min-h-[36px] sm:w-11 sm:h-11 sm:min-w-[44px] sm:min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center transition-all text-[#0A0A0A] after:absolute after:-inset-1 after:content-['']"
                  aria-label="Increase quantity"
                >
                  <Plus size={16} className="stroke-[3] sm:h-[18px] sm:w-[18px]" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => onRemoveLine(l.key)}
                className={`relative w-9 h-9 min-w-[36px] min-h-[36px] sm:w-11 sm:h-11 sm:min-w-[44px] sm:min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 after:absolute after:-inset-1 after:content-[''] ${
                  darkMode ? 'text-neutral-400 hover:text-red-400 hover:bg-red-500/10' : 'text-neutral-500 hover:text-red-600 hover:bg-red-500/10'
                }`}
                aria-label="Remove item"
              >
                <Trash2 size={16} className="sm:h-[18px] sm:w-[18px]" />
              </button>
            </div>
            </div>
           {/* Add-on chips: full-width row of their own — they used to share
               the narrow name column with the stepper beside it and visually
               collided with it on small phones. */}
            {l.addonIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  {l.addonIds.map((id) => {
                   const addonPrice = (l.item.addons || []).find((a) => a && a.featureId === id)?.price ?? 0;
                  // Spicy renders the unified HeatPill (N flames + level
                  // label) instead of its own one-off red chip — same
                  // remove-button and split-count rules, display-only.
                  const spicy = isSpicyFeatureId(id);
                  // Required heat (badged-spicy line) has no remove button:
                  // dropping the degree would strand a heatless line the
                  // server now rejects — the whole line removes instead.
                  const badgedSpicyLine = spicy && ((l.item.badges || []).includes('spicy'));
                  // Split lines: partial picks (0 < count < qty) render as
                  // `name ×n`; full-count and legacy picks render exactly as
                  // today (non-spicy add-ons keep the `+ name` receipt shape).
                  const count = l.addonQty?.[id] ?? l.quantity;
                  const partial = count > 0 && count < l.quantity;
                  if (spicy) {
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 max-w-full"
                      >
                        <HeatPill featureId={id} lang={lang} size="sm" />
                        {partial && (
                          <bdi className={`text-[11px] font-bold tabular-nums ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>×{count}</bdi>
                        )}
                        {badgedSpicyLine ? null : (
                          <button
                            type="button"
                            onClick={() => onRemoveAddon(l.key, id)}
                            className={`relative flex items-center justify-center w-6 h-6 min-w-[24px] min-h-[24px] rounded-full shrink-0 border border-red-600/30 text-red-600 dark:border-red-400/30 dark:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 after:absolute after:-inset-1 after:content-[''] ${
                              darkMode ? 'hover:bg-red-500/20 hover:text-red-400' : 'hover:bg-red-500/10 hover:text-red-600'
                            }`}
                            title={isAr ? 'إزالة الحار' : 'Remove Spicy'}
                            aria-label={`${isAr ? 'إزالة الحار' : 'Remove Spicy'}${partial ? ` ×${count}` : ''}`}
                          >
                            <X size={12} strokeWidth={3} />
                          </button>
                        )}
                      </span>
                    );
                  }
                  return (
                    <span
                      key={id}
                      className={`inline-flex items-center gap-1 ps-2 pe-0.5 py-0.5 rounded-full text-[11px] font-bold border max-w-full ${
                        darkMode
                          ? 'border-[var(--primary)]/30 bg-[var(--primary)]/5 text-[var(--primary)]'
                          : 'border-[#8a6d00]/30 bg-[#8a6d00]/5 text-[#8a6d00]'
                      }`}
                    >
                      <bdi className="min-w-0 break-words">{`+ ${featureName(menu, id, lang)}`}{partial ? ` ×${count}` : ''}</bdi>
                      {/* Zero-price add-ons show no price text (mirrors the item modal). */}
                      {addonPrice !== 0 && (
                        <span className="tabular-nums opacity-80 shrink-0" dir="ltr">
                          {formatPrice(addonPrice)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveAddon(l.key, id)}
                        className={`relative flex items-center justify-center w-6 h-6 min-w-[24px] min-h-[24px] rounded-full shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 after:absolute after:-inset-1 after:content-[''] ${
                          darkMode ? 'hover:bg-red-500/20 hover:text-red-400' : 'hover:bg-red-500/10 hover:text-red-600'
                        }`}
                        title={isAr ? 'إزالة الإضافة من السطر' : 'Remove add-on from this line'}
                        aria-label={`${isAr ? 'إزالة الإضافة' : 'Remove add-on'} ${featureName(menu, id, lang)}${partial ? ` ×${count}` : ''}`}
                      >
                        <X size={12} strokeWidth={3} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
           {/* Line math: full-width receipt line under the row — the old pill
               squeezed beside the stepper and stacked ugly on narrow phones.
               No heavy bubble: quiet text, strong total. */}
            <p dir="auto" className={`mt-2 text-xs tabular-nums break-words leading-relaxed text-start ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
              <span className={`font-extrabold ${darkMode ? 'text-white' : 'text-neutral-800'}`}>
                <bdi dir="ltr" className="tabular-nums">{l.quantity}</bdi> <span>{unitLabel(pricingUnit, l.quantity, lang)}</span>
              </span>
              <span dir="ltr"> × </span><bdi dir="ltr" className="tabular-nums">{formatPrice(l.unit)}</bdi><span dir="ltr"> = </span>
              <span className={`font-black ${darkMode ? 'text-[var(--primary)]' : 'text-[#0A0A0A]'}`}>
                <bdi dir="ltr" className="tabular-nums">{formatPrice(l.total)}</bdi>
              </span>
            </p>
          </div>
        );
      })}
    </div>
  );
};
