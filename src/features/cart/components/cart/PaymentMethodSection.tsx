import React from 'react';
import { Banknote, CheckCircle2 } from 'lucide-react';

interface PaymentMethodSectionProps {
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** Admin setting — COD master switch. Missing/old menus read as on. */
  codEnabled?: boolean;
}

/**
 * Checkout payment step — Cash on Delivery is the ONLY live method.
 * It renders preselected + locked (the customer cannot pick anything else).
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

  return (
    <section
      aria-labelledby="payment-method-title"
      className={`rounded-2xl border p-4 space-y-3 transition-colors ${
        darkMode ? 'bg-[#1c1c1c] border-neutral-800' : 'bg-neutral-50 border-neutral-200'
      }`}
    >
      <h3
        id="payment-method-title"
        className={`text-sm font-black ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}
      >
        {isAr ? 'طريقة الدفع' : 'Payment method'}
      </h3>

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
            <span className={`block text-xs mt-0.5 leading-relaxed ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {isAr ? 'ادفع نقدًا عند الاستلام.' : 'Pay cash on delivery.'}
            </span>
          </span>
        </label>
      </div>
    </section>
  );
};
