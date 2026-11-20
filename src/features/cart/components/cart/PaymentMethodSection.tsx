import React from 'react';
import { Banknote, Check, ChevronRight, ShieldCheck, UserRound } from 'lucide-react';

interface PaymentMethodSectionProps {
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** Admin setting — COD master switch. Missing/old menus read as on. */
  codEnabled?: boolean;
  /** Signed-in member: COD is allowed and the order links automatically. */
  isMember?: boolean;
  /** Member account is missing the mandatory phone/address/pin. */
  profileIncomplete?: boolean;
  /** Session/profile still loading — show a neutral checking state. */
  accountLoading?: boolean;
  /** Opens the signup sheet without losing the cart. */
  onRequireAccount?: () => void;
  /** Opens account settings over the cart so the profile can be completed. */
  onCompleteProfile?: () => void;
}

interface AccountNoticeProps {
  darkMode: boolean;
  title: string;
  body: string;
  onClick?: () => void;
}

/**
 * Compact in-card account prompt.
 *
 * Sits INSIDE the selected COD card on a neutral, elevated surface — the old
 * amber-on-amber block muddied the gold selection and read like an error.
 * One line of title, one line of why, one short CTA.
 */
const AccountNotice: React.FC<AccountNoticeProps> = ({ darkMode, title, body, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group mt-3 flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 min-h-[52px] text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
      darkMode
        ? 'border-white/10 bg-black/30 hover:bg-black/40'
        : 'border-black/[0.06] bg-white/80 shadow-[0_1px_2px_rgba(10,10,10,0.03)] hover:bg-white'
    }`}
  >
    <span
      className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
        darkMode ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--primary)]/15 text-[#7a5d00]'
      }`}
      aria-hidden="true"
    >
      <UserRound size={14} />
    </span>
    <span className="min-w-0 flex-1">
      <span className={`block text-[12px] font-extrabold leading-tight ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
        {title}
      </span>
      <span className={`mt-0.5 block text-[11px] leading-snug ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
        {body}
      </span>
    </span>
    <span
      aria-hidden="true"
      className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-transform duration-200 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 ${
        darkMode ? 'bg-[var(--primary)] text-[#0A0A0A]' : 'bg-[#0A0A0A] text-[var(--primary)]'
      }`}
    >
      <ChevronRight size={14} strokeWidth={2.6} className="rtl:rotate-180" />
    </span>
  </button>
);

/** Neutral skeleton while the session/profile check is in flight. */
const AccountSkeleton: React.FC<{ darkMode: boolean; label: string }> = ({ darkMode, label }) => (
  <div
    role="status"
    className={`mt-3 flex items-center gap-2.5 rounded-xl border px-2.5 py-2.5 ${
      darkMode ? 'border-white/10 bg-black/20' : 'border-black/[0.06] bg-white/60'
    }`}
  >
    <span className="sr-only">{label}</span>
    <span
      aria-hidden="true"
      className={`shrink-0 w-8 h-8 rounded-lg animate-pulse ${darkMode ? 'bg-white/10' : 'bg-black/[0.06]'}`}
    />
    <span aria-hidden="true" className="min-w-0 flex-1 space-y-1.5">
      <span className={`block h-2.5 w-24 rounded-full animate-pulse ${darkMode ? 'bg-white/10' : 'bg-black/[0.06]'}`} />
      <span className={`block h-2 w-40 max-w-full rounded-full animate-pulse ${darkMode ? 'bg-white/[0.07]' : 'bg-black/[0.045]'}`} />
    </span>
  </div>
);

/**
 * Checkout payment step — Cash on Delivery is the ONLY live method.
 *
 * Cash on delivery requires a registered account (server-enforced). Guests
 * get an inline explanation + a one-tap "Create account" CTA in the same
 * section instead of a dead-end error. No card data is ever collected here.
 */
export const PaymentMethodSection: React.FC<PaymentMethodSectionProps> = ({
  lang,
  darkMode,
  codEnabled = true,
  isMember = false,
  profileIncomplete = false,
  accountLoading = false,
  onRequireAccount,
  onCompleteProfile,
}) => {
  const isAr = lang === 'ar';
  if (!codEnabled) return null;

  const checkingLabel = isAr ? 'جارٍ التحقق من حسابك…' : 'Checking your account…';

  return (
    <section
      aria-labelledby="payment-method-title"
      className={`rounded-2xl border p-4 sm:p-5 space-y-3.5 transition-colors ${
        darkMode
          ? 'bg-gradient-to-b from-[#1c1c1c] to-[#161616] border-neutral-800'
          : 'bg-gradient-to-b from-white to-neutral-50 border-neutral-200 shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="payment-method-title"
            className={`text-sm font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}
          >
            {isAr ? 'طريقة الدفع' : 'Payment method'}
          </h3>
          <p className={`mt-0.5 text-[11px] leading-relaxed ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
            {isAr ? 'ادفع عند استلام طلبك — بدون دفع مقدم.' : 'Pay when your order arrives — no upfront payment.'}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-extrabold ${
            darkMode
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-emerald-600/20 bg-emerald-50 text-emerald-700'
          }`}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {isAr ? 'آمن' : 'Secure'}
        </span>
      </div>

      <div role="radiogroup" aria-label={isAr ? 'طريقة الدفع' : 'Payment method'}>
        <div
          className={`relative overflow-hidden rounded-2xl border-2 p-4 transition-colors ${
            darkMode
              ? 'border-[var(--primary)]/70 bg-[var(--primary)]/[0.06]'
              : 'border-[var(--primary)] bg-gradient-to-br from-[var(--primary)]/[0.16] via-white to-white'
          }`}
        >
          <input
            type="radio"
            checked
            disabled
            readOnly
            aria-checked="true"
            aria-label={isAr ? 'الدفع عند الاستلام' : 'Cash on Delivery'}
            className="sr-only"
          />
          <span aria-hidden="true" className="absolute inset-y-0 start-0 w-1 bg-[var(--primary)]" />
          <div className="flex items-start gap-3">
            <span
              className={`shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center ${
                darkMode ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--primary)] text-[#0A0A0A]'
              }`}
            >
              <Banknote size={22} strokeWidth={2.25} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                  {isAr ? 'الدفع عند الاستلام' : 'Cash on Delivery'}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                    darkMode
                      ? 'bg-[var(--primary)] text-[#0A0A0A]'
                      : 'bg-[#0A0A0A] text-[var(--primary)]'
                  }`}
                >
                  {isAr ? 'محددة' : 'Selected'}
                </span>
              </div>
              <p className={`mt-1 text-xs leading-relaxed ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
                {isAr ? 'ادفع نقدًا عند استلام طلبك من المندوب.' : 'Pay cash to the courier when your order arrives.'}
              </p>
            </div>
            <span
              aria-hidden="true"
              className="shrink-0 w-6 h-6 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center"
            >
              <Check size={14} strokeWidth={3.2} />
            </span>
          </div>

          {/* Account requirement lives INSIDE the selected card — one compact
              surface instead of a second amber panel stacked under it. */}
          {accountLoading ? (
            <AccountSkeleton darkMode={darkMode} label={checkingLabel} />
          ) : profileIncomplete ? (
            <AccountNotice
              darkMode={darkMode}
              title={isAr ? 'أكمل بياناتك' : 'Complete your profile'}
              body={isAr ? 'أضف هاتفك وعنوانك للمتابعة.' : 'Add phone and address to continue.'}
              onClick={onCompleteProfile}
            />
          ) : !isMember ? (
            <AccountNotice
              darkMode={darkMode}
              title={isAr ? 'أنشئ حسابًا' : 'Create an account'}
              body={isAr ? 'مطلوب لإتمام الطلب ومتابعته.' : 'Required to place & track this order.'}
              onClick={onRequireAccount}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
};
