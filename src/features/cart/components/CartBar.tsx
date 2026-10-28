import React, { useState, useEffect } from 'react';
import { ShoppingBag, ArrowRight, ArrowLeft, Trash2, PauseCircle, MoonStar } from 'lucide-react';
import { formatPrice } from '@/src/utils/pricing';
import type { OrderingStatus } from '@/src/utils/status';

interface CartBarProps {
  totalCount: number;
  totalPrice: number;
  currency: string;
  onOpenCart: () => void;
  onClearCart: () => void;
  lang: 'en' | 'ar';
  orderingState?: OrderingStatus | null;
}

export const CartBar: React.FC<CartBarProps> = ({
  totalCount,
  totalPrice,
  currency,
  onOpenCart,
  onClearCart,
  lang,
  orderingState,
}) => {
  const isAr = lang === 'ar';

  // Delete confirmation dialog (opens on trash tap)
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Close the confirmation on Escape
  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmOpen]);

  const handleConfirmDelete = () => {
    setConfirmOpen(false);
    onClearCart();
  };

  if (totalCount === 0) return null;

  const blocked = orderingState && orderingState.state !== 'open';
  const statusText = !orderingState || orderingState.state === 'open'
    ? ''
    : orderingState.state === 'paused'
      ? (isAr ? 'الطلبات متوقفة مؤقتاً' : 'Orders paused')
      : orderingState.state === 'closed'
        ? (orderingState.message[lang] || (isAr ? 'مغلق حالياً' : 'Currently closed'))
        : (isAr ? 'الطلب غير متاح حالياً' : 'Ordering unavailable');

  return (
    <aside
      aria-label={isAr ? 'شريط سلة الطلبات' : 'Cart overview bar'}
      className="fixed bottom-4 left-0 right-0 z-30 px-4 flex flex-col items-center gap-1.5 pointer-events-none"
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
        className="pointer-events-auto w-full max-w-[480px] sm:max-w-lg md:max-w-xl h-14 bg-[#0A0A0A] border-2 border-[var(--primary)] text-white rounded-full px-5 sm:px-6 flex items-center justify-between gap-2 shadow-2xl cursor-pointer hover:scale-[1.01] active:scale-[0.98] transition-transform anim-cart-bar"
        aria-live="polite"
      >
        {/* Left: Bag Icon & Item Count */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center font-black">
              <ShoppingBag size={17} className="stroke-[2.5]" />
            </div>
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[11px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-[#0A0A0A]">
              {totalCount}
            </span>
          </div>

          <div>
            <div className="text-xs text-neutral-400 font-medium leading-tight">
              {isAr ? 'إجمالي الطلب' : 'Your Order'}
            </div>
            <div className="text-base font-extrabold text-[var(--primary)] whitespace-nowrap leading-tight">
              {formatPrice(totalPrice, currency)}
            </div>
          </div>
        </div>

        {/* Right: quick delete + CTA */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
            aria-label={isAr ? 'إفراغ السلة' : 'Clear cart'}
            title={isAr ? 'حذف السلة' : 'Clear cart'}
            className="max-[379px]:hidden w-9 h-9 flex-shrink-0 rounded-full text-red-500/70 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-all active:scale-90"
          >
            <Trash2 size={15} />
          </button>
          <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] sm:text-xs font-bold uppercase tracking-wide bg-[var(--primary)] text-[#0A0A0A] px-3.5 sm:px-4 py-2 rounded-full shadow-sm">
            <span>{isAr ? 'معاينة الطلب' : 'View Order'}</span>
            {isAr ? <ArrowLeft size={14} className="stroke-[3]" /> : <ArrowRight size={14} className="stroke-[3]" />}
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmOpen && (
        <div
          className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label={isAr ? 'تأكيد حذف السلة' : 'Confirm clear cart'}
        >
          <div
            className="fixed inset-0 bg-black/60 anim-fade-in"
            onClick={() => setConfirmOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-[320px] bg-[#141414] text-white border-2 border-[var(--primary)] rounded-2xl p-5 text-center shadow-2xl anim-pop-in">
            <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto mb-3">
              <Trash2 size={22} />
            </div>
            <h3 className="text-base font-extrabold">
              {isAr ? 'هل تود حذف السلة؟' : 'Clear your cart?'}
            </h3>
            <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
              {isAr ? 'سيتم حذف كل الأصناف من السلة نهائياً.' : 'All items will be permanently removed from your cart.'}
            </p>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 h-11 rounded-full border border-white/20 text-white/80 text-sm font-bold hover:bg-white/5 transition-colors"
              >
                {isAr ? 'تراجع' : 'Keep cart'}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="btn-tactile flex-1 h-11 rounded-full bg-red-500 text-white text-sm font-bold hover:bg-red-600 shadow-md"
              >
                {isAr ? 'حذف' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
