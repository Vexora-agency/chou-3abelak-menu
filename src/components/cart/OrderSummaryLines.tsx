import React from 'react';
import { formatPrice } from '@/src/utils/pricing';
import { AlertCircle } from 'lucide-react';

interface OrderSummaryLinesProps {
  errorMsg: string;
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
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-xs font-bold">
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
        {feeActive && (
          <div className="flex justify-between items-center">
            <span className={darkMode ? 'text-neutral-400' : 'text-neutral-600'}>
              {isAr ? 'المجموع الفرعي:' : 'Subtotal:'}
            </span>
            <span className={`font-bold text-sm ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {formatPrice(subtotal, currency)}
            </span>
          </div>
        )}

        {feeActive && (
          <div className="flex justify-between items-center">
            <span className={darkMode ? 'text-neutral-400' : 'text-neutral-600'}>
              {isAr ? 'رسوم التوصيل:' : 'Delivery Fee:'}
            </span>
            <span className={`font-bold text-sm ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {formatPrice(deliveryFee, currency)}
            </span>
          </div>
        )}

        {isBelowMin && (
          <div className="text-amber-600 font-bold text-[11px] pt-1">
            * {isAr ? `الحد الأدنى للطلب ${formatPrice(minOrder, currency)}` : `Minimum order is ${formatPrice(minOrder, currency)}`}
          </div>
        )}

        <div
          className={`flex justify-between items-center text-sm font-black pt-2.5 border-t ${
            darkMode ? 'border-neutral-700' : 'border-neutral-300'
          }`}
        >
          <span className={darkMode ? 'text-white' : 'text-[#0A0A0A]'}>
            {feeActive
              ? (isAr ? 'الإجمالي الكلي:' : 'Total:')
              : (isAr ? 'المجموع الفرعي:' : 'Subtotal:')}
          </span>
          <span className="text-base px-3.5 py-1 rounded-full bg-[#FFC400] text-[#0A0A0A] font-black shadow-xs">
            {formatPrice(grandTotal, currency)}
          </span>
        </div>
      </div>
    </>
  );
};
