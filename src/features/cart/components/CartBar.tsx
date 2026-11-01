import React from 'react';
import { ShoppingBag, ArrowRight, ArrowLeft, PauseCircle, MoonStar } from 'lucide-react';
import { formatPrice } from '@/src/utils/pricing';
import type { OrderingStatus } from '@/src/utils/status';

interface CartBarProps {
  totalCount: number;
  totalPrice: number;
  currency: string;
  onOpenCart: () => void;
  lang: 'en' | 'ar';
  orderingState?: OrderingStatus | null;
}

export const CartBar: React.FC<CartBarProps> = ({
  totalCount,
  totalPrice,
  currency,
  onOpenCart,
  lang,
  orderingState,
}) => {
  const isAr = lang === 'ar';

  if (totalCount === 0) return null;

  const blocked = orderingState && orderingState.state !== 'open';
  // Every blocked state shows the SERVER's own message (it carries the
  // reason + reopen time) — no more generic text hiding the real cause.
  const statusText = !orderingState || orderingState.state === 'open'
    ? ''
    : (orderingState.message && (orderingState.message[lang] || orderingState.message.en)) ||
      (orderingState.state === 'paused'
        ? (isAr ? 'الطلبات متوقفة مؤقتاً' : 'Orders paused')
        : orderingState.state === 'closed'
          ? (isAr ? 'مغلق حالياً' : 'Currently closed')
          : (isAr ? 'الطلب غير متاح حالياً' : 'Ordering unavailable'));

  return (
    <aside
      aria-label={isAr ? 'شريط سلة الطلبات' : 'Cart overview bar'}
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-30 px-4 flex flex-col items-center gap-1.5 pointer-events-none"
    >
      {blocked && statusText ? (
        <div role="status" className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/80 border border-neutral-700 text-[11px] font-bold text-neutral-200">
          {orderingState?.state === 'paused' ? <PauseCircle size={13} className="text-orange-400" /> : <MoonStar size={13} className="text-neutral-400" />}
          <span>{statusText}</span>
        </div>
      ) : null}
      <div
        onClick={onOpenCart}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpenCart();
        }}
        className="pointer-events-auto w-full max-w-[480px] sm:max-w-lg md:max-w-xl h-14 bg-[#0A0A0A] border-2 border-[var(--primary)] text-white rounded-full px-4 sm:px-6 flex items-center justify-between gap-1.5 sm:gap-2 shadow-2xl cursor-pointer hover:scale-[1.01] active:scale-[0.98] transition-transform anim-cart-bar"
        aria-live="polite"
      >
        {/* Left: Bag Icon & Item Count */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center font-black">
              <ShoppingBag size={17} className="stroke-[2.5]" />
            </div>
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[11px] font-black min-w-5 h-5 px-1 rounded-full flex items-center justify-center border-2 border-[#0A0A0A] tabular-nums">
              {totalCount > 99 ? '99+' : totalCount}
            </span>
          </div>

          <div>
            <div className={`text-xs text-neutral-400 font-medium ${isAr ? 'leading-relaxed' : 'leading-tight'}`}>
              {isAr ? 'إجمالي الطلب' : 'Your Order'}
            </div>
            <div className="text-sm sm:text-base font-extrabold text-[var(--primary)] whitespace-nowrap leading-tight tabular-nums" dir="ltr">
              {formatPrice(totalPrice, currency)}
            </div>
          </div>
        </div>

        {/* Right: CTA only. Clearing lives inside the drawer (Clear Cart +
            per-line remove) — one home for destructive actions, so the bar
            is identical on every screen size instead of hiding controls
            under 380px. */}
        <div className="flex items-center shrink-0">
          <div className={`flex items-center gap-1 sm:gap-1.5 whitespace-nowrap text-[11px] sm:text-xs font-bold bg-[var(--primary)] text-[#0A0A0A] px-3 sm:px-4 py-2 min-h-[44px] rounded-full shadow-sm ${isAr ? '' : 'uppercase tracking-wide'}`}>
            <span>{isAr ? 'معاينة الطلب' : 'View Order'}</span>
            {isAr ? <ArrowLeft size={14} className="stroke-[3]" /> : <ArrowRight size={14} className="stroke-[3]" />}
          </div>
        </div>
      </div>
    </aside>
  );
};
