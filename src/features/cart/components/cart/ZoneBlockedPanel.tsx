import React from 'react';
import { MapPinOff, MessageCircle } from 'lucide-react';

interface ZoneBlockedPanelProps {
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** Full international digits, e.g. 96170123456 (already validated when ordering is on). */
  whatsapp: string;
  placeName: string | null;
  onChangeLocation: () => void;
}

/**
 * Hard delivery-zone block: the pinned point resolved outside the admin's
 * served zones. Exact owner-approved copy + a WhatsApp CTA (the human
 * fallback for edge cases) + a one-tap way back to the map.
 */
export const ZoneBlockedPanel: React.FC<ZoneBlockedPanelProps> = ({
  lang,
  darkMode,
  whatsapp,
  placeName,
  onChangeLocation,
}) => {
  const isAr = lang === 'ar';
  const digits = (whatsapp || '').replace(/[^0-9]/g, '');
  return (
    <div
      role="alert"
      className={`rounded-2xl border p-4 space-y-3 ${
        darkMode
          ? 'border-red-500/40 bg-red-500/10'
          : 'border-red-500/50 bg-red-50'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-red-500 text-white shadow-md shadow-red-500/30"
          aria-hidden="true"
        >
          <MapPinOff size={17} />
        </span>
        <div className="min-w-0">
          <p dir="auto" className={`text-sm font-extrabold leading-relaxed ${darkMode ? 'text-red-200' : 'text-red-800'}`}>
            {isAr ? 'موقعك خارج نطاق التوصيل حاليًا، تواصل معنا' : 'Your location isn’t in our delivery area right now — contact us.'}
          </p>
          <p dir="auto" className={`mt-1 text-xs leading-relaxed ${darkMode ? 'text-neutral-300' : 'text-neutral-600'}`}>
            {placeName
              ? (isAr ? `الموقع المحدد: ${placeName} — خارج مناطق التوصيل.` : `Pinned area: ${placeName} — outside our delivery zones.`)
              : (isAr ? 'الموقع المحدد خارج مناطق التوصيل.' : 'The pinned point is outside our delivery zones.')}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {digits && (
          <a
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-tactile inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-[#25D366] text-white text-sm font-extrabold shadow-md hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]"
          >
            <MessageCircle size={17} aria-hidden="true" />
            <span>{isAr ? 'تواصل عبر واتساب' : 'Chat on WhatsApp'}</span>
          </a>
        )}
        <button
          type="button"
          onClick={onChangeLocation}
          className={`btn-tactile inline-flex items-center h-11 px-4 rounded-full border text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
            darkMode
              ? 'border-neutral-600 text-neutral-200 hover:border-[var(--primary)] hover:text-[var(--primary)]'
              : 'border-neutral-400 text-neutral-700 hover:border-neutral-800'
          }`}
        >
          {isAr ? 'غيّر الموقع' : 'Change location'}
        </button>
      </div>
    </div>
  );
};
