import React from 'react';
import { MenuData, ResolvedCartLine } from '@/src/types/menu';
import { pickLangText } from '@/src/utils/menuHelpers';
import { getVariant, lineMathText, featureName, unitPrice, formatPrice } from '@/src/utils/pricing';
import { Plus, Minus, Trash2, X } from 'lucide-react';

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
        return (
          <div
            key={l.key}
            className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-colors ${
              darkMode
                ? 'bg-[#1c1c1c] border-neutral-800 text-white'
                : 'bg-neutral-100 border-neutral-200 text-[#0A0A0A]'
            }`}
          >
            <div className="flex-1 min-w-0">
              <h4 className={`font-bold text-sm ${isAr ? 'leading-relaxed' : ''} ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                <span dir="auto">{pickLangText(l.item.name, lang)}</span>
                {variant ? (
                  <span className={`font-semibold tabular-nums ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    {' '}(<span dir="auto">{featureName(menu, l.variantId as string, lang)}</span> · <span dir="ltr">{formatPrice(baseUnit)}</span>)
                  </span>
                ) : l.addonIds.length > 0 ? (
                  <span className={`font-semibold tabular-nums ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    {' '}· <span dir="ltr">{formatPrice(baseUnit)}</span>
                  </span>
                ) : null}
              </h4>
              {l.addonIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {l.addonIds.map((id) => (
                    <span
                      key={id}
                      className={`inline-flex items-center gap-1.5 ps-3 pe-1.5 py-1.5 rounded-full text-xs font-bold border ${
                        darkMode
                          ? 'border-[var(--primary)]/30 bg-[var(--primary)]/5 text-[var(--primary)]'
                          : 'border-[#8a6d00]/30 bg-[#8a6d00]/5 text-[#8a6d00]'
                      }`}
                    >
                      <bdi>+ {featureName(menu, id, lang)}</bdi>
                      <span className="tabular-nums opacity-80" dir="ltr">
                        {formatPrice((l.item.addons || []).find((a) => a && a.featureId === id)?.price ?? 0)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveAddon(l.key, id)}
                        className={`flex items-center justify-center w-8 h-8 min-w-[32px] min-h-[32px] rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                          darkMode
                            ? 'hover:bg-red-500/20 hover:text-red-400'
                            : 'hover:bg-red-500/10 hover:text-red-600'
                        }`}
                        title={isAr ? 'إزالة الإضافة من السطر' : 'Remove add-on from this line'}
                        aria-label={`${isAr ? 'إزالة الإضافة' : 'Remove add-on'} ${featureName(menu, id, lang)}`}
                      >
                        <X size={14} strokeWidth={3} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Line math pill: wraps inside its bubble on narrow phones
                  (long unit words like "دستتين" + big totals overflowed it). */}
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span
                  className={`text-xs font-extrabold px-2.5 py-1 rounded-full shadow-xs tabular-nums max-w-full whitespace-normal break-words text-center leading-relaxed ${
                    darkMode
                      ? 'bg-[var(--primary)] text-[#0A0A0A]'
                      : 'bg-[#0A0A0A] text-[var(--primary)]'
                  }`}
                  dir="ltr"
                >
                  {lineMathText(l.item, l.quantity, l.unit, lang)}
                </span>
              </div>
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
        );
      })}
    </div>
  );
};
