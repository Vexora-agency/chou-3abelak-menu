import React from 'react';
import type { MenuData, ResolvedCartLine } from '@/src/types/menu';
import { formatPrice, unitPrice, featureName } from '@/src/utils/pricing';
import { pickLangText, isSpicyFeatureId, spicyDegreeLabel } from '@/src/utils/menuHelpers';
import { useGuardedText } from '@/src/hooks/useGuardedText';
import { AlertCircle } from 'lucide-react';

interface OrderSummaryLinesProps {
  errorMsg: string;
  lines: ResolvedCartLine[];
  menu: MenuData;
  subtotal: number;
  deliveryFee: number;
  feeDetail?: string | null;
  feeFreeApplied?: boolean;
  grandTotal: number;
  feeActive: boolean;
  isBelowMin: boolean;
  minOrder: number;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

export const OrderSummaryLines: React.FC<OrderSummaryLinesProps> = ({
  errorMsg,
  lines,
  menu,
  subtotal,
  deliveryFee,
  feeDetail,
  feeFreeApplied,
  grandTotal,
  feeActive,
  isBelowMin,
  minOrder,
  currency,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';
  const grandTotalRef = useGuardedText(formatPrice(grandTotal, currency));
  return (
    <>
      {/* Error Message */}
      {errorMsg && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-sm font-bold">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Bill Summary */}
      <div
        className={`p-4 rounded-xl border space-y-2 text-xs transition-colors ${
          darkMode
            ? 'bg-[#1c1c1c] border-neutral-800 text-neutral-300'
            : 'bg-neutral-100 border-neutral-200 text-neutral-700'
        }`}
      >
        {/* Itemized receipt: base + every add-on with its price */}
        {lines.length > 0 && (
          <div className={`space-y-1.5 pb-2 border-b ${darkMode ? 'border-neutral-800' : 'border-neutral-200'}`}>
            {lines.map((l) => {
              const base = unitPrice(l.item, l.variantId);
              const baseName = l.variantId ? featureName(menu, l.variantId, lang) : pickLangText(l.item.name, lang);
              const addonParts = l.addonIds.map((id) => {
                const price = (l.item.addons || []).find((a) => a && a.featureId === id)?.price ?? 0;
                // Split lines: partial picks (0 < count < qty) render as
                // `name ×n`; full-count and legacy picks render exactly as
                // today. Zero-price add-ons show no price text (mirrors
                // the item modal). Spicy renders as an explicit-degree
                // parenthetical, e.g. (حار متوسط).
                const count = l.addonQty?.[id] ?? l.quantity;
                const partial = count > 0 && count < l.quantity;
                const spicy = isSpicyFeatureId(id);
                return { key: id, name: spicy ? spicyDegreeLabel(lang, id) : featureName(menu, id, lang), count: partial ? count : null, price, spicy };
              });
              return (
                <div key={l.key}>
                  <div className="flex justify-between items-baseline gap-2">
                    <span className={`font-bold min-w-0 flex-1 break-words ${darkMode ? 'text-neutral-200' : 'text-neutral-800'}`}>
                      <span dir="auto">{pickLangText(l.item.name, lang)}</span>
                      <span dir="ltr"> × </span><bdi dir="ltr" className="tabular-nums">{l.quantity}</bdi>
                    </span>
                    <span className={`font-bold tabular-nums whitespace-nowrap shrink-0 ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                      <bdi dir="ltr" className="tabular-nums">{formatPrice(l.total)}</bdi> <span dir="auto">{currency}</span>
                    </span>
                  </div>
                  <p className={`text-xs tabular-nums break-words ${isAr ? 'leading-relaxed' : ''} ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                    <bdi dir="auto">{baseName}</bdi>
                    {base !== 0 && (
                      <>{' '}<bdi dir="ltr" className="tabular-nums">{formatPrice(base)}</bdi> <span dir="auto">{currency}</span></>
                    )}
                      {addonParts.map((a) => (
                        <React.Fragment key={a.key}>
                          {a.spicy ? (
                            <>
                              <span> (</span><bdi dir="auto">{a.name}</bdi>
                              {a.count !== null && (
                                <><span dir="ltr"> ×</span><bdi dir="ltr" className="tabular-nums">{a.count}</bdi></>
                              )}
                              <span>)</span>
                            </>
                          ) : (
                            <>
                              <span dir="ltr"> + </span><bdi dir="auto">{a.name}</bdi>
                              {a.count !== null && (
                                <><span dir="ltr"> ×</span><bdi dir="ltr" className="tabular-nums">{a.count}</bdi></>
                              )}
                              {a.price !== 0 && (
                                <>{' '}<bdi dir="ltr" className="tabular-nums">{formatPrice(a.price)}</bdi> <span dir="auto">{currency}</span></>
                              )}
                            </>
                          )}
                        </React.Fragment>
                      ))}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        {feeActive && (
          <div className="flex justify-between items-center gap-2">
            <span className={`min-w-0 ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {isAr ? 'المجموع الفرعي:' : 'Subtotal:'}
            </span>
            <span className={`font-bold text-sm tabular-nums shrink-0 ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              <bdi dir="ltr" className="tabular-nums">{formatPrice(subtotal)}</bdi> <span dir="auto">{currency}</span>
            </span>
          </div>
        )}

        {feeActive && (
          <div className="flex justify-between items-center gap-2">
            <span className={`min-w-0 ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {isAr ? 'رسوم التوصيل:' : 'Delivery Fee:'}
              {feeDetail && (
                <span className={`block text-[10px] font-normal ${feeFreeApplied ? 'text-green-500 font-bold' : ''}`} dir="auto">
                  {feeFreeApplied ? `🎉 ${feeDetail}` : feeDetail}
                </span>
              )}
            </span>
            <span className={`font-bold text-sm tabular-nums shrink-0 ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {feeFreeApplied ? (
                <span className="text-green-500">{isAr ? 'مجاني' : 'FREE'}</span>
              ) : (
                <><bdi dir="ltr" className="tabular-nums">{formatPrice(deliveryFee)}</bdi> <span dir="auto">{currency}</span></>
              )}
            </span>
          </div>
        )}

        {isBelowMin && (
          <div className="text-amber-600 font-bold text-xs pt-1">
            * {isAr ? <>الحد الأدنى للطلب <bdi dir="ltr" className="tabular-nums">{formatPrice(minOrder)}</bdi> <span dir="auto">{currency}</span></> : <>Minimum order is <bdi dir="ltr" className="tabular-nums">{formatPrice(minOrder)}</bdi> <span dir="auto">{currency}</span></>}
          </div>
        )}

        <div
          className={`flex justify-between items-center gap-2 text-sm font-black pt-2.5 border-t ${
            darkMode ? 'border-neutral-700' : 'border-neutral-300'
          }`}
        >
          <span className={`min-w-0 ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
            {feeActive
              ? (isAr ? 'الإجمالي الكلي:' : 'Total:')
              : (isAr ? 'المجموع الفرعي:' : 'Subtotal:')}
          </span>
          <span ref={grandTotalRef} className="text-base px-3.5 py-1 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-black shadow-xs tabular-nums shrink-0 whitespace-nowrap">
            <bdi dir="ltr" className="tabular-nums">{formatPrice(grandTotal)}</bdi> <span dir="auto">{currency}</span>
          </span>
        </div>
      </div>
    </>
  );
};
