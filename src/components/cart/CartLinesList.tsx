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
              <h4 className={`font-bold text-sm ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                {pickLangText(l.item.name, lang)}
                {variant ? (
                  <span className={`font-semibold tabular-nums ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    {' '}({featureName(menu, l.variantId as string, lang)} · {formatPrice(baseUnit)})
                  </span>
                ) : l.addonIds.length > 0 ? (
                  <span className={`font-semibold tabular-nums ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    {' '}· {formatPrice(baseUnit)}
                  </span>
                ) : null}
              </h4>
              {l.addonIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {l.addonIds.map((id) => (
                    <span
                      key={id}
                      className={`inline-flex items-center gap-1 ps-2 pe-1 py-0.5 rounded-full text-[11px] font-bold border ${
                        darkMode
                          ? 'border-[#FFC400]/30 bg-[#FFC400]/5 text-[#FFC400]'
                          : 'border-[#8a6d00]/30 bg-[#8a6d00]/5 text-[#8a6d00]'
                      }`}
                    >
                      <span>+ {featureName(menu, id, lang)}</span>
                      <span className="tabular-nums opacity-80">
                        {formatPrice((l.item.addons || []).find((a) => a && a.featureId === id)?.price ?? 0)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveAddon(l.key, id)}
                        className={`flex items-center justify-center w-3.5 h-3.5 rounded-full transition-colors ${
                          darkMode
                            ? 'hover:bg-red-500/20 hover:text-red-400'
                            : 'hover:bg-red-500/10 hover:text-red-600'
                        }`}
                        title={isAr ? 'إزالة الإضافة من السطر' : 'Remove add-on from this line'}
                        aria-label={`${isAr ? 'إزالة الإضافة' : 'Remove add-on'} ${featureName(menu, id, lang)}`}
                      >
                        <X size={11} strokeWidth={3} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Line math: 3 × 120,000 = 360,000 */}
              <div className="flex items-center gap-2 mt-1.5">
                <span
                  className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full shadow-xs tabular-nums ${
                    darkMode
                      ? 'bg-[#FFC400] text-[#0A0A0A]'
                      : 'bg-[#0A0A0A] text-[#FFC400]'
                  }`}
                  dir="ltr"
                >
                  {lineMathText(l.item, l.quantity, l.unit, lang)}
                </span>
              </div>
            </div>

            {/* Quantity Stepper & Remove */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[#FFC400] text-[#0A0A0A] rounded-full p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => onUpdateLine(l.key, -1)}
                  className="w-6 h-6 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center transition-colors text-[#0A0A0A]"
                  aria-label="Decrease quantity"
                >
                  <Minus size={12} className="stroke-[3]" />
                </button>
                <span className="font-black text-xs px-1 min-w-[18px] text-center text-[#0A0A0A] tabular-nums">
                  {l.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateLine(l.key, 1)}
                  className="w-6 h-6 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center transition-colors text-[#0A0A0A]"
                  aria-label="Increase quantity"
                >
                  <Plus size={12} className="stroke-[3]" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => onRemoveLine(l.key)}
                className={`p-1.5 transition-colors ${
                  darkMode ? 'text-neutral-400 hover:text-red-400' : 'text-neutral-500 hover:text-red-600'
                }`}
                aria-label="Remove item"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
