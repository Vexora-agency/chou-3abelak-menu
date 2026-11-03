import { useState, useEffect, useRef } from 'react';
import { MenuData, CustomerDetails, ResolvedCartLine } from '@/src/types/menu';
import { MAX_DELIVERY_DISTANCE_KM, haversineMeters, parseMapUrlCoords, formatDistance } from '@/src/utils/menuHelpers';
import { formatPrice, round2 } from '@/src/utils/pricing';
import { serverNow } from '@/src/utils/serverTime';
import { fetchOrderingStatus, type OrderingStatus } from '@/src/utils/status';
import { phoneDigitsOnly } from '@/src/utils/digits';
import { loadPinnedLocation, loadRememberedDetails, saveCustomerOrder, savePinnedLocation, saveRememberedDetails } from '@/src/utils/customerOrders';
import { shouldOverwriteAddress } from './useMidSplitLocationMap';
import { resolveLiveOrdering } from '@/src/utils/ordering';
import { formatMMSS } from '@/src/utils/countdown';
import { clientConfig } from '@/src/config/client.config';
import { submitOrder } from '../services/cart.api';

interface UseCartCheckoutSubmitArgs {
  menu: MenuData;
  lines: ResolvedCartLine[];
  lang: 'en' | 'ar';
  currency: string;
  orderingState?: OrderingStatus | null;
/** Called after an order is successfully recorded. The
 *  owner wires the cart owner's clear; gated by client.config
 *  cart.clearAfterOrder so white-labels can opt out. */
  onOrderSuccess?: () => void;
}

