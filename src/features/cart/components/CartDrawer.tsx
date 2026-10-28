import React, { useEffect } from 'react';
import { MenuData, ResolvedCartLine } from '@/src/types/menu';
import { type OrderingStatus } from '@/src/utils/status';
import { X, Send, CheckCircle2 } from 'lucide-react';
import { useCartCheckoutSubmit } from '../hooks/useCartCheckoutSubmit';
import { CartLinesList } from './cart/CartLinesList';
import { CustomerFormFields } from './cart/CustomerFormFields';
import { OrderSummaryLines } from './cart/OrderSummaryLines';
import { CartCheckoutFooter } from './cart/CartCheckoutFooter';
import { CartLocationSheet } from './cart/CartLocationSheet';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  menu: MenuData;
  lines: ResolvedCartLine[];
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onRemoveLine: (key: string) => void;
  onRemoveAddon: (lineKey: string, featureId: string) => void;
  onClearCart: () => void;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
  orderingState?: OrderingStatus | null;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  menu,
  lines,
  onUpdateLine,
  onRemoveLine,
  onRemoveAddon,
  onClearCart,
  currency,
  lang,
  darkMode,
  orderingState,
}) => {
  const isAr = lang === 'ar';
  const {
    customer,
    setCustomer,
    honeypot,
    setHoneypot,
    location,
    locSheetOpen,
    setLocSheetOpen,
    clearLocation,
    closeLocSheet,
    handleMapPick,
    distanceText,
    subtotal,
    deliveryFee,
    grandTotal,
    feeActive,
    isBelowMin,
    minOrder,
    orderBlocked,
    blockedMsg,
    reopenText,
    orderPrepared,
    setOrderPrepared,
    errorMsg,
    setErrorMsg,
    idemKeyRef,
    handleSendOrder,
  } = useCartCheckoutSubmit({ menu, lines, lang, currency, orderingState, onOrderSuccess: onClearCart });

  // Lock body scroll when open (no state inside — rule-clean effect).
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    if (!isOpen) idemKeyRef.current = null;
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, idemKeyRef]);

  // Escape closes the topmost layer first (location sheet, then the
  // drawer) — same keyboard contract as the item details sheet.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Same as the sheet's own X / backdrop: dismiss discards the
      // unconfirmed pick instead of keeping a half-chosen point.
      if (locSheetOpen) closeLocSheet(false);
      else onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, locSheetOpen, closeLocSheet, onClose]);

  // Reset transient checkout state whenever the drawer closes.
  // Render-phase adjustment (blessed pattern): guarded so it converges
  // immediately, and the closed drawer never flashes stale errors.
  if (!isOpen && (orderPrepared || errorMsg !== '' || location !== null)) {
    setOrderPrepared(false);
    setErrorMsg('');
    clearLocation();
  }

  if (!isOpen) return null;

  const handleClearCartWithLocation = () => { clearLocation(); onClearCart(); };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 anim-fade-in"
        aria-hidden="true"
      />

      {/* Drawer on mobile, Centered Modal on Desktop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isAr ? 'سلة الطلبات وإتمام الشراء' : 'Order Checkout'}
        className={`relative z-10 w-full max-w-[540px] max-h-[92vh] overflow-y-auto overscroll-contain no-scrollbar rounded-t-[28px] md:rounded-[28px] border-t-[5px] border-t-[var(--primary)] md:border-2 md:border-[var(--primary)] px-6 sm:px-8 pt-4 sm:pt-6 pb-8 anim-drawer-in shadow-2xl transition-colors duration-200 ${
          darkMode ? 'bg-[#141414] text-white' : 'bg-white text-[#0A0A0A]'
        }`}
      >
        {/* Drag Pill Handle (Mobile only) */}
        <div
          className={`w-11 h-1.5 rounded-full mx-auto mb-4 md:hidden ${
            darkMode ? 'bg-neutral-600' : 'bg-neutral-300'
          }`}
        />

        {/* Header */}
        <div
          className={`flex justify-between items-center pb-3 border-b ${
            darkMode ? 'border-neutral-800' : 'border-neutral-200'
          }`}
        >
          <div>
            <h2 className={`text-xl font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {isAr ? 'سلة طلبك' : 'Your Order'}
            </h2>
            <p className={`text-xs mt-0.5 font-medium ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {lines.length} {isAr ? 'أصناف مختارة' : 'items selected'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              darkMode
                ? 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'
                : 'bg-neutral-100 text-neutral-700 hover:text-black hover:bg-neutral-200'
            }`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Order Prepared Confirmation Screen */}
        {orderPrepared ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 text-green-600 flex items-center justify-center mx-auto">
              <CheckCircle2 size={36} />
            </div>
            <h3 className={`text-xl font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {isAr ? 'تم تجهيز طلبك بنجاح!' : 'Order prepared successfully!'}
            </h3>
            <p className={`text-sm max-w-xs mx-auto leading-relaxed ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
              {isAr
                ? 'يرجى الضغط على زر "إرسال" داخل تطبيق واتساب لتأكيد الطلب مع المطعم.'
                : 'Please press "Send" in WhatsApp to confirm your order with the kitchen.'}
            </p>
            <div className="pt-4 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => void handleSendOrder()}
                className="btn-tactile h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-bold text-sm flex items-center justify-center gap-2 shadow-md hover:brightness-110"
              >
                <Send size={16} />
                <span>{isAr ? 'إعادة فتح واتساب' : 'Re-open WhatsApp'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearCart();
                  onClose();
                }}
                className={`h-11 rounded-full border text-xs font-semibold transition-colors ${
                  darkMode
                    ? 'border-neutral-700 text-neutral-300 hover:bg-white/5'
                    : 'border-neutral-300 text-neutral-700 hover:bg-black/5'
                }`}
              >
                {isAr ? 'مسح السلة وإغلاق' : 'Clear cart and close'}
              </button>
            </div>
          </div>
        ) : lines.length === 0 ? (
          <div className="py-12 text-center">
            <p className={`text-sm font-semibold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {isAr ? 'سلتك فارغة حالياً' : 'Your cart is empty'}
            </p>
          </div>
        ) : (
          <div className="space-y-5 mt-4">
            {/* Cart Items List (no inner scroller: the list grows naturally) */}
            <CartLinesList
              menu={menu}
              lines={lines}
              lang={lang}
              darkMode={darkMode}
              onUpdateLine={onUpdateLine}
              onRemoveLine={onRemoveLine}
              onRemoveAddon={onRemoveAddon}
            />

            {/* Customer Inputs Form */}
            <CustomerFormFields
              customer={customer}
              setCustomer={setCustomer}
              honeypot={honeypot}
              setHoneypot={setHoneypot}
              location={location}
              distanceText={distanceText}
              lang={lang}
              darkMode={darkMode}
              onOpenLocSheet={() => setLocSheetOpen(true)}
              onClearLocation={clearLocation}
            />

            {/* Error + Bill Summary */}
            <OrderSummaryLines
              errorMsg={errorMsg}
              lines={lines}
              menu={menu}
              subtotal={subtotal}
              deliveryFee={deliveryFee}
              grandTotal={grandTotal}
              feeActive={feeActive}
              isBelowMin={isBelowMin}
              minOrder={minOrder}
              currency={currency}
              lang={lang}
              darkMode={darkMode}
            />

            {/* Availability + Action Buttons */}
            <CartCheckoutFooter
              orderBlocked={orderBlocked}
              blockedMsg={blockedMsg}
              reopenText={reopenText}
              lang={lang}
              darkMode={darkMode}
              onSend={() => void handleSendOrder()}
              onClearCart={handleClearCartWithLocation}
            />

            {/* Bottom Close — same contract as the item sheet: keep
                shopping without touching the cart contents. */}
            <button
              type="button"
              onClick={onClose}
              className={`btn-tactile w-full h-11 rounded-full border text-sm font-semibold transition-colors ${
                darkMode
                  ? 'border-neutral-700 text-neutral-300 hover:bg-white/5'
                  : 'border-neutral-300 text-neutral-700 hover:bg-black/5'
              }`}
            >
              {isAr ? 'إغلاق' : 'Close'}
            </button>
          </div>
        )}
      </div>

      {/* Location picker sheet */}
      {locSheetOpen && (
        <CartLocationSheet
          location={location}
          lang={lang}
          darkMode={darkMode}
          onCloseSheet={closeLocSheet}
          onPick={handleMapPick}
        />
      )}
    </div>
  );
};
