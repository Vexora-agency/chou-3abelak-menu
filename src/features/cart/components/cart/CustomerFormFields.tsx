import React from 'react';
import { CustomerDetails } from '@/src/types/menu';
import { MapPin, Navigation, X } from 'lucide-react';

interface CustomerFormFieldsProps {
  customer: CustomerDetails;
  setCustomer: React.Dispatch<React.SetStateAction<CustomerDetails>>;
  honeypot: string;
  setHoneypot: React.Dispatch<React.SetStateAction<string>>;
  location: { lat: number; lng: number; accuracy: number } | null;
  distanceText: string | null;
  lang: 'en' | 'ar';
  darkMode: boolean;
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
  lang,
  darkMode,
  onOpenLocSheet,
  onClearLocation,
}) => {
  const isAr = lang === 'ar';
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
          placeholder={isAr ? 'مثال: أحمد محمد' : 'e.g. John Doe'}
          maxLength={40}
          className={`w-full h-11 px-3.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
            darkMode
              ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-500'
              : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400 shadow-xs'
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
          value={customer.phone} dir={isAr ? 'rtl' : 'ltr'}
          onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
          placeholder={isAr ? 'مثال: 01012345678' : '+20 10 1234 5678'}
          maxLength={20}
          className={`w-full h-11 px-3.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
            darkMode
              ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-500'
              : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400 shadow-xs'
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
            onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
            placeholder={isAr ? 'المنطقة والشارع ورقم العمارة… أو حدد موقعك بالدبوس' : 'Area, street, building… or pin your location'}
            maxLength={200}
            className={`w-full h-11 px-3.5 pe-11 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
              darkMode
                ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-500'
                : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400 shadow-xs'
            }`}
          />
          {!location && (
            <button
              type="button"
              onClick={onOpenLocSheet}
              title={isAr ? 'افتح الخريطة لتحديد موقعك' : 'Open the map to pin your location'}
              aria-label={isAr ? 'افتح الخريطة لتحديد موقعك' : 'Open the map to pin your location'}
              className={`absolute end-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                darkMode
                  ? 'text-[var(--primary)] hover:bg-[var(--primary)]/10'
                  : 'text-[#8a6d00] hover:bg-[var(--primary)]/15'
              }`}
            >
              <MapPin size={17} />
            </button>
          )}
        </div>
        {location && (
          <div className={`mt-1.5 flex items-center gap-2 text-[11px] font-bold ${darkMode ? 'text-green-400' : 'text-green-700'}`}>
            <MapPin size={13} className="shrink-0" />
            <span className="truncate">
              {isAr
                ? `تم تحديد الموقع${distanceText ? ` · على بعد ${distanceText} من المطعم` : ''}`
                : `Location pinned${distanceText ? ` · ${distanceText} from restaurant` : ''}`}
            </span>
            <a
              href={`https://www.google.com/maps?q=${location.lat},${location.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 underline underline-offset-2 hover:text-[var(--primary)]"
            >
              {isAr ? 'الخريطة' : 'Maps'}
            </a>
            {location.accuracy > 500 && (
              <span className="shrink-0 text-amber-500">
                {isAr ? 'تقريبي — اكتب العنوان أيضاً' : 'Rough — also write the address'}
              </span>
            )}
            <span className="flex gap-1 shrink-0 ms-auto">
              <button
                type="button"
                onClick={onOpenLocSheet}
                aria-label={isAr ? 'إعادة تحديد الموقع' : 'Re-pin location'}
                title={isAr ? 'إعادة تحديد الموقع' : 'Re-pin location'}
                className={`w-7 h-7 rounded-full border flex items-center justify-center ${darkMode ? 'border-neutral-700 text-neutral-300' : 'border-neutral-300 text-neutral-600'}`}
              >
                <Navigation size={12} />
              </button>
              <button
                type="button"
                onClick={onClearLocation}
                aria-label={isAr ? 'إزالة الموقع' : 'Remove location'}
                title={isAr ? 'إزالة الموقع' : 'Remove location'}
                className={`w-7 h-7 rounded-full flex items-center justify-center ${darkMode ? 'text-neutral-400 hover:text-red-400' : 'text-neutral-500 hover:text-red-600'}`}
              >
                <X size={13} />
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
          className={`w-full h-11 px-3.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
            darkMode
              ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-500'
              : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400 shadow-xs'
          }`}
        />
      </div>

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

      <div className="flex items-center gap-2 pt-1">
        <input
          id="remember-details"
          type="checkbox"
          checked={customer.remember}
          onChange={(e) => setCustomer({ ...customer, remember: e.target.checked })}
          className="w-4 h-4 rounded text-[var(--primary)] focus:ring-[var(--primary)]"
        />
        <label
          htmlFor="remember-details"
          className={`text-xs select-none cursor-pointer font-bold ${
            darkMode ? 'text-neutral-300' : 'text-neutral-700'
          }`}
        >
          {isAr ? 'تذكر بياناتي على هذا الجهاز' : 'Remember my details on this device'}
        </label>
      </div>
    </div>
  );
};
