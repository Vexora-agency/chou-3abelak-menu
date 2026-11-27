import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { ChevronDown, Loader2, Navigation, Search } from 'lucide-react';
import { AUTO_LOCATE_OPTIONS, composePreciseAddress, reverseGeocode, round5, shouldAutoLocateOnOpen, useMidSplitLocationMap } from '../hooks/useMidSplitLocationMap';
import { loadPlacesIndex } from '@/src/utils/streetIndex';
import { LocationAddressPreview } from './location/LocationAddressPreview';
import { fetchPlaceCoords, useAddressAutocomplete } from '@/src/hooks/useAddressAutocomplete';
import { AddressSuggestList } from '@/src/components/AddressSuggestList';

interface LocationPickerProps {
  lang: 'en' | 'ar';
  darkMode: boolean;
  initial: { lat: number; lng: number } | null;
  fallback: { lat: number; lng: number };
  onPick: (lat: number, lng: number, accuracy: number, addressText: string | null) => void;
  onClose: () => void;
  /** Override the bottom button label (defaults to "Enter address manually"). */
  manualLabel?: string;
  /** When true (delivery checkout), the manual-entry button is hidden and
      the search + pin become the only path — the order cannot be placed
      without a confirmed pin. */
  requirePin?: boolean;
  /** Lowercase 2-letter country for autocomplete bias (e.g. "lb"). */
  country?: string;
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
    searchPh: 'Search street or landmark…',
    searching: 'Searching…',
    searchGo: 'Search now',
    noResults: 'No results — try just the street name and number, or drag the pin.',
    addDetails: 'Address not precise? Add building details', hideDetails: 'Hide details',
    zoomHint: 'Zoom in for a precise pin — the address follows the pin.',
    detailsTitle: 'Exact delivery details (optional)',
    bBuilding: 'Building', bFloor: 'Floor', bApt: 'Apartment', bLandmark: 'Landmark',
    phBldg: '5', phFloor: '2', phApt: '3', phLandmark: 'Near the pharmacy',
    areaLabel: 'Area', areaPh: 'Choose your area…',
  },
  ar: {
    title: 'موقع التوصيل', close: 'إغلاق', locating: 'جارٍ تحديد موقعك…',
    dragHint: 'اسحب المؤشر أو اضغط على الخريطة للضبط',
    confirm: 'تأكيد الموقع', locate: 'موقعي', loadingMap: 'جارٍ تحميل الخريطة…',
    mapFail: 'تعذر تحميل الخريطة (لا إنترنت؟). يمكنك تأكيد النقطة المكتشفة.',
    addrFail: 'تعذر جلب العنوان — سيُحفظ بالإحداثيات.',
    manual: 'كتابة العنوان يدويًا',
    denied: 'الموقع محظور — اسمح به من إعدادات المتصفح أو حدّد الموقع يدويًا.',
    failed: 'تعذر تحديد موقعك — اسحب المؤشر أو اكتب العنوان.',
    unsupported: 'هذا المتصفح بلا خدمة موقع — اسحب المؤشر لتحديد نقطتك.',
    confirmAnyway: 'تأكيد رغم ذلك — اضغط مجددًا',
    poorAcc: 'الدقة ضعيفة — قد تكون النقطة بعيدة. اسحب المؤشر للتصحيح، أو اضغط التأكيد مجددًا للاعتماد كما هي.',
    searchPh: 'ابحث عن الشارع أو المعلم…',
    searching: 'جارٍ البحث…',
    searchGo: 'ابحث الآن',
    noResults: 'لا توجد نتائج — جرّب اسم الشارع ورقمه فقط، أو اسحب الدبوس.',
    addDetails: 'العنوان غير دقيق؟ أضف تفاصيل المبنى', hideDetails: 'إخفاء التفاصيل',
    zoomHint: 'قرّب الخريطة لتثبيت دقيق — العنوان يتبع الدبوس.',
    detailsTitle: 'تفاصيل إضافية للدقة (اختيارية)',
    bBuilding: 'المبنى', bFloor: 'الدور', bApt: 'الشقة', bLandmark: 'علامة مميزة',
    phBldg: '5', phFloor: '2', phApt: '3', phLandmark: 'بجوار الصيدلية',
    areaLabel: 'الحي / المنطقة', areaPh: 'اختر منطقتك…',
  },
} as const;

