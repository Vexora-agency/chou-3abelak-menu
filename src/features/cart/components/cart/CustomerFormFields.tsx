import React, { useState } from 'react';
import { CustomerDetails } from '@/src/types/menu';
import { cleanPhoneInput } from '@/src/utils/digits';
import { MapPin, Navigation, UserRound, X } from 'lucide-react';

interface CustomerFormFieldsProps {
  customer: CustomerDetails;
  setCustomer: React.Dispatch<React.SetStateAction<CustomerDetails>>;
  honeypot: string;
  setHoneypot: React.Dispatch<React.SetStateAction<string>>;
  location: { lat: number; lng: number; accuracy: number } | null;
  distanceText: string | null;
  distanceWarning: string | null;
  feeHint?: string | null;
  feeFreeApplied?: boolean;
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** Signed-in members already have their email on every linked order. */
  isMember?: boolean;
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
  feeHint,
  feeFreeApplied,
  lang,
  darkMode,
  isMember = false,
  onOpenLocSheet,
  onClearLocation,
}) => {
  const isAr = lang === 'ar';
  const [emailOpen, setEmailOpen] = useState(() => !!(customer.email && customer.email.trim()));
  return (
    <div className="space-y-3">
      {isMember && (
        <p className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-bold leading-relaxed ${
          darkMode
            ? 'border-[var(--primary)]/25 bg-[var(--primary)]/[0.06] text-neutral-300'
            : 'border-amber-300 bg-amber-50 text-neutral-700'
        }`}>
          <UserRound size={14} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <span>
            {isAr
              ? 'اسمك وهاتفك وبريدك الإلكتروني تُؤخذ من حسابك تلقائيًا. العنوان الافتراضي والموقع مُعبّآن مسبقًا، ويمكنك تعديلهما لهذا الطلب.'
              : 'Your name, phone and email come from your account automatically. The default address and pin are filled in and can be changed for this order.'}
          </span>
        </p>
      )}
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
          readOnly={isMember}
          aria-readonly={isMember || undefined}
          className={`w-full h-11 px-3.5 rounded-xl border text-base focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
            isMember ? 'opacity-80 cursor-not-allowed' : ''
          } ${
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
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={customer.phone} dir="ltr"
          onChange={(e) => setCustomer({ ...customer, phone: cleanPhoneInput(e.target.value) })}
          placeholder={isAr ? 'مثال: 70123456' : '+961 70 123 456'}
          maxLength={20}
          enterKeyHint="next"
          readOnly={isMember}
          aria-readonly={isMember || undefined}
          className={`w-full h-11 px-3.5 rounded-xl border text-base tabular-nums ${isAr ? 'text-end' : 'text-start'} focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
            isMember ? 'opacity-80 cursor-not-allowed' : ''
          } ${
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
          {isAr ? 'عنوان التوصيل بالتفصيل *' : 'Delivery Address *'}
        </label>
        <div className="relative">
          <input
            type="text"
            value={customer.address} dir={isAr ? 'rtl' : 'ltr'}
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
            className={`w-full h-11 px-3.5 pe-12 rounded-xl border text-base focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
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
              className={`absolute end-0.5 top-1/2 -translate-y-1/2 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                darkMode
                  ? 'text-[var(--primary)] hover:bg-[var(--primary)]/10'
                  : 'text-[#8a6d00] hover:bg-[var(--primary)]/15'
              }`}
            >
              <MapPin size={20} />
            </button>
          )}
        </div>
        <p className={`mt-1 text-[11px] ${darkMode ? 'text-neutral-500' : 'text-neutral-400'}`}>
          {location
            ? (isAr ? 'يُكتب مع كل طلب ولا يُحفظ على هذا الجهاز.' : 'Entered fresh each order — never saved on this device.')
            : (isAr ? 'اضغط على أيقونة الموقع لتحديد عنوانك بدقة وسهولة — أو اكتبه يدويًا.' : 'Tap the location icon to pin your address quickly and accurately — or type it manually.')}
        </p>
        {location && (
          <div className={`mt-1.5 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs font-bold ${darkMode ? 'text-green-400' : 'text-green-700'}`}>
            <MapPin size={13} className="shrink-0" />
            <span className="flex-1 min-w-0 basis-0 truncate" dir="auto">
                {isAr
                  ? `تم تحديد الموقع${distanceText ? ` · على بعد ${distanceText} من المطعم` : ''}${feeHint && !feeFreeApplied ? ` · ${feeHint}` : ''}`
                  : `Location pinned${distanceText ? ` · ${distanceText} from our location` : ''}${feeHint && !feeFreeApplied ? ` · ${feeHint}` : ''}`}
            </span>
            {feeFreeApplied && feeHint && (
              <span className="shrink-0 basis-full text-green-500 font-black" dir="auto">🎉 {feeHint}</span>
            )}
            <a
              href={`https://www.google.com/maps?q=${location.lat},${location.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 underline underline-offset-4 hover:text-[var(--primary)] inline-flex items-center min-h-[44px] px-1"
            >
              {isAr ? 'الخريطة' : 'Maps'}
            </a>
            {location.accuracy > 500 && (
              <span className="shrink-0 text-amber-500">
                {isAr ? 'تقريبي — اكتب العنوان أيضًا' : 'Rough — also write the address'}
              </span>
            )}
            {distanceWarning && (
              <span className="shrink-0 basis-full text-amber-500" dir="auto">{distanceWarning}</span>
            )}
            <span className="flex gap-2 shrink-0 ms-auto">
              <button
                type="button"
                onClick={onOpenLocSheet}
                aria-label={isAr ? 'إعادة تحديد الموقع' : 'Re-pin location'}
                title={isAr ? 'إعادة تحديد الموقع' : 'Re-pin location'}
                className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-neutral-700 text-neutral-300' : 'border-neutral-300 text-neutral-600'}`}
              >
                <Navigation size={16} />
              </button>
              <button
                type="button"
                onClick={onClearLocation}
                aria-label={isAr ? 'إزالة الموقع' : 'Remove location'}
                title={isAr ? 'إزالة الموقع' : 'Remove location'}
                className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? 'text-neutral-400 hover:text-red-400' : 'text-neutral-500 hover:text-red-600'}`}
              >
                <X size={16} />
              </button>
            </span>
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
      <div className="rounded-xl border border-[var(--primary)] bg-[var(--primary)] text-[#0A0A0A]">
        <button
          type="button"
          onClick={() => setEmailOpen((v) => !v)}
          aria-expanded={emailOpen}
          className="w-full flex items-center justify-between gap-3 text-start min-h-[44px] px-3.5 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] text-[#0A0A0A]"
        >
          <span className="min-w-0">
            <span className="block text-xs font-black">
              {isAr ? 'يُنصح بإضافة البريد الإلكتروني' : 'Email recommended'}
            </span>
            <span className="block text-[11px] mt-0.5 font-bold text-black/70">
              {isAr ? 'لتوصلك تحديثات طلبك لحظة بلحظة.' : 'To receive instant updates about your order.'}
            </span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-lg leading-none transition-transform duration-200 text-[#0A0A0A]">
            <span className={`inline-block transition-transform duration-200 ${emailOpen ? 'rotate-180' : ''}`}>▾</span>
          </span>
        </button>
        {emailOpen && (
          <div className="px-3.5 pb-3.5 anim-fade-in">
            <label className="block text-xs font-bold mb-1 text-[#0A0A0A]">
              {isAr ? 'البريد الإلكتروني (اختياري)' : 'Email (optional)'}
            </label>
            <input
              type="email"
              inputMode="email"
              dir="ltr"
              value={customer.email ?? ''}
              onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
              placeholder="name@example.com"
              maxLength={254}
              autoComplete="email"
              enterKeyHint="done"
              className={`w-full h-11 px-3.5 rounded-xl border border-black/20 bg-white text-[#0A0A0A] placeholder-neutral-500 text-base ${isAr ? 'text-end' : 'text-start'} shadow-xs focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] transition-colors`}
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

      {!isMember && (
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
      )}
    </div>
  );
};
