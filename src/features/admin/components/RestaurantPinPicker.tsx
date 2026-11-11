import React, { useEffect, useRef, useState } from 'react';
import { X, MapPin, Check } from 'lucide-react';

interface RestaurantPinPickerProps {
  lang: 'en' | 'ar';
  initial: { lat: number; lng: number } | null;
  onConfirm: (lat: number, lng: number) => void;
  onClose: () => void;
}

const FALLBACK = { lat: 33.8938, lng: 35.5018 }; // Beirut

/** Admin restaurant pin picker (Leaflet, lazy-loaded): drag/tap to set the
 *  exact restaurant anchor every distance fee is measured from. */
export const RestaurantPinPicker: React.FC<RestaurantPinPickerProps> = ({
  lang,
  initial,
  onConfirm,
  onClose,
}) => {
  const isAr = lang === 'ar';
  const mapRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState(initial ?? FALLBACK);
  const [ready, setReady] = useState(false);
  const pointRef = useRef(point);
  pointRef.current = point;
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    let cancelled = false;
    let map: { remove: () => void } | null = null;
    let marker: { setLatLng: (p: [number, number]) => void } | null = null;
    (async () => {
      try {
        await import('leaflet/dist/leaflet.css');
        const L = await import('leaflet');
        if (cancelled || !mapRef.current) return;
        const start = pointRef.current;
        const m = L.map(mapRef.current).setView([start.lat, start.lng], 16);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap',
        }).addTo(m);
        const icon = L.divIcon({
          className: '',
          html: '<div style="width:30px;height:30px;border-radius:50%;background:#FFC400;border:3px solid #0A0A0A;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        const mk = L.marker([start.lat, start.lng], { draggable: true, icon }).addTo(m);
        mk.on('dragend', () => {
          const p = mk.getLatLng();
          setPoint({ lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 });
        });
        m.on('click', (e: { latlng: { lat: number; lng: number } }) => {
          const p = { lat: Math.round(e.latlng.lat * 1e5) / 1e5, lng: Math.round(e.latlng.lng * 1e5) / 1e5 };
          mk.setLatLng([p.lat, p.lng]);
          setPoint(p);
        });
        marker = mk;
        map = m;
        setReady(true);
        // Locate-me: center on the device once (owner is usually on-site),
        // but only when there was no saved anchor (fresh setup).
        try {
          if (typeof navigator !== 'undefined' && navigator.geolocation && initialRef.current === null) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                if (cancelled || !map) return;
                const p = {
                  lat: Math.round(pos.coords.latitude * 1e5) / 1e5,
                  lng: Math.round(pos.coords.longitude * 1e5) / 1e5,
                };
                (map as unknown as { setView: (c: [number, number], z: number) => void }).setView([p.lat, p.lng], 16);
                marker?.setLatLng([p.lat, p.lng]);
                setPoint(p);
              },
              () => {},
              { timeout: 8000 },
            );
          }
        } catch {}
      } catch {}
    })();
    return () => {
      cancelled = true;
      try { map?.remove(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={isAr ? 'تحديد موقع المطعم' : 'Pin restaurant location'}>
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-[#141414] text-white border-2 border-[var(--primary)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <h3 className="text-sm font-black flex items-center gap-2">
            <MapPin size={16} className="text-[var(--primary)]" />
            {isAr ? 'حدد موقع المطعم بدقة' : 'Pin your exact restaurant spot'}
          </h3>
          <button type="button" onClick={onClose} aria-label={isAr ? 'إغلاق' : 'Close'} className="w-10 h-10 rounded-full flex items-center justify-center bg-neutral-800 hover:bg-neutral-700">
            <X size={18} />
          </button>
        </div>
        <div className="px-4 pt-3 pb-1">
          <p className="text-[11px] text-neutral-400">
            {isAr
              ? 'اسحب الدبوس أو انقر على الخريطة — كل رسوم المسافة تُحسب من هذه النقطة.'
              : 'Drag the pin or tap the map — every distance fee is measured from this point.'}
          </p>
        </div>
        <div className="px-4">
          <div ref={mapRef} className="w-full h-[320px] rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800" />
          {!ready && <p className="text-[11px] text-neutral-500 py-2">{isAr ? 'جارٍ تحميل الخريطة…' : 'Loading the map…'}</p>}
        </div>
        <div className="p-4 flex items-center gap-2">
          <span className="flex-1 text-xs tabular-nums text-neutral-300" dir="ltr">
            {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
          </span>
          <button
            type="button"
            onClick={() => onConfirm(point.lat, point.lng)}
            className="btn-tactile h-11 px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-black inline-flex items-center gap-1.5"
          >
            <Check size={16} />
            {isAr ? 'اعتماد الموقع' : 'Use this spot'}
          </button>
        </div>
      </div>
    </div>
  );
};
