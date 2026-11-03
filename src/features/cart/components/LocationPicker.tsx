import React, { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { Loader2, Navigation } from 'lucide-react';
import { AUTO_LOCATE_OPTIONS, reverseGeocode, round5, shouldAutoLocateOnOpen, useMidSplitLocationMap } from '../hooks/useMidSplitLocationMap';
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
    denied: 'Location is blocked — allow it in the browser settings, or pin manually.',
    failed: 'Could not detect you — drag the pin or type the address.',
    confirmAnyway: 'Confirm anyway - tap again',
    poorAcc: 'Weak fix - the pin may be far off. Drag it to correct, or tap confirm again to use it as-is.',
    unsupported: 'This browser has no location service — drag the pin to set your point.',
  },
  ar: {
    title: 'موقع التوصيل', close: 'إغلاق', locating: 'جارٍ تحديد موقعك…',
    dragHint: 'اسحب الدبوس أو اضغط على الخريطة للضبط',
    confirm: 'تأكيد الموقع', locate: 'موقعي', loadingMap: 'جارٍ تحميل الخريطة…',
    mapFail: 'تعذر تحميل الخريطة (لا إنترنت؟). يمكنك تأكيد النقطة المكتشفة.',
    addrFail: 'تعذر جلب العنوان — سيُحفظ بالإحداثيات.',
    manual: 'كتابة العنوان يدوياً',
    denied: 'الموقع محظور — اسمح به من إعدادات المتصفح أو حدد بالدبوس.',
    failed: 'تعذر تحديد موقعك — اسحب الدبوس أو اكتب العنوان.',
    unsupported: 'هذا المتصفح بلا خدمة موقع — اسحب الدبوس لتحديد نقطتك.',
    confirmAnyway: 'تأكيد رغم ذلك — اضغط مجددًا',
    poorAcc: 'الدقة ضعيفة — قد تكون النقطة بعيدة. اسحب الدبوس للتصحيح، أو اضغط التأكيد مجددًا للاستخدام كما هي.',
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
  // Two-tap guard: an AUTO fix worse than POOR_ACC_M could be a cell-tower
  // fix kilometers away — the first tap only arms FOR THAT EXACT point,
  // the second confirms. A moved pin invalidates the arm automatically
  // (armedFor stops matching). Hand-placed pins skip the guard entirely:
  // the human already verified.
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const POOR_ACC_M = 250;
  // Human-readable detect outcome (never silent: weak browsers may lack the
  // API entirely or never answer — both used to leave a dead spinner).
  const [locError, setLocError] = useState<string | null>(null);
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
  // Mirrored into state so the weak-fix warning renders live (an auto fix
  // worse than 250m must be visibly flagged BEFORE confirming — a wrong
  // street silently previewed is the "wrong address" bug).
  const manualRef = useRef(false);
  const [manual, setManual] = useState(false);
  // Guards overlapping detect() runs (open auto-fix vs. button taps).
  const seqRef = useRef(0);
  // Once-per-open guard for the silent auto-fix below.
  const autoTriedRef = useRef(false);
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
          setManual(true);
          setDetecting(false);
          setLocError(null);
          setPoint({ lat: round5(p.lat), lng: round5(p.lng), accuracy: 100 });
        });
        map.on('click', (e: Leaflet.LeafletMouseEvent) => {
          marker.setLatLng(e.latlng);
          manualRef.current = true;
          setManual(true);
          setDetecting(false);
          setLocError(null);
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
    // No API at all (minimal/WebView browsers): say so now, not silence.
    if (!('geolocation' in navigator) || typeof navigator.geolocation?.getCurrentPosition !== 'function') {
      setDetecting(false);
      setLocError(t.unsupported);
      return;
    }
    const seq = ++seqRef.current;
    if (userTap) {
      manualRef.current = false;
      setManual(false);
      setLocError(null);
    }
    setDetecting(true);
    // Watchdog: some browsers never call back AND ignore timeout — without
    // this the spinner (and the user) waits forever. Force-settles the run.
    window.setTimeout(() => {
      if (seq !== seqRef.current) return;
      setDetecting(false);
      setLocError((prev) => {
        if (prev) return prev;
        // A hand-placed pin already answers the user — stay silent then,
        // unless they explicitly tapped (their tap deserves an answer).
        if (manualRef.current && !userTap) return prev;
        return pointRef.current && !userTap ? prev : t.failed;
      });
    }, 15000);
    // Phase 1 — fast: cached/cell fix lands in ~a second so the pin moves
    // immediately. Good enough (WiFi-grade) ends here.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (seq !== seqRef.current) return;
        const { latitude, longitude, accuracy } = pos.coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          const acc = typeof accuracy === 'number' ? accuracy : 100;
          moveTo(latitude, longitude, acc);
          setLocError(null);
          if (acc <= 60) {
            setDetecting(false);
            return;
          }
        }
        refine(seq);
      },
      (err) => {
        if (seq !== seqRef.current) return;
        // Permission denial is final (retrying nags the OS): report how to
        // fix instead of spinning into phase 2.
        if (err && (err as GeolocationPositionError).code === 1) {
          setDetecting(false);
          setLocError(t.denied);
          return;
        }
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
      (err) => {
        setDetecting(false);
        if (seq !== seqRef.current || manualRef.current) return;
        // A coarse phase-1 fix already answers the user — only speak up when
        // there is still no point at all.
        if (pointRef.current) return;
        if (err && (err as GeolocationPositionError).code === 1) setLocError(t.denied);
        else setLocError(t.failed);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  // On-open auto-fix: center on the saved/pinned point when present; else
  // ONE silent high-accuracy attempt (~8s, no retry, no denial toast).
  // No auto-retry because iOS Safari only shows the permission prompt on a
  // user gesture -- an on-load prompt is dropped/denied there (Android/desktop
  // Chrome generally allow prompt-on-load), and retrying would nag the OS.
  // The "My location" button stays as the gesture path that works everywhere
  // (full two-phase fix + accuracy gate + two-tap confirm, unchanged).
  // Never more than once per open (autoTriedRef).
  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    if (!shouldAutoLocateOnOpen(initial)) return;
    if (!('geolocation' in navigator) || typeof navigator.geolocation?.getCurrentPosition !== 'function') return;
    const seq = ++seqRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch trigger, see above
    setDetecting(true);
    const watchdog = window.setTimeout(() => {
      if (seq !== seqRef.current) return;
      setDetecting(false);
      // Silent: never surface the auto-fix watchdog as an error toast.
    }, 9000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (seq !== seqRef.current) return;
        window.clearTimeout(watchdog);
        setDetecting(false);
        if (manualRef.current) return;
        const { latitude, longitude, accuracy } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        moveTo(latitude, longitude, typeof accuracy === 'number' ? accuracy : 100);
      },
      () => {
        if (seq !== seqRef.current) return;
        window.clearTimeout(watchdog);
        setDetecting(false);
        // Silent on denial/failure: no retry, no toast. Manual button remains.
      },
      AUTO_LOCATE_OPTIONS,
    );
    return () => window.clearTimeout(watchdog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    if (!point || confirming) return;
    const key = `${point.lat},${point.lng}`;
    if (!manualRef.current && point.accuracy > POOR_ACC_M && armedFor !== key) {
      setArmedFor(key);
      return;
    }
    setArmedFor(null);
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
          className={`shrink-0 h-11 min-h-[44px] px-4 rounded-full border text-xs font-bold inline-flex items-center gap-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-neutral-700 text-neutral-200' : 'border-neutral-300 text-neutral-700'}`}
        >
          {detecting ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
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
        <p role="status" className="text-xs font-bold text-amber-500">{t.mapFail}</p>
      )}
      {locError && (
        <p role="status" className="text-xs font-bold text-amber-500">{locError}</p>
      )}

      <LocationAddressPreview point={point} addrLoading={addrLoading} addrPreview={addrPreview} darkMode={darkMode} isAr={isAr} />
      {addrWarn && (
        <p role="status" className="text-xs font-bold text-amber-500">{t.addrFail}</p>
      )}
      {point && (armedFor === `${point.lat},${point.lng}` || (!manual && point.accuracy > POOR_ACC_M)) && (
        <p role="alert" className="text-xs font-bold text-amber-500">
          {t.poorAcc} <span dir="ltr" className="tabular-nums">±{Math.round(point.accuracy)}m</span>
        </p>
      )}

      <button
        type="button"
        onClick={() => void confirm()}
        disabled={!point || confirming}
        className={`btn-tactile w-full h-12 rounded-full font-black text-sm disabled:opacity-50 ${point && armedFor === `${point.lat},${point.lng}` ? 'bg-amber-400 text-[#0A0A0A]' : 'bg-[var(--primary)] text-[#0A0A0A]'}`}
      >
        {confirming ? <Loader2 size={17} className="animate-spin mx-auto" /> : (point && armedFor === `${point.lat},${point.lng}` ? t.confirmAnyway : t.confirm)}
      </button>
      <button
        type="button"
        onClick={onClose}
        className={`w-full h-11 min-h-[44px] rounded-full text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}
      >
        {t.manual}
      </button>
      <style>{`.loc-div-icon{background:none;border:none;}.leaflet-container{font:inherit;background:${darkMode ? '#141414' : '#f0ede6'};}.leaflet-control-attribution{font-size:9px;}.leaflet-touch .leaflet-bar a{width:44px!important;height:44px!important;line-height:44px!important;font-size:22px;}.leaflet-touch .leaflet-control-zoom{margin-top:10px;margin-left:10px;}`}</style>
    </div>
  );
};
