import React, { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { Loader2, Navigation } from 'lucide-react';
import { reverseGeocode, round5, useMidSplitLocationMap } from '../hooks/useMidSplitLocationMap';
import { LocationAddressPreview } from './location/LocationAddressPreview';

interface LocationPickerProps {
  lang: 'en' | 'ar';
  darkMode: boolean;
  initial: { lat: number; lng: number } | null;
  fallback: { lat: number; lng: number };
  onPick: (lat: number, lng: number, accuracy: number, addressText: string | null) => void;
  onClose: () => void;
}

const STR = {
  en: {
    title: 'Delivery location', close: 'Close', locating: 'Detecting your location…',
    dragHint: 'Drag the pin or tap the map to adjust',
    confirm: 'Confirm location', locate: 'My location', loadingMap: 'Loading map…',
    mapFail: 'Map tiles did not load (offline?). You can still confirm the detected point.',
    addrFail: 'Address lookup failed — coordinates will be saved.',
    manual: 'Enter address manually',
  },
  ar: {
    title: 'موقع التوصيل', close: 'إغلاق', locating: 'جارٍ تحديد موقعك…',
    dragHint: 'اسحب الدبوس أو اضغط على الخريطة للضبط',
    confirm: 'تأكيد الموقع', locate: 'موقعي', loadingMap: 'جارٍ تحميل الخريطة…',
    mapFail: 'تعذر تحميل الخريطة (لا إنترنت؟). يمكنك تأكيد النقطة المكتشفة.',
    addrFail: 'تعذر جلب العنوان — سيُحفظ بالإحداثيات.',
    manual: 'كتابة العنوان يدوياً',
  },
} as const;

export const LocationPicker: React.FC<LocationPickerProps> = ({ lang, darkMode, initial, fallback, onPick, onClose }) => {
  const t = STR[lang];
  const isAr = lang === 'ar';
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const mapObj = useRef<Leaflet.Map | null>(null);
  const markerObj = useRef<Leaflet.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [addrWarn, setAddrWarn] = useState(false);
  const [point, setPoint] = useState<{ lat: number; lng: number; accuracy: number } | null>(
    initial ? { ...initial, accuracy: 100 } : null
  );
  // Latest point for async callbacks (never read state inside them).
  const pointRef = useRef<{ lat: number; lng: number; accuracy: number } | null>(null);
  useEffect(() => {
    pointRef.current = point;
  }, [point]);
  // Set once the customer drags/taps: background refinements must never yank
  // a hand-placed pin. Reset when "My location" is explicitly tapped.
  const manualRef = useRef(false);
  // Guards overlapping detect() runs (open auto-fix vs. button taps).
  const seqRef = useRef(0);
  const { addrPreview, addrLoading, previewKey } = useMidSplitLocationMap(point, ready, lang);

  // Load Leaflet lazily (only when the picker opens) and build the map.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [L] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        if (cancelled || !mapRef.current) return;
        leafletRef.current = L;
        const start: [number, number] = initial ? [initial.lat, initial.lng] : [fallback.lat, fallback.lng];
        const map = L.map(mapRef.current, { zoomControl: true }).setView(start, 16);
        map.attributionControl.setPrefix(false);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
          .on('tileerror', () => setTilesFailed(true))
          .addTo(map);
        const icon = L.divIcon({
          className: 'loc-div-icon',
          html: '<div style="width:34px;height:34px;border-radius:50%;background:var(--primary);border:3px solid #0A0A0A;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,0.45)"><div style="width:10px;height:10px;border-radius:50%;background:#0A0A0A"></div></div>',
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        const marker = L.marker(start, { icon, draggable: true, autoPan: true }).addTo(map);
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          manualRef.current = true;
          setDetecting(false);
          setPoint({ lat: round5(p.lat), lng: round5(p.lng), accuracy: 100 });
        });
        map.on('click', (e: Leaflet.LeafletMouseEvent) => {
          marker.setLatLng(e.latlng);
          manualRef.current = true;
          setDetecting(false);
          setPoint({ lat: round5(e.latlng.lat), lng: round5(e.latlng.lng), accuracy: 100 });
        });
        mapObj.current = map;
        markerObj.current = marker;
        setReady(true);
        window.setTimeout(() => {
          try {
            map.invalidateSize();
          } catch {}
        }, 350);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      try {
        mapObj.current?.remove();
      } catch {}
      mapObj.current = null;
      markerObj.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveTo = (lat: number, lng: number, accuracy: number) => {
    setPoint({ lat: round5(lat), lng: round5(lng), accuracy });
    try {
      markerObj.current?.setLatLng([lat, lng]);
      mapObj.current?.setView([lat, lng], Math.max(mapObj.current.getZoom(), 16));
    } catch {}
  };

  const detect = (userTap = false) => {
    if (!('geolocation' in navigator)) return;
    const seq = ++seqRef.current;
    if (userTap) manualRef.current = false;
    setDetecting(true);
    // Phase 1 — fast: cached/cell fix lands in ~a second so the pin moves
    // immediately. Good enough (WiFi-grade) ends here.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (seq !== seqRef.current) return;
        const { latitude, longitude, accuracy } = pos.coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          const acc = typeof accuracy === 'number' ? accuracy : 100;
          moveTo(latitude, longitude, acc);
          if (acc <= 60) {
            setDetecting(false);
            return;
          }
        }
        refine(seq);
      },
      () => {
        if (seq !== seqRef.current) return;
        refine(seq); // low-power fix failed → still try GPS
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 300000 }
    );
  };

  // Phase 2 — refine silently with GPS; never moves a hand-placed pin and
  // never replaces a better fix with a worse one.
  const refine = (seq: number) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDetecting(false);
        if (seq !== seqRef.current || manualRef.current) return;
        const { latitude, longitude, accuracy } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        const acc = typeof accuracy === 'number' ? accuracy : 100;
        const prev = pointRef.current;
        if (!prev || acc < prev.accuracy) {
          moveTo(latitude, longitude, acc);
        }
      },
      () => setDetecting(false),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  // Auto-detect once when the picker opens (fetch trigger).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch trigger, see above
    detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    if (!point || confirming) return;
    setConfirming(true);
    setAddrWarn(false);
    // Reuse the live preview when it already matches this exact point,
    // otherwise do one authoritative lookup now.
    let addr: string | null = previewKey.current === `${point.lat},${point.lng}` ? addrPreview : null;
    if (addr === null) {
      try {
        addr = await reverseGeocode(point.lat, point.lng, lang);
      } catch {
        addr = null;
      }
    }
    if (!addr) setAddrWarn(true);
    setConfirming(false);
    onPick(point.lat, point.lng, point.accuracy, addr);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>{t.dragHint}</p>
        <button
          type="button"
          onClick={() => detect(true)}
          disabled={detecting}
          className={`shrink-0 h-9 px-3 rounded-full border text-[11px] font-bold inline-flex items-center gap-1.5 disabled:opacity-60 ${darkMode ? 'border-neutral-700 text-neutral-200' : 'border-neutral-300 text-neutral-700'}`}
        >
          {detecting ? <Loader2 size={13} className="animate-spin" /> : <Navigation size={13} />}
          {t.locate}
        </button>
      </div>

      <div dir="ltr" className={`relative h-52 min-[380px]:h-56 sm:h-64 rounded-2xl overflow-hidden border ${darkMode ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-300 bg-neutral-100'}`}>
        <div ref={mapRef} className="absolute inset-0 z-0" />
        {!ready && !loadError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
            <Loader2 size={22} className="animate-spin text-[var(--primary)]" />
            <span className={`text-xs font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>{t.loadingMap}</span>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-center">
            <p className="text-xs font-bold text-red-500">{t.mapFail}</p>
          </div>
        )}
        {point && (
          <div className="absolute z-10 bottom-2 start-2 px-2.5 py-1 rounded-full text-[11px] font-black tabular-nums bg-black/70 text-white" dir="ltr">
            {point.lat}, {point.lng}
          </div>
        )}
      </div>

      {tilesFailed && (
        <p className="text-[11px] font-bold text-amber-500">{t.mapFail}</p>
      )}

      <LocationAddressPreview point={point} addrLoading={addrLoading} addrPreview={addrPreview} darkMode={darkMode} isAr={isAr} />
      {addrWarn && (
        <p className="text-[11px] font-bold text-amber-500">{t.addrFail}</p>
      )}

      <button
        type="button"
        onClick={() => void confirm()}
        disabled={!point || confirming}
        className="btn-tactile w-full h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-black text-sm disabled:opacity-50"
      >
        {confirming ? <Loader2 size={17} className="animate-spin mx-auto" /> : t.confirm}
      </button>
      <button
        type="button"
        onClick={onClose}
        className={`w-full h-10 rounded-full text-xs font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}
      >
        {t.manual}
      </button>
      <style>{`.loc-div-icon{background:none;border:none;}.leaflet-container{font:inherit;background:${darkMode ? '#141414' : '#f0ede6'};}.leaflet-control-attribution{font-size:9px;}.leaflet-touch .leaflet-bar a{width:38px;height:38px;line-height:38px;}.leaflet-touch .leaflet-control-zoom{margin-top:10px;margin-left:10px;}`}</style>
    </div>
  );
};