export const LocationPicker: React.FC<LocationPickerProps> = ({ lang, darkMode, initial, fallback, onPick, onClose, manualLabel, requirePin = false, country = '' }) => {
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
  // In-picker search: jump the pin to a Geoapify suggestion without
  // leaving the map. Shares the same proxy as the address fields.
  // The search is biased to the live map viewport (where the customer is
  // looking — e.g. Alexandria side streets), not the restaurant pin.
  const [searchText, setSearchText] = useState('');
  // One place-details resolution in flight (Google pick → coordinates).
  const [resolvingPick, setResolvingPick] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(
    initial ? { lat: initial.lat, lng: initial.lng } : { lat: fallback.lat, lng: fallback.lng }
  );
  // Untouched opening viewport vs. deliberate looking-around: the very first
  // searches (and any re-search before the first pan/drag/pick) ride on the
  // server's network location instead of the fallback center — a customer
  // in Cairo must not get Alexandria results just because GPS is still
  // fixing or denied. Any deliberate map interaction flips to the viewport.
  const [touched, setTouched] = useState(false);
  // A precise center (saved point or live GPS fix) outranks the network
  // location: once set, the opening viewport is no longer "untouched" even
  // though no human panned. Starts true when opening on a saved point.
  const [hasFix, setHasFix] = useState<boolean>(() => !!initial);
  // Last applied center: a moveend that did not actually move the center
  // (invalidateSize after open, tile reloads) is never a human touch.
  const lastCenterRef = useRef<{ lat: number; lng: number } | null>(
    initial ? { lat: initial.lat, lng: initial.lng } : { lat: fallback.lat, lng: fallback.lng }
  );
  // Set before every programmatic setView so the moveend handler below can
  // tell a code-driven move (no touch) from a human pan/zoom.
  const progMoveRef = useRef(false);
  // Exact-delivery details live behind one professional toggle (collapsed by
  // default): the map stays clean, and a customer whose address reads wrong
  // expands building/floor/apartment/landmark in place.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // GPS uncertainty ring: drawn for auto fixes, cleared on any hand move.
  const circleRef = useRef<Leaflet.Circle | null>(null);
  // Zoomed-out pins are street-accurate at best — nudge closer, never block.
  const [zoomLow, setZoomLow] = useState(false);
  // Exact-delivery details, composed into the confirmed address (never into
  // the instruction box — the driver reads them with the pin).
  const [bldg, setBldg] = useState('');
  const [floor, setFloor] = useState('');
  const [apt, setApt] = useState('');
  const [landmark, setLandmark] = useState('');
  // Step 1 — area first: the downloadable places library feeds this select.
  // Picking an area flies the map there, becomes the search bias center and
  // is appended to server queries («شارع 16، السيوف»). Empty until a
  // places index file exists for the region.
  const [areas, setAreas] = useState<Array<{ name: string; lat: number; lng: number }>>([]);
  const [selectedArea, setSelectedArea] = useState('');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cc = /^[A-Za-z]{2}$/.test(country ?? '') ? (country as string).toLowerCase() : '';
        const idx = await loadPlacesIndex(cc, initial ?? fallback);
        if (cancelled || !idx) return;
        const seen = new Set<string>();
        const list: Array<{ name: string; lat: number; lng: number }> = [];
        for (const e of idx.entries) {
          const name = (lang === 'ar' ? e.ar || e.la : e.la || e.ar) || '';
          if (!name || seen.has(name)) continue;
          seen.add(name);
          list.push({ name, lat: e.lat, lng: e.lng });
          if (list.length >= 150) break;
        }
        if (!cancelled) setAreas(list);
      } catch {
        /* areas stay empty — search still works */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const searchAc = useAddressAutocomplete({
    query: searchText,
    lang,
    country: /^[A-Za-z]{2}$/.test(country ?? '') ? (country as string).toLowerCase() : '',
    enabled: true,
    bias: mapCenter,
    area: selectedArea,
    autoBias: !touched && !hasFix,
  });
  // Explicit search auto-pins: the customer is NEVER forced to pick from
  // the list. Typing only suggests; pressing بحث (or Enter on an empty
  // list) flies the pin to the first result of the fresh search. A newer
  // keystroke cancels the pending auto-pick by clearing the marker below.
  const autoPickRef = useRef<string | null>(null);
  const doExplicitSearch = useCallback(() => {
    const t = searchText.trim();
    if (t.length < 3) return;
    autoPickRef.current = t;
    searchAc.setOpen(true);
    searchAc.forceSearch();
  }, [searchText, searchAc]);
  useEffect(() => {
    if (!autoPickRef.current) return;
    if (searchAc.loading) return;
    if (searchAc.suggestions.length > 0 && searchText.trim() === autoPickRef.current) {
      const first = searchAc.suggestions[0];
      autoPickRef.current = null;
      handleSearchPick(first);
    } else if (searchAc.suggestions.length === 0 && searchAc.open) {
      // Search settled with nothing: leave the guidance hint up.
      autoPickRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchAc.suggestions, searchAc.loading, searchAc.open]);

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
          setTouched(true);
          clearAccuracy();
          setPoint({ lat: round5(p.lat), lng: round5(p.lng), accuracy: 100 });
        });
        map.on('click', (e: Leaflet.LeafletMouseEvent) => {
          marker.setLatLng(e.latlng);
          manualRef.current = true;
          setManual(true);
          setDetecting(false);
          setLocError(null);
          setTouched(true);
          clearAccuracy();
          setPoint({ lat: round5(e.latlng.lat), lng: round5(e.latlng.lng), accuracy: 100 });
        });
        // Keep the search bias on the live viewport: pans and zooms move
        // the bias with the map, so side-street search follows the eye.
        // setView/moveTo also fire moveend, so programmatic moves are covered
        // — but only human pans count as "touched" for the auto-bias flag.
        map.on('moveend', () => {
          try {
            const c = map.getCenter();
            if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
              setMapCenter({ lat: round5(c.lat), lng: round5(c.lng) });
            }
            if (progMoveRef.current) {
              progMoveRef.current = false;
            } else {
              // Same-center moveend (open invalidateSize, tile reloads) is
              // not a human pan: only a real displacement counts as touch.
              const prev = lastCenterRef.current;
              const moved = !prev || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)
                || Math.abs(c.lat - prev.lat) > 0.00005 || Math.abs(c.lng - prev.lng) > 0.00005;
              if (moved) setTouched(true);
            }
            if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
              lastCenterRef.current = { lat: c.lat, lng: c.lng };
            }
            setZoomLow(map.getZoom() < 16);
          } catch {}
        });
        mapObj.current = map;
        markerObj.current = marker;
        setReady(true);
        // Opening resize must not read as a human pan: guard it so the
        // untouched-viewport network-location fallback survives it. The
        // moveend equality guard below is the second belt; this flag is
        // cleared shortly after in case no moveend fires at all.
        window.setTimeout(() => {
          try {
            progMoveRef.current = true;
            map.invalidateSize();
          } catch {
            progMoveRef.current = false;
          }
          window.setTimeout(() => {
            // A consumed flag is already false; only an unconsumed one is
            // cleared here — and its moveend (if any) carries the same
            // center, which the equality guard ignores anyway.
            progMoveRef.current = false;
          }, 1000);
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

  const drawAccuracy = (lat: number, lng: number, accuracy: number) => {
    try {
      const L = leafletRef.current;
      const map = mapObj.current;
      if (!L || !map) return;
      try {
        circleRef.current?.remove();
      } catch {}
      circleRef.current = null;
      // A visible uncertainty ring beats a bare ±number: the customer sees
      // how far off the fix may be before confirming.
      if (Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 1000) {
        circleRef.current = L.circle([lat, lng], {
          radius: accuracy,
          color: '#E8FF47',
          weight: 1,
          opacity: 0.7,
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(map);
      }
    } catch {}
  };

  const clearAccuracy = () => {
    try {
      circleRef.current?.remove();
    } catch {}
    circleRef.current = null;
  };

  const moveTo = (lat: number, lng: number, accuracy: number, zoom = 16) => {
    setPoint({ lat: round5(lat), lng: round5(lng), accuracy });
    lastCenterRef.current = { lat, lng };
    try {
      progMoveRef.current = true;
      markerObj.current?.setLatLng([lat, lng]);
      mapObj.current?.setView([lat, lng], Math.max(mapObj.current.getZoom(), zoom));
    } catch {
      progMoveRef.current = false;
    }
    drawAccuracy(lat, lng, accuracy);
  };

  const handleSearchPick = (s: { lat: number | null; lng: number | null; label: string; placeId?: string }) => {
    // Google rows carry no coordinates (predictions have no geometry):
    // resolve once via the server proxy with the same billing session,
    // then pin exactly like the rest.
    if (s.placeId && (!Number.isFinite(s.lat) || !Number.isFinite(s.lng))) {
      setResolvingPick(true);
      setLocError(null);
      setTouched(true);
      let session = '';
      try {
        session = searchAc.takePlaceSession();
      } catch {
        session = '';
      }
      void fetchPlaceCoords(s.placeId, session || undefined).then((c) => {
        setResolvingPick(false);
        try {
          searchAc.endPlaceSession();
        } catch {}
        if (!c) {
          setLocError(t.addrFail);
          return;
        }
        applySearchPick({ label: c.label || s.label, lat: c.lat, lng: c.lng });
      });
      return;
    }
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') return;
    setTouched(true);
    applySearchPick({ label: s.label, lat: s.lat, lng: s.lng });
  };

  const applySearchPick = (s: { lat: number; lng: number; label: string }) => {
    searchAc.selectSuggestion({ label: s.label, line1: '', line2: '', lat: s.lat, lng: s.lng } as never);
    setSearchText(s.label);
    manualRef.current = true;
    setManual(true);
    setDetecting(false);
    setLocError(null);
    setArmedFor(null);
    moveTo(s.lat, s.lng, 20, 17);
  };

  // Step 1 — area first: fly to the area center, make it the search bias
  // and append it to server queries («شارع 16، السيوف»). The area pin is
  // an explicit human choice, so it counts as a verified (manual) pin.
  const handleAreaSelect = (name: string) => {
    setSelectedArea(name);
    setLocError(null);
    if (!name) return;
    const hit = areas.find((a) => a.name === name);
    if (!hit) return;
    manualRef.current = true;
    setManual(true);
    setTouched(true);
    setDetecting(false);
    setLocError(null);
    setArmedFor(null);
    setMapCenter({ lat: round5(hit.lat), lng: round5(hit.lng) });
    moveTo(hit.lat, hit.lng, 100, 15);
  };

  // Explicit search button: reruns the full cascade immediately, skipping
  // the debounce delay and the session cache (an in-flight keystroke still
  // wins — it aborts this one and becomes the freshest intent).

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
          setHasFix(true);
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
          setHasFix(true);
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
        setHasFix(true);
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
    // The structured details ride with the pin's own address (never the
    // instruction box): the driver gets one exact deliverable line.
    onPick(point.lat, point.lng, point.accuracy, composePreciseAddress(
      addr,
      { building: bldg, floor, apt, landmark },
      point.lat,
      point.lng,
      lang,
    ));
  };

  // What Confirm will write, live: base text + the structured details, so
  // the customer verifies the exact final line before tapping.
  const composedPreview = point
    ? composePreciseAddress(
      previewKey.current === `${point.lat},${point.lng}` ? addrPreview : null,
      { building: bldg, floor, apt, landmark },
      point.lat,
      point.lng,
      lang,
    )
    : null;

  return (
    <div className="space-y-3">
      {areas.length > 0 && (
        <label className="block">
          <span className={`mb-1 block text-[11px] font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>{t.areaLabel}</span>
          <select
            value={selectedArea}
            onChange={(e) => handleAreaSelect(e.target.value)}
            dir={isAr ? 'rtl' : 'ltr'}
            className={`h-12 w-full rounded-2xl border px-3 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-neutral-700 bg-black text-white' : 'border-neutral-300 bg-white text-[#0A0A0A]'}`}
          >
            <option value="">{t.areaPh}</option>
            {areas.map((a) => (
              <option key={`${a.lat}:${a.lng}:${a.name}`} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className={`rounded-2xl border bg-clip-padding shadow-xs transition-colors focus-within:border-neutral-500 ${darkMode ? 'border-neutral-700 bg-black' : 'border-neutral-300 bg-white'}`}>
        <div className="flex items-center gap-2 px-3">
          <input
            type="text"
            value={searchText}
            onChange={(e) => {
              autoPickRef.current = null;
              setSearchText(e.target.value);
            }}
            onBlur={() => window.setTimeout(() => searchAc.setOpen(false), 120)}
            onFocus={() => { if (searchText.trim().length >= 3) searchAc.setOpen(true); }}
            onKeyDown={(e) => {
              const action = searchAc.handleKeyDown(e);
              if (action === 'pick') {
                e.preventDefault();
                autoPickRef.current = null;
                const picked = searchAc.suggestions[searchAc.activeIndex] ?? searchAc.suggestions[0];
                if (picked) handleSearchPick(picked);
              } else if (action === 'close') {
                autoPickRef.current = null;
                searchAc.setOpen(false);
              } else if (e.key === 'Enter' && searchText.trim().length >= 3 && searchAc.suggestions.length === 0) {
                // Nothing to pick: an explicit search flies the pin to the
                // first fresh result instead of forcing list picks.
                e.preventDefault();
                doExplicitSearch();
              }
            }}
            placeholder={t.searchPh}
            dir={isAr ? 'rtl' : 'ltr'}
            autoComplete="off"
            role="combobox"
            aria-expanded={searchAc.open}
            aria-controls="picker-search-listbox"
            aria-activedescendant={searchAc.activeIndex >= 0 ? `picker-search-listbox-opt-${searchAc.activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-label={t.searchPh}
            className={`no-focus-ring w-full h-12 bg-transparent text-[15px] focus:outline-none ${darkMode ? 'text-white placeholder-neutral-500' : 'text-[#0A0A0A] placeholder-neutral-400'}`}
          />
          {searchAc.loading || resolvingPick ? (
            <span className="flex h-9 shrink-0 items-center px-1" aria-hidden="true">
              <Loader2 size={16} className="animate-spin text-[var(--primary)]" />
            </span>
          ) : (
            <button
              type="button"
              onClick={doExplicitSearch}
              disabled={searchText.trim().length < 3}
              aria-label={t.searchGo}
              title={t.searchGo}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--primary)] px-4 text-xs font-black text-[#0A0A0A] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <Search size={14} aria-hidden="true" />
              {t.searchGo}
            </button>
          )}
        </div>
        {searchAc.open && (searchAc.loading || searchAc.suggestions.length > 0) && (
          <div className={`border-t ${darkMode ? 'border-neutral-700' : 'border-neutral-300'}`}>
            <AddressSuggestList
              lang={lang}
              darkMode={darkMode}
              loading={searchAc.loading}
              items={searchAc.suggestions}
              activeIndex={searchAc.activeIndex}
              listId="picker-search-listbox"
              onPick={(item) => handleSearchPick(item)}
              attached
            />
          </div>
        )}
        {searchAc.open && !searchAc.loading && searchText.trim().length >= 3 && searchAc.suggestions.length === 0 && (
          <div className={`border-t px-4 py-3 text-[11px] font-semibold ${darkMode ? 'border-neutral-700 text-neutral-500' : 'border-neutral-300 text-neutral-400'}`}>
            {t.noResults}
          </div>
        )}
      </div>
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

      <div dir="ltr" className={`relative h-60 min-[380px]:h-64 sm:h-72 rounded-2xl overflow-hidden border ${darkMode ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-300 bg-neutral-100'}`}>
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

      <LocationAddressPreview point={point} addrLoading={addrLoading} addrPreview={composedPreview} darkMode={darkMode} isAr={isAr} />
      {point && zoomLow && (
        <p role="status" className={`text-[11px] font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>{t.zoomHint}</p>
      )}
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        className={`w-full h-11 min-h-[44px] rounded-full border text-xs font-black inline-flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-neutral-700 text-neutral-200' : 'border-neutral-300 text-neutral-700'}`}
      >
        {detailsOpen ? t.hideDetails : t.addDetails}
        <ChevronDown size={15} className={`transition-transform ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {detailsOpen && (
      <div className={`rounded-2xl border p-3 ${darkMode ? 'border-neutral-700 bg-black/40' : 'border-neutral-300 bg-neutral-100'}`}>
        <p className={`text-xs font-black mb-2 ${darkMode ? 'text-neutral-200' : 'text-neutral-700'}`}>{t.detailsTitle}</p>
        <div className="grid grid-cols-3 gap-2" dir={isAr ? 'rtl' : 'ltr'}>
          <label className="block">
            <span className={`block text-[11px] font-bold mb-1 ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>{t.bBuilding}</span>
            <input
              type="text"
              value={bldg}
              onChange={(e) => setBldg(e.target.value)}
              placeholder={t.phBldg}
              dir={isAr ? 'rtl' : 'ltr'}
              autoComplete="off"
              maxLength={60}
              className={`w-full h-11 rounded-xl border px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-neutral-700 bg-black text-white placeholder-neutral-600' : 'border-neutral-300 bg-white text-[#0A0A0A] placeholder-neutral-400'}`}
            />
          </label>
          <label className="block">
            <span className={`block text-[11px] font-bold mb-1 ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>{t.bFloor}</span>
            <input
              type="text"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder={t.phFloor}
              dir={isAr ? 'rtl' : 'ltr'}
              autoComplete="off"
              maxLength={60}
              className={`w-full h-11 rounded-xl border px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-neutral-700 bg-black text-white placeholder-neutral-600' : 'border-neutral-300 bg-white text-[#0A0A0A] placeholder-neutral-400'}`}
            />
          </label>
          <label className="block">
            <span className={`block text-[11px] font-bold mb-1 ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>{t.bApt}</span>
            <input
              type="text"
              value={apt}
              onChange={(e) => setApt(e.target.value)}
              placeholder={t.phApt}
              dir={isAr ? 'rtl' : 'ltr'}
              autoComplete="off"
              maxLength={60}
              className={`w-full h-11 rounded-xl border px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-neutral-700 bg-black text-white placeholder-neutral-600' : 'border-neutral-300 bg-white text-[#0A0A0A] placeholder-neutral-400'}`}
            />
          </label>
        </div>
        <label className="block mt-2" dir={isAr ? 'rtl' : 'ltr'}>
          <span className={`block text-[11px] font-bold mb-1 ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>{t.bLandmark}</span>
          <input
            type="text"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            placeholder={t.phLandmark}
            dir={isAr ? 'rtl' : 'ltr'}
            autoComplete="off"
            maxLength={60}
            className={`w-full h-11 rounded-xl border px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-neutral-700 bg-black text-white placeholder-neutral-600' : 'border-neutral-300 bg-white text-[#0A0A0A] placeholder-neutral-400'}`}
          />
        </label>
      </div>
      )}
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
      {!requirePin && (
        <button
          type="button"
          onClick={onClose}
          className={`w-full h-11 min-h-[44px] rounded-full text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}
        >
          {manualLabel ?? t.manual}
        </button>
      )}
      <style>{`.loc-div-icon{background:none;border:none;}.leaflet-container{font:inherit;background:${darkMode ? '#141414' : '#f0ede6'};}.leaflet-control-attribution{font-size:9px;}.leaflet-touch .leaflet-bar a{width:44px!important;height:44px!important;line-height:44px!important;font-size:22px;}.leaflet-touch .leaflet-control-zoom{margin-top:10px;margin-left:10px;}`}</style>
    </div>
  );
};
