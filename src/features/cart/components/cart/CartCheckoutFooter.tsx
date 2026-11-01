import React from 'react';
import { PauseCircle, Send } from 'lucide-react';

interface CartCheckoutFooterProps {
  orderBlocked: boolean;
  blockedMsg: string;
  reopenText: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** In-flight send: button locks so double-taps can't fire concurrent POSTs. */
  sending: boolean;
  onSend: () => void;
  onClearCart: () => void;
}

export const CartCheckoutFooter: React.FC<CartCheckoutFooterProps> = ({
  orderBlocked,
  blockedMsg,
  reopenText,
  lang,
  darkMode,
  sending,
  onSend,
  onClearCart,
}) => {
  const isAr = lang === 'ar';
  return (
    <>
      {/* Availability status line */}
      {orderBlocked && (
        <div id="order-status-line" role="status" className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-bold ${darkMode ? 'bg-orange-500/10 border-orange-400/30 text-orange-300' : 'bg-amber-100 border-amber-500 text-amber-900'}`}>
          <PauseCircle size={16} className="flex-shrink-0" />
          <span>{blockedMsg} {reopenText}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2.5 pt-1">
        <button
          type="button"
          onClick={onSend}
          disabled={orderBlocked || sending}
          aria-describedby={orderBlocked ? 'order-status-line' : undefined}
          className={`btn-tactile w-full rounded-full font-black text-sm flex items-center justify-center gap-2 shadow-lg ${orderBlocked ? 'min-h-12 h-auto py-2.5 px-4 text-xs leading-snug bg-neutral-700 text-neutral-300 cursor-not-allowed' : 'h-12 bg-[var(--primary)] text-[#0A0A0A] hover:brightness-110'} ${sending && !orderBlocked ? 'opacity-70 cursor-wait' : ''}`}
        >
          {orderBlocked ? (
            /* Blocked: the status line above already says why (once). The button
               keeps its action label in a disabled skin so the layout never
               jumps and the CTA stays recognizable. */
            <>
              <Send size={18} className="opacity-60" />
              <span>{isAr ? 'إرسال الطلب' : 'Send Order'}</span>
            </>
          ) : (
            <>
              <Send size={18} />
              <span>{sending ? (isAr ? 'جارٍ إرسال الطلب…' : 'Sending order…') : (isAr ? 'إرسال الطلب' : 'Send Order')}</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onClearCart}
          className={`w-full h-11 min-h-[44px] rounded-full text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
            darkMode
              ? 'text-neutral-400 hover:text-red-400'
              : 'text-neutral-600 hover:text-red-600'
          }`}
        >
          {isAr ? 'إفراغ السلة' : 'Clear Cart'}
        </button>
        <p className={`text-center text-xs leading-relaxed ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
          {isAr ? 'اسمك وهاتفك وعنوانك تُستخدم فقط لتجهيز طلبك. ' : 'Your name, phone and address are used only to prepare your order. '}
          <a href="/privacy" className="underline underline-offset-4 font-bold hover:text-[var(--primary)] inline-flex items-center min-h-[44px] px-1 -my-3">
            {isAr ? 'الخصوصية' : 'Privacy'}
          </a>
        </p>
      </div>
    </>
  );
};
