import React from 'react';
import { LocationPicker } from '../LocationPicker';
import { X } from 'lucide-react';

interface CartLocationSheetProps {
  location: { lat: number; lng: number; accuracy: number } | null;
  lang: 'en' | 'ar';
  darkMode: boolean;
  onCloseSheet: (keep: boolean) => void;
  onPick: (lat: number, lng: number, accuracy: number, addressText: string | null) => void;
}

export const CartLocationSheet: React.FC<CartLocationSheetProps> = ({
  location,
  lang,
  darkMode,
  onCloseSheet,
  onPick,
}) => {
  const isAr = lang === 'ar';
  return (
      <div className="absolute inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={isAr ? 'تحديد موقع التوصيل' : 'Pin delivery location'}>
      <div onClick={() => onCloseSheet(false)} className="absolute inset-0 bg-black/60 anim-fade-in" aria-hidden="true" />
      {/* Animation on the wrapper, scrolling on the inner div — the body
          lock is held by the cart drawer underneath (shared counter). */}
      <div className={`anim-drawer-in relative w-full max-h-[92vh] max-h-[92dvh] flex flex-col rounded-t-[24px] shadow-2xl overflow-hidden ${darkMode ? 'bg-[#141414] text-white border-t-2 border-[var(--primary)]' : 'bg-white text-[#0A0A0A] border-t-2 border-[var(--primary)]'}`}>
      <div className="overflow-y-auto overscroll-contain smooth-scroll-touch no-scrollbar flex-1 min-h-0 p-5 pb-7 overflow-x-clip">
        <div className="w-11 h-1.5 rounded-full mx-auto mb-4 bg-neutral-400/50" />
        {/* Sticky header: X stays reachable while the map sheet scrolls. */}
        <div className={`sticky top-0 z-10 -mx-5 -mt-5 mb-4 px-5 pt-5 pb-3 border-b flex items-center justify-between gap-3 ${darkMode ? 'bg-[#141414] border-neutral-800' : 'bg-white border-neutral-200'}`}>
          <h3 className="text-base font-black">{isAr ? 'موقع التوصيل' : 'Delivery location'}</h3>
          <button
            type="button"
            onClick={() => onCloseSheet(false)}
            aria-label={isAr ? 'إغلاق' : 'Close'}
            className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-100 text-neutral-700'}`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Interactive map: detect, drag the pin or tap, then confirm.
            Tiles + address lookup load only while this sheet is open. */}
        <LocationPicker
          lang={lang}
          darkMode={darkMode}
          initial={location}
          fallback={{ lat: 33.87476, lng: 35.545704 }}
          onPick={(lat, lng, accuracy, addressText) => onPick(lat, lng, accuracy, addressText)}
          onClose={() => onCloseSheet(!!location)}
        />
      </div>
      </div>
    </div>
  );
};
