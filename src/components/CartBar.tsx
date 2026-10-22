import React from 'react';
import { ShoppingBag, ArrowRight, ArrowLeft } from 'lucide-react';
import { formatPrice } from '../utils/menuHelpers';

interface CartBarProps {
  totalCount: number;
  totalPrice: number;
  currency: string;
  onOpenCart: () => void;
  lang: 'en' | 'ar';
}

export const CartBar: React.FC<CartBarProps> = ({
  totalCount,
  totalPrice,
  currency,
  onOpenCart,
  lang,
}) => {
  const isAr = lang === 'ar';

  if (totalCount === 0) return null;

  return (
    <aside
      aria-label={isAr ? 'شريط سلة الطلبات' : 'Cart overview bar'}
      className="fixed bottom-4 left-0 right-0 z-30 px-4 flex justify-center pointer-events-none"
    >
      <div
        onClick={onOpenCart}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpenCart();
        }}
        className="pointer-events-auto w-full max-w-[480px] sm:max-w-lg md:max-w-xl h-14 bg-[#0A0A0A] border-2 border-[#FFC400] text-white rounded-full px-5 sm:px-6 flex items-center justify-between shadow-2xl cursor-pointer hover:scale-[1.01] active:scale-[0.98] transition-transform anim-bounce-cart"
        aria-live="polite"
      >
        {/* Left: Bag Icon & Item Count */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center font-black">
              <ShoppingBag size={17} className="stroke-[2.5]" />
            </div>
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[11px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-[#0A0A0A]">
              {totalCount}
            </span>
          </div>

          <div>
            <div className="text-xs text-neutral-400 font-medium">
              {isAr ? 'إجمالي الطلب' : 'Your Order'}
            </div>
            <div className="text-base font-extrabold text-[#FFC400]">
              {formatPrice(totalPrice, currency)}
            </div>
          </div>
        </div>

        {/* Right: CTA Button */}
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider bg-[#FFC400] text-[#0A0A0A] px-4 py-2 rounded-full shadow-sm">
          <span>{isAr ? 'معاينة الطلب' : 'View Order'}</span>
          {isAr ? <ArrowLeft size={14} className="stroke-[3]" /> : <ArrowRight size={14} className="stroke-[3]" />}
        </div>
      </div>
    </aside>
  );
};
