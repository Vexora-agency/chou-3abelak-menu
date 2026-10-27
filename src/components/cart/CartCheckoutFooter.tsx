import React from 'react';
import { PauseCircle, Send } from 'lucide-react';

interface CartCheckoutFooterProps {
  orderBlocked: boolean;
  blockedMsg: string;
  reopenText: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
  onSend: () => void;
  onClearCart: () => void;
}

export const CartCheckoutFooter: React.FC<CartCheckoutFooterProps> = ({
  orderBlocked,
  blockedMsg,
  reopenText,
  lang,
  darkMode,
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
          disabled={orderBlocked}
          aria-describedby={orderBlocked ? 'order-status-line' : undefined}
          className={`btn-tactile w-full rounded-full font-black text-sm flex items-center justify-center gap-2 shadow-lg ${orderBlocked ? 'min-h-12 h-auto py-2.5 px-4 text-xs leading-snug bg-neutral-700 text-neutral-300 cursor-not-allowed' : 'h-12 bg-[#FFC400] text-[#0A0A0A] hover:bg-[#ffd033]'}`}
        >
          {orderBlocked ? (
            <span>{blockedMsg} {reopenText}</span>
          ) : (
            <>
              <Send size={18} />
              <span>{isAr ? 'إرسال الطلب عبر واتساب' : 'Send Order on WhatsApp'}</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onClearCart}
          className={`w-full h-10 rounded-full text-xs font-bold transition-colors ${
            darkMode
              ? 'text-neutral-400 hover:text-red-400'
              : 'text-neutral-600 hover:text-red-600'
          }`}
        >
          {isAr ? 'إفراغ السلة' : 'Clear Cart'}
        </button>
        <p className={`text-center text-[11px] leading-relaxed ${darkMode ? 'text-neutral-500' : 'text-neutral-500'}`}>
          {isAr ? 'اسمك وهاتفك وعنوانك تُستخدم فقط لتجهيز طلبك. ' : 'Your name, phone and address are used only to prepare your order. '}
          <a href="privacy" className="underline underline-offset-2 font-bold hover:text-[#FFC400]">
            {isAr ? 'الخصوصية' : 'Privacy'}
          </a>
        </p>
      </div>
    </>
  );
};
