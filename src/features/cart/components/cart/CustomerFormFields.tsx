import React, { useState } from 'react';
import { CustomerDetails } from '@/src/types/menu';
import { cleanPhoneInput, phoneDigitsOnly } from '@/src/utils/digits';
import {
  checkPhone,
  composeNational,
  isDifferentAccountPhone,
  isForeignNumber,
  isInternationalInput,
  nationalPart,
  type DialCountry,
} from '@/src/utils/phoneCountry';
import { AlertTriangle, BadgeCheck, ChevronDown, Eye, Mail, Map, MapPin, Phone, ShieldCheck, X } from 'lucide-react';
import { PHONE_VERIFY_STR } from '@/src/features/auth';

interface CustomerFormFieldsProps {
  customer: CustomerDetails;
  setCustomer: React.Dispatch<React.SetStateAction<CustomerDetails>>;
  honeypot: string;
  setHoneypot: React.Dispatch<React.SetStateAction<string>>;
  location: { lat: number; lng: number; accuracy: number } | null;
  distanceText: string | null;
  distanceWarning: string | null;
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** Signed-in members already have their email on every linked order. */
  isMember?: boolean;
  /** Restaurant country from the admin WhatsApp picker (phone gate). */
  phoneDial?: DialCountry;
  /** Member's saved account number (reset baseline in the cart). */
  accountPhone?: string | null;
  /** True only when the number currently typed is verified. */
  phoneVerified?: boolean;
  /** Reverse-WhatsApp state for the typed number (members only). */
  phoneVerificationPhase?: 'idle' | 'checking' | 'unverified' | 'pending' | 'verified' | 'error';
  /** Opens the code sheet for the typed number. */
  onVerifyPhone?: () => void;
  onOpenLocSheet: () => void;
  onClearLocation: () => void;
}

