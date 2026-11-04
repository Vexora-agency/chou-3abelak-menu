import React from 'react';
import { MenuData, ResolvedCartLine } from '@/src/types/menu';
import { pickLangText, isSpicyFeatureId, spicyLabel } from '@/src/utils/menuHelpers';
import { getVariant, featureName, unitPrice, formatPrice, normalizePricing, unitLabel } from '@/src/utils/pricing';
import { Plus, Minus, Trash2, X, Flame } from 'lucide-react';

interface CartLinesListProps {
  menu: MenuData;
  lines: ResolvedCartLine[];
  lang: 'en' | 'ar';
  darkMode: boolean;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onRemoveLine: (key: string) => void;
  onRemoveAddon: (lineKey: string, featureId: string) => void;
}

export const CartLinesList: React.FC<CartLinesListProps> = ({
  menu,
  lines,
  lang,
  darkMode,
  onUpdateLine,
  onRemoveLine,
  onRemoveAddon,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="space-y-2.5">
      {lines.map((l) => {
        const variant = getVariant(l.item, l.variantId);
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
            className={`p-3.5 rounded-xl border transition-colors ${
              darkMode
                ? 'bg-[#1c1c1c] border-neutral-800 text-white'
                : 'bg-neutral-100 border-neutral-200 text-[#0A0A0A]'
            }`}
          >
           <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h4 className={`font-bold text-sm ${isAr ? 'leading-relaxed' : ''} ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                <span dir="auto">{pickLangText(l.item.name, lang)}</span>
                {variant ? (
                  <span className={`font-semibold tabular-nums ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    {' '}(<span dir="auto">{featureName(menu, l.variantId as string, lang)}</span>{baseUnit !== 0 && (<> · <span dir="ltr">{formatPrice(baseUnit)}</span></>)})
                  </span>
                ) : l.addonIds.length > 0 ? (
                  <span className={`font-semibold tabular-nums ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    {baseUnit !== 0 && (<>{' '}· <span dir="ltr">{formatPrice(baseUnit)}</span></>)}
                  </span>
                ) : null}
              </h4>
            </div>

            {/* Quantity Stepper & Remove */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 bg-[var(--primary)] text-[#0A0A0A] rounded-full p-1.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => onUpdateLine(l.key, -1)}
                  className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center transition-all text-[#0A0A0A]"
                  aria-label="Decrease quantity"
                >
                  <Minus size={18} className="stroke-[3]" />
                </button>
                <span className="font-black text-sm px-1 min-w-[28px] text-center text-[#0A0A0A] tabular-nums">
                  {l.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateLine(l.key, 1)}
                  className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center transition-all text-[#0A0A0A]"
                  aria-label="Increase quantity"
                >
                  <Plus size={18} className="stroke-[3]" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => onRemoveLine(l.key)}
                className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                  darkMode ? 'text-neutral-400 hover:text-red-400 hover:bg-red-500/10' : 'text-neutral-500 hover:text-red-600 hover:bg-red-500/10'
                }`}
                aria-label="Remove item"
              >
                <Trash2 size={18} />
              </button>
            </div>
            </div>
           {/* Add-on chips: full-width row of their own — they used to share
               the narrow name column with the stepper beside it and visually
               collided with it on small phones. */}
            {l.addonIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
              {l.addonIds.map((id) => {
                  const addonPrice = (l.item.addons || []).find((a) => a && a.featureId === id)?.price ?? 0;
                  // Spicy is a red pro pill (Flame + label), never "+ name".
                  const spicy = isSpicyFeatureId(id);
                  const spicyText = spicy ? spicyLabel(lang) : '';
                  // Split lines: partial picks (0 < count < qty) render as
                  // `name ×n`; full-count and legacy picks render exactly as
                  // today (non-spicy add-ons keep the `+ name` receipt shape).
                  const count = l.addonQty?.[id] ?? l.quantity;
                  const partial = count > 0 && count < l.quantity;
                  return (
                    <span
                      key={id}
                      className={`inline-flex items-center gap-1.5 ps-3 pe-1.5 py-1.5 rounded-full text-xs font-bold border max-w-full ${
                        spicy
                          ? 'border-red-600/30 bg-red-600/5 text-red-600 dark:border-red-400/30 dark:bg-red-400/5 dark:text-red-400'
                          : darkMode
                          ? 'border-[var(--primary)]/30 bg-[var(--primary)]/5 text-[var(--primary)]'
                          : 'border-[#8a6d00]/30 bg-[#8a6d00]/5 text-[#8a6d00]'
                      }`}
                    >
                      {spicy && <Flame size={12} className="shrink-0" aria-hidden="true" />}
                      <bdi className="min-w-0 break-words">{spicy ? spicyText : `+ ${featureName(menu, id, lang)}`}{partial ? ` ×${count}` : ''}</bdi>
                      {/* Zero-price add-ons show no price text (mirrors the item modal). */}
                      {addonPrice !== 0 && (
                        <span className="tabular-nums opacity-80 shrink-0" dir="ltr">
                          {formatPrice(addonPrice)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveAddon(l.key, id)}
                        className={`flex items-center justify-center w-8 h-8 min-w-[32px] min-h-[32px] rounded-full shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                          darkMode ? 'hover:bg-red-500/20 hover:text-red-400' : 'hover:bg-red-500/10 hover:text-red-600'
                        }`}
                        title={spicy ? (isAr ? 'إزالة الحار' : 'Remove Spicy') : (isAr ? 'إزالة الإضافة من السطر' : 'Remove add-on from this line')}
                        aria-label={`${spicy ? (isAr ? 'إزالة الحار' : 'Remove Spicy') : `${isAr ? 'إزالة الإضافة' : 'Remove add-on'} ${featureName(menu, id, lang)}`}${partial ? ` ×${count}` : ''}`}
                      >
                        <X size={14} strokeWidth={3} />
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
