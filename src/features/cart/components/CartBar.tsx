import React, { useState, useEffect, useRef } from 'react';
import { useBodyScrollLock } from '@/src/hooks/useBodyScrollLock';
import { useGuardedText } from '@/src/hooks/useGuardedText';
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
  const totalRef = useGuardedText<HTMLDivElement>(formatPrice(totalPrice, currency));

  // Latch the badge pop on a real count change only: the bar's own entrance
  // already plays on mount, and a parent re-render must never pop a count
  // that did not move.
  const [badgePop, setBadgePop] = useState(false);
  const prevCountRef = useRef(totalCount);
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = totalCount;
    if (prev !== totalCount) setBadgePop(true);
  }, [totalCount]);

  // Delete confirmation dialog (opens on trash tap)
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Per-sheet scroll lock while the confirm dialog is open.
  useBodyScrollLock(confirmOpen, 'cartbar-confirm');

  // Close the confirmation on Escape (scroll lock lives in the hook above).
  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [confirmOpen]);

  const handleConfirmDelete = () => {
    setConfirmOpen(false);
    onClearCart();
  };

  if (totalCount === 0) return null;

  const blocked = orderingState && orderingState.state !== 'open';
  // Every blocked state shows the SERVER's own message (it carries the
  // reason + reopen time) — no more generic text hiding the real cause.
  const statusText = !orderingState || orderingState.state === 'open'
    ? ''
    : (orderingState.message && (orderingState.message[lang] || orderingState.message.en)) ||
      (orderingState.state === 'paused'
        ? (isAr ? 'الطلبات متوقفة مؤقتًا' : 'Orders paused')
        : orderingState.state === 'closed'
          ? (isAr ? 'مغلق حاليًا' : 'Currently closed')
          : (isAr ? 'الطلب غير متاح حالياً' : 'Ordering unavailable'));

  return (
    <aside
      data-testid="cart-bar"
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
        data-testid="cart-bar-open"
        aria-label={isAr ? `فتح السلة (${totalCount})` : `Open cart (${totalCount})`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpenCart();
        }}
        className="pointer-events-auto w-full max-w-[480px] sm:max-w-lg md:max-w-xl h-14 bg-[#0A0A0A] border-2 border-[var(--primary)] text-white rounded-full px-4 sm:px-6 flex items-center justify-between gap-1.5 sm:gap-2 shadow-2xl cursor-pointer hover:scale-[1.01] active:scale-[0.98] transition-transform anim-cart-bar"
        aria-live="polite"
      >
        {/* Left: Bag Icon & Item Count */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="relative shrink-0">
            <div className="w-7 h-7 min-[380px]:w-8 min-[380px]:h-8 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center font-black">
              <ShoppingBag size={15} className="stroke-[2.5] min-[380px]:w-[17px] min-[380px]:h-[17px]" />
            </div>
            <span key={totalCount} data-testid="cart-bar-count" className={`absolute -top-1.5 -end-1.5 bg-red-500 text-white text-[11px] font-black min-w-5 h-5 px-1 rounded-full flex items-center justify-center border-2 border-[#0A0A0A] tabular-nums${badgePop ? ' anim-badge-pop' : ''}`}>
              {totalCount > 99 ? '99+' : totalCount}
            </span>
          </div>

          <div>
            <div className={`text-xs text-neutral-400 font-medium ${isAr ? 'leading-relaxed' : 'leading-tight'}`}>
              {isAr ? 'طلبك' : 'Your order'}
            </div>
            <div ref={totalRef} data-testid="cart-bar-total" data-count={totalCount} className="text-xs min-[380px]:text-sm sm:text-base font-extrabold text-[var(--primary)] whitespace-nowrap leading-tight tabular-nums text-start">
              <bdi dir="ltr" className="tabular-nums">{formatPrice(totalPrice)}</bdi> <span dir="auto">{currency}</span>
            </div>
          </div>
        </div>

        {/* Right: clear + CTA. The trash is ALWAYS rendered (no breakpoint
            hiding): on narrow phones it draws compact (36px) with an
            invisible expanded hit area (44px+), full size from 380px up. */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
            aria-label={isAr ? 'إفراغ السلة' : 'Clear cart'}
            title={isAr ? 'إفراغ السلة' : 'Clear cart'}
            className="relative w-9 h-9 min-w-[36px] min-h-[36px] min-[380px]:w-11 min-[380px]:h-11 min-[380px]:min-w-[44px] min-[380px]:min-h-[44px] after:absolute after:-inset-2 after:content-[''] flex-shrink-0 rounded-full text-red-500/70 hover:text-red-500 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 flex items-center justify-center transition-all active:scale-90"
          >
            <Trash2 size={16} className="min-[380px]:w-[18px] min-[380px]:h-[18px]" />
          </button>
          <div className={`flex items-center gap-1 sm:gap-1.5 whitespace-nowrap text-[10px] min-[380px]:text-[11px] sm:text-xs font-bold bg-[var(--primary)] text-[#0A0A0A] px-2.5 min-[380px]:px-3 sm:px-4 py-2 min-h-[44px] rounded-full shadow-sm ${isAr ? '' : 'uppercase tracking-wide'}`}>
            <span>{isAr ? 'معاينة الطلب' : 'View Order'}</span>
            {isAr ? <ArrowLeft size={13} className="stroke-[3] hidden min-[380px]:block" /> : <ArrowRight size={13} className="stroke-[3] hidden min-[380px]:block" />}
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmOpen && (
        <div
          className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center p-4 overscroll-contain"
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
              {isAr ? 'سيتم حذف كل الأصناف من السلة نهائيًا.' : 'All items will be permanently removed from your cart.'}
            </p>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 h-11 rounded-full border border-white/20 text-white/80 text-sm font-bold hover:bg-white/5 transition-colors"
              >
                {isAr ? 'إبقاء السلة' : 'Keep cart'}
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