export const CustomerFormFields: React.FC<CustomerFormFieldsProps> = ({
  customer,
  setCustomer,
  honeypot,
  setHoneypot,
  location,
  distanceText,
  distanceWarning,
  lang,
  darkMode,
  isMember = false,
  phoneDial,
  accountPhone,
  phoneVerified = false,
  phoneVerificationPhase,
  onVerifyPhone,
  onOpenLocSheet,
  onClearLocation,
}) => {
  const isAr = lang === 'ar';
  const pv = PHONE_VERIFY_STR[lang];
  const [emailOpen, setEmailOpen] = useState(() => !!(customer.email && customer.email.trim()));
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const dial: DialCountry = phoneDial ?? { iso: '', code: '' };
  const phoneForeign = isForeignNumber(customer.phone, dial.code);
  const phoneDisplay = phoneForeign
    ? customer.phone
    : dial.code
      ? nationalPart(customer.phone, dial.code)
      : customer.phone;
  // Both fields are editable for members: the name is the recipient for this
  // order, and EVERY phone number — the saved one, a changed one, or the
  // first one — must be confirmed through reverse WhatsApp verification.
  const phoneLinked = isMember && customer.phone.trim().length > 0;
  const phoneChanged = isMember
    && isDifferentAccountPhone(customer.phone, accountPhone, dial.code);
  const phoneCheck = checkPhone(customer.phone, dial.code);
  const phoneValid = phoneCheck.ok;
  const showVerified = !!(isMember && phoneValid && !phoneForeign && phoneVerified);
  const verifyPending = phoneVerificationPhase === 'pending';
  const showVerify = !!(isMember && phoneValid && !phoneForeign && !showVerified
    && phoneVerificationPhase !== 'checking' && onVerifyPhone);
  const phoneErrorText = phoneError || (phoneForeign
    ? (isMember
      ? (isAr
        ? `الرقم المحفوظ في حسابك ليس من +${dial.code}. حدّثه من الإعدادات.`
        : `Your saved number isn’t a +${dial.code} number. Update it in Account → Settings.`)
      : (isAr
        ? `هذا الرقم غير مدعوم. امسح الحقل وأدخل رقمًا من +${dial.code}.`
        : `This number isn’t supported. Clear the field and enter a +${dial.code} number.`))
    : null);
  const phoneNoteText = phoneErrorText
    || (showVerified
      ? (isAr ? 'تم تأكيد الرقم.' : 'Number verified.')
      : null)
    || (showVerify
      ? (verifyPending
        ? (isAr ? 'الرمز جاهز.' : 'Code ready.')
        : (isAr ? 'أكّد هذا الرقم عبر واتساب قبل إرسال الطلب.' : 'Verify this number on WhatsApp before ordering.'))
      : null)
    || (phoneLinked
      ? null
      : dial.code
        ? (isAr ? `نقبل أرقام +${dial.code} فقط.` : `Only +${dial.code} numbers are accepted.`)
        : (isAr ? 'أدخل رقم الهاتف مع رمز الدولة.' : 'Enter the phone number with its country code.'));
  const phoneNoteVisible = !!phoneNoteText;
  const phoneNoteTone = phoneErrorText
    ? 'text-red-500'
    : showVerified
      ? (darkMode ? 'text-emerald-400' : 'text-emerald-700')
      : showVerify
        ? (darkMode ? 'text-amber-300' : 'text-amber-700')
        : darkMode ? 'text-neutral-500' : 'text-neutral-400';

  const onPhoneChange = (raw: string) => {
    if (!dial.code) {
      setPhoneError(null);
      setCustomer({ ...customer, phone: cleanPhoneInput(raw) });
      return;
    }
    if (isInternationalInput(raw)) {
      const check = checkPhone(raw, dial.code);
      if (!check.ok) {
        setPhoneError(check.reason === 'country'
          ? (isAr
            ? `الرقم غير مدعوم. نقبل أرقام +${dial.code} فقط.`
            : `This number isn’t supported. Use a +${dial.code} number.`)
          : (isAr
            ? 'رقم الهاتف يجب أن يكون من 6 إلى 15 رقمًا'
            : 'Phone must be 6–15 digits'));
        // Clear the controlled field when a foreign paste is rejected: keeping
        // an old valid number under a country error looked like the old number
        // was the invalid one.
        setCustomer({ ...customer, phone: '' });
        return;
      }
      setPhoneError(null);
      setCustomer({ ...customer, phone: check.normalized });
      return;
    }
    setPhoneError(null);
    setCustomer({ ...customer, phone: composeNational(phoneDigitsOnly(raw), dial.code) });
  };
  return (
    <div className="space-y-3">
      <div>
        <label className={`block text-xs font-bold mb-1 ${
          darkMode ? 'text-neutral-200' : 'text-neutral-800'
        }`}>
          {isAr ? 'الاسم *' : 'Your Name *'}
        </label>
        <input
          type="text"
          value={customer.name} dir={isAr ? 'rtl' : 'ltr'}
          onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
          placeholder={isAr ? 'اسمك' : 'Your name'}
          maxLength={40}
          autoComplete="name"
          className={`w-full h-11 px-3.5 rounded-xl border text-base focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
            darkMode
              ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-400'
              : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-500 shadow-xs'
          }`}
        />
      </div>

      <div>
        <label className={`block text-xs font-bold mb-1 ${
          darkMode ? 'text-neutral-200' : 'text-neutral-800'
        }`}>
          {isAr ? 'رقم الهاتف *' : 'Phone Number *'}
        </label>
        <div className="relative flex" dir="ltr">
          {dial.code && !phoneForeign && (
            <span
              className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-s-xl border border-e-0 px-3 text-sm font-extrabold tabular-nums ${
                darkMode
                  ? 'bg-[#181818] border-neutral-700 text-[var(--primary)]'
                  : 'bg-neutral-50 border-neutral-300 text-[#7a5d00]'
              }`}
            >
              <Phone size={13} className="opacity-70" aria-hidden="true" />
              +{dial.code}
            </span>
          )}
          <input
            type="tel"
            inputMode="tel"
            autoComplete={dial.code ? 'tel-national' : 'tel'}
            value={phoneDisplay}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder={dial.code ? '70 123 456' : '+961 70 123 456'}
            maxLength={20}
            enterKeyHint="next"
            aria-invalid={phoneErrorText ? true : undefined}
            aria-describedby={phoneNoteVisible ? 'cart-phone-note' : undefined}
            className={`min-w-0 flex-1 h-11 ps-3.5 border text-base tabular-nums text-start focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
              showVerify ? 'pe-28' : 'pe-3.5'
            } ${
              dial.code && !phoneForeign ? 'rounded-e-xl rounded-s-none' : 'rounded-xl'
            } ${
              phoneErrorText ? 'border-red-500/60' : darkMode ? 'border-neutral-700' : 'border-neutral-300'
            } ${
              darkMode
                ? 'bg-[#181818] text-white placeholder-neutral-400'
                : 'bg-white text-[#0A0A0A] placeholder-neutral-500 shadow-xs'
            }`}
          />
          {showVerify && onVerifyPhone && (
            <button
              type="button"
              onClick={onVerifyPhone}
              className={`absolute end-1.5 top-1/2 -translate-y-1/2 inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-extrabold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] after:absolute after:-inset-2 after:content-[""] ${
                darkMode
                  ? 'border-[var(--primary)]/40 bg-[#181818] text-[var(--primary)]'
                  : 'border-[#8a6d00]/40 bg-white text-[#8a6d00]'
              }`}
            >
              {verifyPending
                ? <Eye size={13} aria-hidden="true" />
                : <ShieldCheck size={13} aria-hidden="true" />}
              {verifyPending ? pv.viewCode : pv.verifyShort}
            </button>
          )}
        </div>
        {phoneNoteVisible && (
          <p
            id="cart-phone-note"
            className={`mt-1 text-[10.5px] font-semibold leading-relaxed ${phoneNoteTone}`}
            role={phoneErrorText ? 'alert' : undefined}
          >
            {showVerified ? (
              <BadgeCheck size={12} className="me-1 -mt-0.5 inline-block align-middle" aria-hidden="true" />
            ) : showVerify || phoneChanged ? (
              <ShieldCheck size={12} className="me-1 -mt-0.5 inline-block align-middle" aria-hidden="true" />
            ) : null}
            {phoneNoteText}
            {phoneChanged && accountPhone && (
              <button
                type="button"
                onClick={() => setCustomer({ ...customer, phone: accountPhone })}
                className="ms-1.5 underline underline-offset-2 font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded-sm"
              >
                {isAr ? 'استخدم رقم حسابي' : 'Use my account number'}
              </button>
            )}
          </p>
        )}
      </div>

      <div>
        <label className={`block text-xs font-bold mb-1 ${
          darkMode ? 'text-neutral-200' : 'text-neutral-800'
        }`}>
          {isAr ? 'عنوان التوصيل بالتفصيل *' : 'Delivery Address *'}
        </label>
        <div className="relative">
          <input
            type="text"
            value={customer.address} dir="auto"
            onChange={(e) => {
              // Typing refines the address but keeps the pin: a picked point
              // plus a detailed address (building, floor, landmark) is the
              // best pair for the driver. The pin is removed only via its
              // explicit X button.
              setCustomer({ ...customer, address: e.target.value });
            }}
            placeholder={isAr ? 'اكتب عنوانك هنا أو حدّده على الخريطة' : 'Type your address here, or pin it on the map'}
            maxLength={200}
            autoComplete="street-address"
            enterKeyHint="next"
            className={`w-full h-11 pl-3.5 pr-12 rounded-xl border text-base focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
              darkMode
                ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-400'
                : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-500 shadow-xs'
            }`}
          />
          {!location && (
            <button
              type="button"
              onClick={onOpenLocSheet}
              title={isAr ? 'افتح الخريطة لتحديد موقعك (اختياري ويساعد السائق)' : 'Open the map to pin your location (optional, helps the driver)'}
              aria-label={isAr ? 'افتح الخريطة لتحديد موقعك (اختياري ويساعد السائق)' : 'Open the map to pin your location (optional, helps the driver)'}
              className={`absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                darkMode
                  ? 'text-[var(--primary)] hover:bg-[var(--primary)]/10'
                  : 'text-[#8a6d00] hover:bg-[var(--primary)]/15'
              }`}
            >
              <MapPin size={20} />
            </button>
          )}
        </div>
        {location && (
          <div className={`mt-2 rounded-2xl border p-2.5 ${darkMode ? 'border-emerald-400/25 bg-emerald-400/[0.06]' : 'border-emerald-200 bg-emerald-50/80'}`}>
            <div className="flex items-start gap-2.5">
              <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${darkMode ? 'bg-emerald-500 text-white shadow-sm' : 'bg-emerald-600 text-white shadow-sm'}`}>
                <MapPin size={16} strokeWidth={2.4} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                {distanceText && (
                  <p className={`text-[11px] font-bold leading-snug ${darkMode ? 'text-emerald-300/80' : 'text-emerald-700'}`}>
                    {isAr ? `${distanceText} عن المطعم` : `${distanceText} away`}
                  </p>
                )}
                {location.accuracy > 500 && (
                  <p className={`mt-1 flex items-start gap-1 text-[10.5px] font-semibold leading-snug ${darkMode ? 'text-amber-300/90' : 'text-amber-700'}`}>
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{isAr ? 'الدبوس تقريبي — أضف تفاصيل العنوان' : 'Approximate pin — add address details'}</span>
                  </p>
                )}
                {distanceWarning && (
                  <p className={`mt-1 flex items-start gap-1 text-[10.5px] font-semibold leading-snug ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span dir="auto">{distanceWarning}</span>
                  </p>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-1 self-center">
                <button
                  type="button"
                  onClick={onOpenLocSheet}
                  aria-label={isAr ? 'تعديل الموقع على الخريطة' : 'Edit location on the map'}
                  title={isAr ? 'تعديل الموقع على الخريطة' : 'Edit location on the map'}
                  className={`inline-flex items-center justify-center gap-1.5 h-9 min-h-[44px] px-3 rounded-full border text-[11px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-emerald-400/30 text-emerald-100 hover:bg-emerald-400/10' : 'border-emerald-300 bg-white/70 text-emerald-800 hover:bg-white'}`}
                >
                  <Map size={13} strokeWidth={2.4} aria-hidden="true" />
                  <span className="hidden min-[360px]:inline">{isAr ? 'الخريطة' : 'Map'}</span>
                </button>
                <button
                  type="button"
                  onClick={onClearLocation}
                  aria-label={isAr ? 'إزالة الموقع' : 'Remove location'}
                  title={isAr ? 'إزالة الموقع' : 'Remove location'}
                  className={`w-9 h-9 min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? 'border-white/10 bg-white/[0.02] text-neutral-300 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-400' : 'border-neutral-200 bg-white/70 text-neutral-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600'}`}
                >
                  <X size={15} strokeWidth={2.6} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <label className={`block text-xs font-bold mb-1 ${
          darkMode ? 'text-neutral-200' : 'text-neutral-800'
        }`}>
          {isAr ? 'ملاحظات إضافية (اختياري)' : 'Special Instructions (optional)'}
        </label>
        <input
          type="text"
          value={customer.notes} dir={isAr ? 'rtl' : 'ltr'}
          onChange={(e) => setCustomer({ ...customer, notes: e.target.value })}
          placeholder={isAr ? 'بدون بصل، صوص إضافي...' : 'No onions, extra sauce...'}
          maxLength={200}
          enterKeyHint="done"
          className={`w-full h-11 px-3.5 rounded-xl border text-base focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
            darkMode
              ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-400'
              : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-500 shadow-xs'
          }`}
        />
      </div>

      {/* Order-status email: RECOMMENDED (still optional). Hidden for
          registered members — their account email already rides with every
          linked order, so asking again is noise. */}
      {!isMember && (
        <div className={`rounded-2xl border transition-colors duration-300 ${
        darkMode
          ? 'border-white/10 bg-[#171717]'
          : 'border-neutral-200/90 bg-white shadow-[0_1px_2px_rgba(10,10,10,0.04)]'
      }`}>
        <button
          type="button"
          onClick={() => setEmailOpen((v) => !v)}
          aria-expanded={emailOpen}
          aria-controls="cart-email-panel"
          className={`w-full flex items-center gap-3 text-start min-h-[56px] px-3 py-2.5 rounded-2xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
            darkMode ? 'hover:bg-white/[0.03]' : 'hover:bg-neutral-50'
          }`}
        >
          <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
            darkMode ? 'bg-[var(--primary)]/[0.12] text-[var(--primary)]' : 'bg-[var(--primary)]/15 text-[#7a5d00]'
          }`}>
            <Mail size={16} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className={`truncate text-[13px] font-extrabold ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                {isAr ? 'تحديثات البريد' : 'Email updates'}
              </span>
              <span className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-black ${
                isAr ? '' : 'uppercase tracking-[0.08em]'
              } ${
                darkMode ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--primary)]/[0.18] text-[#7a5d00]'
              }`}>
                {isAr ? 'مُستحسن' : 'Recommended'}
              </span>
            </span>
            <span className={`mt-0.5 block truncate text-[11px] font-semibold ${
              darkMode ? 'text-neutral-400' : 'text-neutral-500'
            }`}>
              {isAr ? 'تحديثات فورية للطلب.' : 'Instant order updates.'}
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-300 ${
              emailOpen ? 'rotate-180' : ''
            } ${darkMode ? 'text-neutral-500' : 'text-neutral-400'}`}
          />
        </button>
        {emailOpen && (
          <div id="cart-email-panel" className="px-3 pb-3 anim-fade-in">
            <label
              htmlFor="cart-email-input"
              className={`mb-1 block text-[10px] font-extrabold ${
                isAr ? '' : 'uppercase tracking-[0.08em]'
              } ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}
            >
              {isAr ? 'البريد الإلكتروني' : 'Email address'}
            </label>
            <input
              id="cart-email-input"
              type="email"
              inputMode="email"
              dir="ltr"
              value={customer.email ?? ''}
              onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
              placeholder="name@example.com"
              maxLength={254}
              autoComplete="email"
              enterKeyHint="done"
              className={`w-full h-11 px-3.5 rounded-xl border text-start text-base transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${
                darkMode
                  ? 'border-neutral-700 bg-[#111111] text-white placeholder-neutral-500'
                  : 'border-neutral-200 bg-neutral-50/60 text-[#0A0A0A] placeholder-neutral-400'
              }`}
            />
          </div>
        )}
      </div>
      )}

      {/* Honeypot: invisible to real users, bots fill it and get a fake success */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>

      <div className="flex items-center gap-3 pt-1 min-h-[44px]">
        <input
          id="remember-details"
          type="checkbox"
          checked={customer.remember}
          onChange={(e) => setCustomer({ ...customer, remember: e.target.checked })}
          className="w-6 h-6 shrink-0 rounded text-[var(--primary)] focus:ring-[var(--primary)]"
        />
        <label
          htmlFor="remember-details"
          className={`text-sm py-2 flex-1 select-none cursor-pointer font-bold ${
            darkMode ? 'text-neutral-300' : 'text-neutral-700'
          }`}
        >
          {isAr ? 'تذكر بياناتي على هذا الجهاز' : 'Remember my details on this device'}
        </label>
      </div>
    </div>
  );
};
