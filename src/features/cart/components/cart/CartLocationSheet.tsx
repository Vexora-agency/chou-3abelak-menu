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
      <div className={`relative w-full rounded-t-[24px] p-5 pb-7 max-h-[92vh] max-h-[92dvh] overflow-y-auto overscroll-contain no-scrollbar anim-drawer-in shadow-2xl ${darkMode ? 'bg-[#141414] text-white border-t-2 border-[var(--primary)]' : 'bg-white text-[#0A0A0A] border-t-2 border-[var(--primary)]'}`}>
        <div className="w-11 h-1.5 rounded-full mx-auto mb-4 bg-neutral-400/50" />
        <div className="flex items-center justify-between gap-3 mb-4">
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
  );
};