export function useCartCheckoutSubmit({ menu, lines, lang, currency, orderingState, onOrderSuccess }: UseCartCheckoutSubmitArgs) {
  const isAr = lang === 'ar';
  const ordering = menu.settings.ordering;

  // Retrieve remembered customer details if available (delivery only).
  // A saved record means the box was checked, so it loads checked —
  // the box stays on until the customer unchecks it themself.
  const [customer, setCustomer] = useState<CustomerDetails>(() => {
    const base = {
      name: '',
      phone: '',
      address: '',
      tableNumber: '',
      notes: '',
      orderType: 'delivery' as const,
      remember: false,
    };
    const remembered = loadRememberedDetails();
    if (remembered) return { ...base, ...(remembered as Partial<CustomerDetails>) };
    return base;
  });

  const [orderPrepared, setOrderPrepared] = useState(false);
  // Last placed order (number + tracking token) for the confirmation
  // screen: tracking link + push subscribe. Reset when the drawer closes.
  const [lastOrder, setLastOrder] = useState<{ number: number; trackToken: string | null } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // Honeypot state (always empty for real users, bots fill it).
  // NOTE: must stay above the `if (!isOpen)` early return — hooks order
  // must never change between renders or the drawer crashes open.
  const [honeypot, setHoneypot] = useState('');

  // Shared delivery location (React state only — never persisted, never
  // logged). Cleared when the cart closes/clears or after an order is sent.
  // Detection + picking live in the LocationPicker sheet below.
  // Shared delivery location: restored from the remembered pin (same
  // lifetime as "remember my details") so a repeat order sends the exact
  // same validated pin without re-picking. Text + pin travel as a pair —
  // editing the address by hand drops the pin (see the address field).
  // Detection + picking live in the LocationPicker sheet below.
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(() => {
    try {
      return loadPinnedLocation();
    } catch {
      return null;
    }
  });
  const [locSheetOpen, setLocSheetOpen] = useState(false);
  // Last address WE auto-filled from the picker (or the coords fallback).
  // A re-pin overwrites the field only when it is empty or still holds our
  // own previous auto-fill — genuinely typed text (building, floor,
  // landmark) is never destroyed. Without this, a first wrong auto-fill
  // (coarse fix) stuck forever: the field was non-empty so later correct
  // picks were ignored — the "address is wrong" bug.
  // Repeat-order fix: a remembered address paired with a remembered pin IS
  // our previous auto-fill, not typed text. A fresh mount starts with
  // lastAutoFill=null and would misclassify it as typed, keeping a stale
  // address with a fresh pin (exact-pin Telegram link points at the new
  // coords while the ticket shows the old street — the reported WRONG pin).
  // Seeding the ref from the remembered pair makes the first re-pin
  // overwrite correctly. Unpaired typed text (no pin) still starts null.
  const lastAutoFillRef = useRef<string | null>((() => {
    try {
      if (!loadPinnedLocation()) return null;
      const rem = loadRememberedDetails();
      const a = rem && typeof (rem as { address?: unknown }).address === 'string'
        ? (rem as { address: string }).address.trim().slice(0, 200)
        : '';
      return a || null;
    } catch {
      return null;
    }
  })());
  // Accuracy gate shared with Telegram (mirrors MAPS_ACCURACY_OK_M = 250 in
  // functions/_shared/telegram.js): a coarse cell-tower fix must never ride
  // as an "exact pin" — it falls back to the address-query link.
  const PIN_ACCURACY_OK_M = 250;
  // State-only clear. Storage is the remembered pair and is synced atomically
  // on submit (see sendOrder) so a pick without a submit, a sheet dismiss,
  // or a drawer close can never strand a new pin against an old address.
  const clearLocation = () => {
    setLocation(null);
  };
  // Dismissing the sheet without confirming leaves the parent pair untouched:
  // the unconfirmed point lives only in picker state, so there is nothing to
  // wipe — wiping here used to destroy the saved pin on a mere view.
  const closeLocSheet = (_keep: boolean) => { setLocSheetOpen(false); };
  const handleMapPick = (lat: number, lng: number, accuracy: number, addressText: string | null) => {
    setLocation({ lat, lng, accuracy });
    const fill = addressText && addressText.trim() ? addressText.trim().slice(0, 200) : `${lat}, ${lng}`;
    const prevFill = lastAutoFillRef.current;
    lastAutoFillRef.current = fill;
    setCustomer((prev) => {
      // Pure rule (see shouldOverwriteAddress): empty / our previous
      // auto-fill (including the seeded remembered pair) / coords fallback
      // refresh so a wrong auto-fill never sticks; genuinely typed text
      // (building, floor, landmark) is kept with the fresh pin.
      if (shouldOverwriteAddress(prev.address, prevFill)) return { ...prev, address: fill };
      return prev;
    });
    setLocSheetOpen(false);
  };

  // Clear customer-facing answer: how far is the pinned point from the
  // restaurant (parsed from the saved Google Maps URL). Null when unknown —
  // and hidden past the plausibility ceiling (a test pin or stale link must
  // never print hundreds of kilometres).
  const restaurantCoords = parseMapUrlCoords(menu.settings.mapUrl);
  const distanceMeters = location && restaurantCoords
    ? haversineMeters(location.lat, location.lng, restaurantCoords.lat, restaurantCoords.lng)
    : NaN;
  const distanceText = Number.isFinite(distanceMeters) && distanceMeters >= 0 && distanceMeters <= MAX_DELIVERY_DISTANCE_KM * 1000
    ? formatDistance(distanceMeters, lang)
    : null;
  // Out-of-zone heads-up (never a blocker): a pin past the plausibility
  // ceiling gets an honest warning instead of a made-up delivery time.
  const distanceWarning = location && restaurantCoords && Number.isFinite(distanceMeters) && distanceMeters > MAX_DELIVERY_DISTANCE_KM * 1000
    ? (isAr
      ? `عنوانك على بعد ${formatDistance(distanceMeters, lang)} من المطعم — خارج نطاق التوصيل المعتاد. اتصل بنا قبل إتمام الطلب.`
      : `Your address is ${formatDistance(distanceMeters, lang)} from the restaurant — outside the usual delivery zone. Call us before ordering.`)
    : null;

  // Stable idempotency key for this drawer session: retries reuse it so
  // they never create a duplicate order; it resets when the drawer closes
  // so the next checkout is a new order.
  const idemKeyRef = useRef<string | null>(null);

  // In-flight guard (ref = synchronous, state = button skin): double-taps
  // while the first POST is still running are ignored, so concurrent
  // same-key submits can never race each other.
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

  const subtotal = lines.reduce((acc, l) => acc + l.total, 0);
  const liveState = resolveLiveOrdering(orderingState, menu, serverNow());
  const orderBlocked = liveState.state !== 'open';
  const blockedMsg = liveState.message[lang] || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable');
  // Live resume countdown (same instant the admin panel counts to): ticks
  // every second while paused so the customer view stays in lockstep, and
  // flips to open in the same second the deadline passes.
  const pausedDeadline = liveState.state === 'paused' && typeof liveState.reopensAt === 'string'
    ? Date.parse(liveState.reopensAt)
    : NaN;
  const pausedLive = Number.isFinite(pausedDeadline) && pausedDeadline > serverNow();
  // Server clock (not the device clock): the deadline is a server ISO
  // instant, so a wrong phone clock must not skew the countdown.
  const [nowMs, setNowMs] = useState(() => serverNow());
  useEffect(() => {
    if (!pausedLive) return;
    const id = window.setInterval(() => setNowMs(serverNow()), 1000);
    return () => window.clearInterval(id);
  }, [pausedLive]);
  let reopenText = '';
  // Paused messages carry no time, so append the live countdown. Closed
  // defaults already include the opening time — appending it again would
  // duplicate it.
  if (pausedLive) {
    reopenText = isAr
      ? `· يستأنف بعد ${formatMMSS(pausedDeadline - nowMs)}`
      : `· resumes in ${formatMMSS(pausedDeadline - nowMs)}`;
  }
  const minActive = !!ordering.minOrderEnabled;
  const feeActive = !!ordering.deliveryFeeEnabled;
  const deliveryFee = feeActive ? round2(Number(ordering.deliveryFee) || 0) : 0;
  const grandTotal = subtotal + deliveryFee;
  const isBelowMin = minActive && ordering.minOrder > 0 && subtotal < ordering.minOrder;
  const minOrder = ordering.minOrder;

  const sendOrder = async () => {
    setErrorMsg('');

    // Submit-time availability check: ask the server first (2.5 s timeout).
    // A non-open answer stops everything here. When the call fails, fall
    // back to the last known menu state (fail open).
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2500);
      const st = await fetchOrderingStatus(controller.signal);
      window.clearTimeout(timer);
      if (st) {
        if (st.state === 'paused' || st.state === 'closed' || st.state === 'disabled') {
          const msg = (isAr ? st.message.ar : st.message.en) || '';
          setErrorMsg(msg || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable'));
          return;
        }
      } else {
        const known = resolveLiveOrdering(orderingState, menu, serverNow());
        if (known.state !== 'open') {
          const msg = known.message[lang];
          setErrorMsg(msg || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable'));
          return;
        }
      }
    } catch {
      const known = resolveLiveOrdering(orderingState, menu, serverNow());
      if (known.state !== 'open') {
        const msg = known.message[lang];
        setErrorMsg(msg || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable'));
        return;
      }
    }

    // Strict customer validation — mirrors the server (validateOrderInput)
    // EXACTLY, so a bad field can never "still send": name 2+ chars,
    // phone 6–15 digits, delivery address required. Anything else stops
    // here with a specific message.
    if (customer.name.trim().length < 2) {
      setErrorMsg(isAr ? 'يرجى إدخال الاسم (حرفان على الأقل)' : 'Please enter your name (2+ characters)');
      return;
    }
    const phoneDigits = phoneDigitsOnly(customer.phone);
    if (phoneDigits.length < 6 || phoneDigits.length > 15) {
      setErrorMsg(isAr ? 'رقم الهاتف يجب أن يكون من 6 إلى 15 رقمًا (أرقام فقط)' : 'Phone must be 6–15 digits (numbers only)');
      return;
    }
    if (!customer.address.trim()) {
      setErrorMsg(isAr ? 'يرجى إدخال عنوان التوصيل بالتفصيل' : 'Please enter delivery address');
      return;
    }
    if (isBelowMin) {
      setErrorMsg(
        isAr
          ? `الحد الأدنى للطلب هو ${formatPrice(ordering.minOrder, currency)}`
          : `Minimum order is ${formatPrice(ordering.minOrder, currency)}`
      );
      return;
    }

    // Save remember details (checked = persist, unchecked = erase).
    // The pin + address travel as ONE atomic pair: storage is synced here
    // (not at pick time) so a pick without a submit, a sheet dismiss, or a
    // drawer close can never strand a new pin against an old address in
    // localStorage. Coarse fixes (>250m) are never persisted — they ride as
    // an address-query fallback, never as a fake "exact" pin.
    saveRememberedDetails(customer);
    const sendableLocation = location && location.accuracy <= PIN_ACCURACY_OK_M ? location : null;
    if (!customer.remember) {
      try {
        savePinnedLocation(null);
      } catch {}
    } else if (sendableLocation) {
      try {
        savePinnedLocation(sendableLocation);
      } catch {}
    } else {
      // Remembered but cleared/coarse this order: forget the stale pin so
      // the next repeat cannot re-send it with the new address text.
      try {
        savePinnedLocation(null);
      } catch {}
    }

    // Record the order on the server. Transport lives in
    // features/cart/services/cart.api.ts (single place).
    try {
      if (!idemKeyRef.current) {
        idemKeyRef.current =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      const result = await submitOrder(
        {
          idemKey: idemKeyRef.current,
          type: 'delivery',
          customer: {
            name: customer.name.trim(),
            phone: customer.phone.trim(),
            address: customer.address.trim(),
          },
          notes: customer.notes.trim(),
          items: lines.map((l) => ({
            id: l.item.id,
            ...(l.variantId ? { variantId: l.variantId } : {}),
            ...(l.addonIds.length ? { addonIds: l.addonIds } : {}),
            // Split lines only: ResolvedCartLine carries addonQty exactly
            // when the counts are non-trivial (the cart hook canonicalizes
            // trivial all-full maps back to the legacy shape), so legacy
            // lines keep their exact payload byte-shape.
            ...(l.addonQty && Object.keys(l.addonQty).length ? { addonQty: { ...l.addonQty } } : {}),
            qty: l.quantity,
          })),
          ...(sendableLocation ? { location: { lat: sendableLocation.lat, lng: sendableLocation.lng, accuracy: Math.round(sendableLocation.accuracy) } } : {}),
          lang,
          website: honeypot,
        },
        lang
      );
      if (result.blockedMessage) {
        // Server-side availability gate (paused/closed/disabled): show the
        // message and stop here.
        setErrorMsg(result.blockedMessage || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable'));
        return;
      }
      if (result.failure === 'timeout' || result.failure === 'invalid') {
        // Fail-open ordering: the order may still be saved below, but the
        // customer sees exactly why it carries no number — and the code
        // in caps is the machine cause for remote diagnosis. A retry reuses
        // the same idempotency key, so it can never double-record.
        setErrorMsg(
          result.failure === 'timeout'
          ? (isAr ? 'انقطع الاتصال أثناء الإرسال — قد يكون طلبك محفوظًا: تحقق من الداشبورد قبل إعادة المحاولة' : 'Connection dropped while sending — your order may be saved: check the dashboard before retrying')
          : (isAr ? 'رفض السيرفر الطلب — حدّث الصفحة وحاول مجددًا' : 'Server rejected the order — refresh and try again')
        );
      }
      if (result.orderNumber) {
        setLastOrder({ number: result.orderNumber, trackToken: result.trackToken ?? null });
        // Shelf for the floating bell (12h, this device only). Needs the
        // token to fetch status / confirm receipt later.
        if (result.trackToken) saveCustomerOrder(result.orderNumber, result.trackToken);
      }
    } catch {}

    // In-site ordering: the saved server record IS the order — Telegram
    // pings the owner automatically, so the customer never leaves the site.
    // Preserve the validated pair for repeat orders when remembered; forget
    // the transient pick when not.
    if (!customer.remember) clearLocation();
    // Talabat/Elmenus standard: the order is placed, so the cart empties
    // now — otherwise the next visit re-sends a duplicate. Runs only on
    // the success path (validation/availability gates above return early).
    // State clear re-persists via the cart hook's effect.
    if (clientConfig.cart?.clearAfterOrder) onOrderSuccess?.();
    setOrderPrepared(true);
  };

  // Guarded entry: concurrent taps collapse into the single in-flight send.
  const handleSendOrder = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await sendOrder();
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return {
    customer,
    setCustomer,
    honeypot,
    setHoneypot,
    location,
    locSheetOpen,
    setLocSheetOpen,
    clearLocation,
    closeLocSheet,
    handleMapPick,
    distanceText,
    distanceWarning,
    subtotal,
    deliveryFee,
    grandTotal,
    minActive,
    feeActive,
    isBelowMin,
    minOrder,
    liveState,
    orderBlocked,
    blockedMsg,
    reopenText,
    orderPrepared,
    setOrderPrepared,
    lastOrder,
    setLastOrder,
    errorMsg,
    setErrorMsg,
    idemKeyRef,
    sending,
    handleSendOrder,
  };
}
