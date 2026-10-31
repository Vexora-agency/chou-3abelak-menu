import React from 'react';
import type { MenuData, ResolvedCartLine } from '@/src/types/menu';
import { formatPrice, unitPrice, featureName } from '@/src/utils/pricing';
import { pickLangText } from '@/src/utils/menuHelpers';
import { AlertCircle } from 'lucide-react';

interface OrderSummaryLinesProps {
  errorMsg: string;
  lines: ResolvedCartLine[];
  menu: MenuData;
  subtotal: number;
  deliveryFee: number;
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
  grandTotal,
  feeActive,
  isBelowMin,
  minOrder,
  currency,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';
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
              const parts = [
                `${l.variantId ? featureName(menu, l.variantId, lang) : pickLangText(l.item.name, lang)} ${formatPrice(base, currency)}`,
                ...l.addonIds.map((id) => {
                  const price = (l.item.addons || []).find((a) => a && a.featureId === id)?.price ?? 0;
                  return `${featureName(menu, id, lang)} ${formatPrice(price, currency)}`;
                }),
              ];
              return (
                <div key={l.key}>
                  <div className="flex justify-between items-baseline gap-2">
                    <span className={`font-bold min-w-0 flex-1 break-words ${darkMode ? 'text-neutral-200' : 'text-neutral-800'}`}>
                      <span dir="auto">{pickLangText(l.item.name, lang)}</span>
                      <bdi className="tabular-nums" dir="ltr"> × {l.quantity}</bdi>
                    </span>
                    <span className={`font-bold tabular-nums whitespace-nowrap shrink-0 ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`} dir="ltr">
                      {formatPrice(l.total, currency)}
                    </span>
                  </div>
                  <p className={`text-xs tabular-nums break-words ${isAr ? 'leading-relaxed' : ''} ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                    {parts.map((part, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span> + </span>}
                        <bdi>{part}</bdi>
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
            <span className={`font-bold text-sm tabular-nums shrink-0 ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`} dir="ltr">
              {formatPrice(subtotal, currency)}
            </span>
          </div>
        )}

        {feeActive && (
          <div className="flex justify-between items-center gap-2">
            <span className={`min-w-0 ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {isAr ? 'رسوم التوصيل:' : 'Delivery Fee:'}
            </span>
            <span className={`font-bold text-sm tabular-nums shrink-0 ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`} dir="ltr">
              {formatPrice(deliveryFee, currency)}
            </span>
          </div>
        )}

        {isBelowMin && (
          <div className="text-amber-600 font-bold text-xs pt-1">
            * {isAr ? <>الحد الأدنى للطلب <span className="tabular-nums" dir="ltr">{formatPrice(minOrder, currency)}</span></> : <>Minimum order is <span className="tabular-nums" dir="ltr">{formatPrice(minOrder, currency)}</span></>}
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
          <span className="text-base px-3.5 py-1 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-black shadow-xs tabular-nums shrink-0 whitespace-nowrap" dir="ltr">
            {formatPrice(grandTotal, currency)}
          </span>
        </div>
      </div>
    </>
  );
};
