import React from 'react';

interface LocationAddressPreviewProps {
  point: { lat: number; lng: number; accuracy: number } | null;
  addrLoading: boolean;
  addrPreview: string | null;
  darkMode: boolean;
  isAr: boolean;
}

export const LocationAddressPreview: React.FC<LocationAddressPreviewProps> = ({
  point,
  addrLoading,
  addrPreview,
  darkMode,
  isAr,
}) => {
  return (
    <>
      {/* Live address preview: exactly what Confirm will write. Move the
          pin until this reads correctly — this is a real order. */}
      <div role="status" aria-live="polite" className={`rounded-xl border p-3 min-h-[58px] break-words overflow-wrap:anywhere ${darkMode ? 'border-neutral-700 bg-black/40' : 'border-neutral-300 bg-neutral-100'}`}>
        {!point ? (
          <p className={`text-xs ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
            {isAr ? 'حرّك المؤشر أو اضغط على الخريطة…' : 'Move the pin or tap the map…'}
          </p>
        ) : addrLoading ? (
          <p className={`text-xs font-bold animate-pulse ${darkMode ? 'text-neutral-300' : 'text-neutral-700'}`}>
            {isAr ? 'جارٍ جلب العنوان…' : 'Fetching address…'}
          </p>
        ) : addrPreview ? (
          <>
            <p className={`text-[13px] font-black leading-snug ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`} dir="auto">{addrPreview}</p>
            <p className={`text-[11px] tabular-nums mt-0.5 ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`} dir="ltr">
              {point.lat}, {point.lng} · ±{Math.round(point.accuracy)}m
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-black tabular-nums" dir="ltr">{point.lat}, {point.lng}</p>
            <p className="text-[11px] font-bold text-amber-500 mt-0.5">
              {isAr ? 'لا يوجد عنوان مسجل هنا — حرّك المؤشر لأقرب شارع أو أكّد بالإحداثيات.' : 'No registered address here — move the pin to the nearest street or confirm with coordinates.'}
            </p>
          </>
        )}
      </div>
    </>
  );
};
