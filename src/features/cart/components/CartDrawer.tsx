import React, { useEffect, useRef } from 'react';
import { useBodyScrollLock } from '@/src/hooks/useBodyScrollLock';
import { MenuData, ResolvedCartLine } from '@/src/types/menu';
import { type OrderingStatus } from '@/src/utils/status';
import { X, CheckCircle2 } from 'lucide-react';
import { isProfileComplete, useCustomerProfile } from '@/src/features/auth';
import { useCartCheckoutSubmit } from '../hooks/useCartCheckoutSubmit';
import { CartLinesList } from './cart/CartLinesList';
import { CustomerFormFields } from './cart/CustomerFormFields';
import { dialFromSettings } from '@/src/utils/phoneCountry';
import { OrderSummaryLines } from './cart/OrderSummaryLines';
import { PaymentMethodSection } from './cart/PaymentMethodSection';
import { CartCheckoutFooter } from './cart/CartCheckoutFooter';
import { CartLocationSheet } from './cart/CartLocationSheet';
import { ZoneBlockedPanel } from './cart/ZoneBlockedPanel';

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
  /** Opens the auth sheet straight on Create account (COD requires one). */
  onRequireAccount?: () => void;
  /** Opens account settings over the cart (mandatory phone/address/pin). */
  onRequireProfile?: () => void;
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
  onRequireAccount,
  onRequireProfile,
}) => {
  const isAr = lang === 'ar';
  const phoneDial = dialFromSettings(menu.settings);
  const account = useCustomerProfile(isOpen);
  // New members (including Google sign-ups) must add a phone, default address
  // and map pin before any order. While the profile is still loading, stay
  // neutral instead of flashing the incomplete banner.
  const profileIncomplete = !!account.user && !account.loading && (!account.profile || !isProfileComplete(account.profile));
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
    distanceWarning,
    subtotal,
    deliveryFee,
    feeDetail,
    feeFreeApplied,
    grandTotal,
    feeActive,
    isBelowMin,
    minOrder,
    orderBlocked,
    blockedMsg,
    reopenText,
    orderPrepared,
    setOrderPrepared,
    lastOrder,
    setLastOrder,
    errorMsg,
    setErrorMsg,
    idemKeyRef,
    sending,
    handleSendOrder,
    zoneBlocked,
    zonePlaceName,
  } = useCartCheckoutSubmit({ menu, lines, lang, currency, orderingState, onOrderSuccess: onClearCart, accountUser: account.user, accountProfile: account.profile, accountLoading: account.loading, onRequireAccount, onRequireProfile });

  // Radical phone-scroll fix: shared counter lock (iOS-safe, nested-sheet
  // aware) instead of a bare overflow flag that iOS Safari ignores.
  useBodyScrollLock(isOpen, 'cart-drawer');
  // The drawer scroller keeps its scrollTop across the form -> confirmation
  // swap: after Send the tall form is replaced by a short confirmation, and
  // a stale scrollTop leaves a blank gap (iOS often fails to clamp it, which
  // reads as "stuck, can't scroll up"). Reset to top the moment the
  // confirmation lands so it is always fully visible. Legacy
  // scrollTo(0, 0) = instant everywhere (no 'instant' keyword needed, which
  // iOS throws on).
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOpen && orderPrepared) scrollerRef.current?.scrollTo(0, 0);
  }, [isOpen, orderPrepared]);
  useEffect(() => {
    if (!isOpen) {
      idemKeyRef.current = null;
    }
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
  // NOTE: location + customer persist across closes by design — they are the
  // remembered pair (synced to storage on submit). Clearing the pin here
  // used to wipe the remembered pin on every close (and on initial mount),
  // so repeat orders lost the exact pin; worse, storage/state could drift.
  if (!isOpen && (orderPrepared || errorMsg !== '' || lastOrder !== null)) {
    setOrderPrepared(false);
    setErrorMsg('');
    setLastOrder(null);
  }

  if (!isOpen) return null;

  const handleClearCartWithLocation = () => { clearLocation(); onClearCart(); };

  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 anim-fade-in"
        aria-hidden="true"
      />

      {/* Drawer on mobile, Centered Modal on Desktop.
          Entrance animation on the wrapper — NEVER on the scroll
          container below: transform-animated scrollers glitch on phones
          (stuck scroll-up, rubber-band jumps). */}
      {/* Bottom-flush, content-sized sheet: NO bottom margin (the old
          mb-[env(safe-area-inset-bottom)] lift exposed a permanent
          backdrop strip underneath) and NO forced full height (a
          full-height sheet with short content left a big empty area under
          the last button). The sheet hugs its content down to the
          viewport edge; 92dvh caps long content so it scrolls inside.
          Home-indicator clearance lives INSIDE the scroller below. */}
      <div
        className={`anim-drawer-in relative z-10 w-full max-w-[540px] max-h-[92vh] max-h-[92dvh] flex flex-col rounded-t-[28px] md:rounded-[28px] border-t-[5px] border-t-[var(--primary)] md:border-2 md:border-[var(--primary)] shadow-2xl overflow-hidden transition-colors duration-200 ${
          darkMode ? 'bg-[#141414] text-white' : 'bg-white text-[#0A0A0A]'
        }`}
      >
      <div
        ref={scrollerRef}
        role="dialog"
        aria-modal="true"
        dir={isAr ? 'rtl' : 'ltr'}
        aria-label={isAr ? 'سلة الطلبات وإتمام الشراء' : 'Order Checkout'}
        data-lenis-prevent
        className="overflow-y-auto overscroll-contain smooth-scroll-touch no-scrollbar flex-1 min-h-0 px-6 sm:px-8 pb-[max(2rem,env(safe-area-inset-bottom))] overflow-x-clip scroll-pb-32"
      >
        {/* Drag Pill Handle (Mobile only) */}
        <div
          className={`w-11 h-1.5 rounded-full mx-auto mt-3 mb-3 md:hidden ${
            darkMode ? 'bg-neutral-600' : 'bg-neutral-300'
          }`}
        />

        {/* Sticky header: title + close stay put while the lines scroll. */}
        <div
          className={`sticky top-0 z-10 -mx-6 sm:-mx-8 px-6 sm:px-8 pt-3 pb-3 flex justify-between items-center gap-3 border-b ${
            darkMode ? 'bg-[#141414] border-neutral-800' : 'bg-white border-neutral-200'
          }`}
        >
          <div>
            <h2 className={`text-lg sm:text-xl font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {isAr ? 'سلة طلبك' : 'Your Order'}
            </h2>
            <p className={`text-xs mt-0.5 font-medium ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
              <bdi dir="ltr" className="tabular-nums">{lines.length}</bdi> {isAr ? (lines.length === 1 ? 'صنف مختار' : lines.length === 2 ? 'صنفان مختاران' : 'أصناف مختارة') : 'items selected'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
              darkMode
                ? 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'
                : 'bg-neutral-100 text-neutral-700 hover:text-black hover:bg-neutral-200'
            }`}
            aria-label={isAr ? 'إغلاق' : 'Close'}
          >
            <X size={20} />
          </button>
        </div>

        {/* Order Prepared Confirmation Screen */}
        {orderPrepared ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 text-green-600 flex items-center justify-center mx-auto">
              <CheckCircle2 size={36} />
            </div>
            <h3 className={`text-xl font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {isAr ? 'تم استلام طلبك!' : 'Your order is in!'}
            </h3>
            <p className={`text-sm max-w-xs mx-auto leading-relaxed ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
              {isAr
                ? 'تتبع الطلب لحظة بلحظة من الأسفل — سنعلمك بكل تحديث.'
                : 'Track your order live below — we’ll ping you on every update.'}
            </p>
            {/* Send-failure honesty (plan §7): a DB/transport failure must
                never look like a clean success — the cause shows HERE on the
                confirmation screen, not just in the (now replaced) form. */}
            {errorMsg && (
              <p role="alert" className={`text-xs max-w-xs mx-auto leading-relaxed rounded-xl border px-3 py-2 ${darkMode ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-amber-600/40 bg-amber-100 text-amber-900'}`}>
                {errorMsg}
              </p>
            )}
            {/* Order loop: live tracking for THIS order (push opt-in lives
                on the tracking page, not here). */}
            {lastOrder && lastOrder.trackToken && (
              <div className="pt-1 flex flex-col gap-2.5 max-w-xs mx-auto w-full">
                <a
                  href={`/?track=${lastOrder.number}&t=${lastOrder.trackToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-tactile h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-bold text-sm inline-flex items-center justify-center gap-2 shadow-md hover:brightness-110"
                >
                  <span className="tabular-nums" dir="ltr">#{lastOrder.number}</span>
                  <span>{isAr ? 'تتبع الطلب لحظة بلحظة' : 'Track your order live'}</span>
                </a>
              </div>
            )}
            {customer.email && customer.email.trim() && (
              <p className={`text-xs max-w-xs mx-auto leading-relaxed ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                {isAr ? 'سنرسل تحديثات طلبك إلى بريدك.' : 'We’ll send your order updates to your email.'}
              </p>
            )}
          </div>
        ) : lines.length === 0 ? (
          <div className="py-12 text-center">
            <p className={`text-sm font-semibold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {isAr ? 'سلتك فارغة حاليًا' : 'Your cart is empty'}
            </p>
          </div>
        ) : (
          <div className="cart-stagger space-y-5 mt-4">
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
                distanceWarning={distanceWarning}
                lang={lang}
              darkMode={darkMode}
              onOpenLocSheet={() => setLocSheetOpen(true)}
              onClearLocation={clearLocation}
              isMember={!!account.user}
              hasDefaultAddress={!account.loading && !!account.profile?.address && customer.address.trim() === account.profile.address.trim()}
              phoneDial={phoneDial}
            />

            {/* Payment method (COD preselected + locked; future gateways
                show as disabled "soon" chips). Sits between the customer
                form and the bill so the total reads as "pay this on delivery". */}
            <PaymentMethodSection
              lang={lang}
              darkMode={darkMode}
              codEnabled={(menu.settings as { payments?: { codEnabled?: boolean } }).payments?.codEnabled !== false}
              isMember={!!account.user}
              profileIncomplete={profileIncomplete}
              accountLoading={account.loading}
              onRequireAccount={onRequireAccount}
              onCompleteProfile={onRequireProfile}
            />

            {/* Error + Bill Summary */}
            <OrderSummaryLines
              errorMsg={errorMsg}
              lines={lines}
              menu={menu}
              subtotal={subtotal}
              deliveryFee={deliveryFee}
              feeDetail={feeDetail}
              feeFreeApplied={feeFreeApplied}
              grandTotal={grandTotal}
              feeActive={feeActive}
              isBelowMin={isBelowMin}
              minOrder={minOrder}
              currency={currency}
              lang={lang}
              darkMode={darkMode}
            />

            {/* Delivery-zone hard block: pin outside served zones (delivery
                only; pickup/dinein unaffected). Sits right above the send
                button so the reason + WhatsApp CTA are unmissable. */}
            {zoneBlocked && (
              <ZoneBlockedPanel
                lang={lang}
                darkMode={darkMode}
                whatsapp={menu.settings.whatsapp || ''}
                placeName={zonePlaceName}
                onChangeLocation={() => setLocSheetOpen(true)}
              />
            )}

            {/* Action bar in normal flow: scrolls with the bill, found
                at the end — no floating bar covering content. */}
            <div className={`mt-2 border-t pt-3 ${
              darkMode ? 'border-neutral-800' : 'border-neutral-200'
            }`}>
              {/* Availability + Action Buttons */}
              <CartCheckoutFooter
                orderBlocked={orderBlocked}
                blockedMsg={blockedMsg}
                reopenText={reopenText}
                lang={lang}
                darkMode={darkMode}
                sending={sending}
                sendLocked={zoneBlocked}
                onSend={() => void handleSendOrder()}
                onClearCart={handleClearCartWithLocation}
              />

              {/* Bottom Close — same contract as the item sheet: keep
                  shopping without touching the cart contents. */}
              <button
                type="button"
                onClick={onClose}
                className={`btn-tactile w-full h-11 min-h-[44px] mt-2 rounded-full border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                  darkMode
                    ? 'border-neutral-700 text-neutral-300 hover:bg-white/5'
                    : 'border-neutral-300 text-neutral-700 hover:bg-black/5'
                }`}
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </div>
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
