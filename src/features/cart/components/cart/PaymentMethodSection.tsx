import React from 'react';
import { Banknote, CheckCircle2, CreditCard, Landmark, ShieldCheck, Wallet } from 'lucide-react';

interface PaymentMethodSectionProps {
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** Admin setting — COD master switch. Missing/old menus read as on. */
  codEnabled?: boolean;
}

/**
 * Checkout payment step — Cash on Delivery is the ONLY live method.
 * It renders preselected + locked (the customer cannot pick anything else),
 * with future online gateways shown as disabled "coming soon" chips so the
 * layout never jumps when Stripe/PayPal flip on.
 *
 * No card data is ever collected here (COD = no PAN/CVV, no storage).
 */
export const PaymentMethodSection: React.FC<PaymentMethodSectionProps> = ({
  lang,
  darkMode,
  codEnabled = true,
}) => {
  const isAr = lang === 'ar';
  if (!codEnabled) return null;

  const comingSoon = [
    { id: 'visa', label: isAr ? 'فيزا' : 'Visa', icon: CreditCard },
    { id: 'mastercard', label: isAr ? 'ماستركارد' : 'Mastercard', icon: CreditCard },
    { id: 'paypal', label: 'PayPal', icon: Wallet },
    { id: 'bank', label: isAr ? 'تحويل بنكي' : 'Bank transfer', icon: Landmark },
  ];

  return (
    <section
      aria-labelledby="payment-method-title"
      className={`rounded-2xl border p-4 space-y-3 transition-colors ${
        darkMode ? 'bg-[#1c1c1c] border-neutral-800' : 'bg-neutral-50 border-neutral-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="payment-method-title"
          className={`text-sm font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}
        >
          {isAr ? 'طريقة الدفع' : 'Payment method'}
        </h3>
        <span
          className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${
            darkMode
              ? 'border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]'
              : 'border-[#8a6d00]/30 bg-[var(--primary)]/15 text-[#6b5600]'
          }`}
        >
          {isAr ? 'الدفع عند الاستلام فقط' : 'COD only'}
        </span>
      </div>

      {/* The only live method — preselected + locked. role=radiogroup with a
          single checked + disabled radio: screen readers announce it as the
          chosen method, and the customer cannot pick anything else. */}
      <div role="radiogroup" aria-label={isAr ? 'طريقة الدفع' : 'Payment method'}>
        <label
          className={`relative flex items-start gap-3 rounded-2xl border-2 p-3.5 cursor-default transition-colors ${
            darkMode
              ? 'border-[var(--primary)] bg-[var(--primary)]/[0.07]'
              : 'border-[var(--primary)] bg-[var(--primary)]/10 shadow-xs'
          }`}
        >
          <input
            type="radio"
            checked
            disabled
            readOnly
            aria-checked="true"
            className="mt-1 w-5 h-5 shrink-0 accent-[var(--primary)] cursor-not-allowed"
          />
          <span
            className={`shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center ${
              darkMode ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--primary)] text-[#0A0A0A]'
            }`}
          >
            <Banknote size={22} strokeWidth={2.25} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`flex items-center gap-1.5 text-sm font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {isAr ? 'الدفع عند الاستلام' : 'Cash on Delivery'}
              <CheckCircle2 size={15} className="shrink-0 text-green-500" aria-hidden="true" />
            </span>
            <span className={`block text-xs mt-1 leading-relaxed ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {isAr
                ? 'ادفع نقدًا عند وصول طلبك — بدون بطاقات وبدون دفع مقدم.'
                : 'Pay in cash when your order arrives — no cards, no prepayment.'}
            </span>
            <span className={`mt-2 inline-flex items-center gap-1 text-[11px] font-bold ${darkMode ? 'text-neutral-500' : 'text-neutral-500'}`}>
              <ShieldCheck size={12} className="shrink-0 text-green-500" aria-hidden="true" />
              {isAr ? 'آمن 100% — لا نشارك أي بيانات بنكية' : '100% safe — no bank details shared'}
            </span>
          </span>
        </label>
      </div>

      {/* Future gateways: one compact row of the most important marks,
          disabled with a Soon badge — layout stays stable for activation. */}
      <div>
        <p className={`text-[11px] font-bold mb-2 ${darkMode ? 'text-neutral-500' : 'text-neutral-500'}`}>
          {isAr ? 'قريبًا — دفع إلكتروني آمن:' : 'Coming soon — secure online payment:'}
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5" style={{ scrollbarWidth: 'none' }}>
          {comingSoon.map((m) => {
            const Icon = m.icon;
            return (
              <span
                key={m.id}
                aria-disabled="true"
                title={isAr ? 'قريبًا' : 'Coming soon'}
                className={`shrink-0 inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border text-xs font-bold transition-colors ${
                  darkMode
                    ? 'border-neutral-800 bg-black/40 text-neutral-600'
                    : 'border-neutral-200 bg-white text-neutral-400'
                }`}
              >
                <Icon size={15} className="shrink-0 opacity-60" aria-hidden="true" />
                <span dir="auto">{m.label}</span>
                <span
                  className={`text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                    darkMode ? 'bg-neutral-800 text-neutral-500' : 'bg-neutral-100 text-neutral-500'
                  }`}
                >
                  {isAr ? 'قريبًا' : 'Soon'}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
};
