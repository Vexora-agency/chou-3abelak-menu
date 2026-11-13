import { useState, useEffect, useRef } from 'react';
import { MenuData, CustomerDetails, ResolvedCartLine } from '@/src/types/menu';
import { MAX_DELIVERY_DISTANCE_KM, haversineMeters, parseMapUrlCoords, formatDistance } from '@/src/utils/menuHelpers';
import { resolveDeliveryFee } from '@/src/utils/deliveryFees';
import { formatPrice } from '@/src/utils/pricing';
import { serverNow } from '@/src/utils/serverTime';
import { fetchOrderingStatus, type OrderingStatus } from '@/src/utils/status';
import { phoneDigitsOnly } from '@/src/utils/digits';
import { loadRememberedDetails, loadSavedEmail, saveCustomerOrder, saveEmailAddress, saveRememberedDetails, withoutAddress } from '@/src/utils/customerOrders';
import { shouldOverwriteAddress } from './useMidSplitLocationMap';
import { resolveLiveOrdering } from '@/src/utils/ordering';
import { formatMMSS } from '@/src/utils/countdown';
import { clientConfig } from '@/src/config/client.config';
import { submitOrder } from '../services/cart.api';
import { useDeliveryZoneCheck } from './useDeliveryZoneCheck';

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
  /** Signed-in customer, used only to prefill empty checkout fields. */
  accountUser?: { id: string; name: string; email: string } | null;
  accountProfile?: { phone: string | null; address: string | null } | null;
}

export function useCartCheckoutSubmit({ menu, lines, lang, currency, orderingState, onOrderSuccess, accountUser, accountProfile }: UseCartCheckoutSubmitArgs) {
  const isAr = lang === 'ar';
  const ordering = menu.settings.ordering;

  // Retrieve remembered customer details if available (delivery only).
  // A saved record means the box was checked, so it loads checked —
  // the box stays on until the customer unchecks it themself.
  // The delivery address is NEVER remembered (fresh every order by design):
  // it is dropped on load even from legacy blobs, and never stored on save.
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
    const merged: CustomerDetails = remembered
      ? { ...base, ...(remembered as Partial<CustomerDetails>) }
      : { ...base };
    merged.address = '';
    // Smart email prefill: the standalone email memory survives even when
    // "remember my details" was never checked (legacy blobs carry no email).
    if (!merged.email) {
      try {
        const solo = loadSavedEmail();
        if (solo) merged.email = solo;
      } catch {}
    }
    return merged;
  });

  // Signed-in profile: fill only EMPTY checkout fields once the profile
  // arrives. Typed values are never overwritten, and the address is still
  // editable per order. This is server-side profile data, not the device
  // "remember me" blob, so it is safe to prefill across devices.
  useEffect(() => {
    if (!accountUser && !accountProfile) return;
    setCustomer((prev) => {
      const next = { ...prev };
      let changed = false;
      if (!prev.name.trim() && accountUser?.name) {
        next.name = accountUser.name;
        changed = true;
      }
      if (!prev.phone.trim() && accountProfile?.phone) {
        next.phone = accountProfile.phone;
        changed = true;
      }
      if (!prev.address.trim() && accountProfile?.address) {
        next.address = accountProfile.address;
        changed = true;
      }
      if (!(prev.email || '').trim() && accountUser?.email) {
        next.email = accountUser.email;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [accountUser?.id, accountUser?.name, accountUser?.email, accountProfile?.phone, accountProfile?.address]);

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
  // logged). Every checkout starts pin-less on purpose, even when "remember
  // my details" is checked: a remembered pin is never restored, so a stale
  // pin from another visit/city can never ride along silently. Pinning is
  // OPTIONAL — a typed address alone is enough to order; a fresh pin is a
  // precision bonus (exact Telegram link, distance-based fee). Cleared when
  // the cart closes/clears or after an order is sent.
  // Text + pin travel as a pair: typing refines the address but keeps the
  // pin (explicit X removes it).
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locSheetOpen, setLocSheetOpen] = useState(false);
  // Delivery-zone gate: resolves the pin to country/subdivision (BigDataCloud
  // client-side reverse-geocode, fail-soft) and hard-blocks delivery pins
  // outside the admin's selected zones. Pickup/dinein unaffected (this
  // drawer is delivery-only, but the hook keeps the orderType gate anyway).
  const zoneCheck = useDeliveryZoneCheck(
    ordering.deliveryZones,
    'delivery',
    location,
    lang,
  );
  const zoneBlocked = zoneCheck.status === 'outside';
  // A re-pin overwrites the field only when it is empty or still holds our
  // own previous auto-fill — genuinely typed text (building, floor,
  // landmark) is never destroyed. Without this, a first wrong auto-fill
  // (coarse fix) stuck forever: the field was non-empty so later correct
  // picks were ignored — the "address is wrong" bug.
  // No remembered-address seeding: the address is never stored, so every
  // mount starts with a blank field. A re-pin overwrites it only while it
  // is empty or a previous auto-fill/coords fallback — genuinely typed text
  // (building, floor, landmark) is never destroyed. This keeps pin and
  // address from ever disagreeing on the ticket.
  const lastAutoFillRef = useRef<string | null>(null);
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
      ? `عنوانك على بعد ${formatDistance(distanceMeters, lang)} من المطعم — خارج نطاق التوصيل المعتاد. تواصل معنا قبل إتمام الطلب.`
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
      ? `· تُستأنف الطلبات بعد ${formatMMSS(pausedDeadline - nowMs)}`
      : `· resumes in ${formatMMSS(pausedDeadline - nowMs)}`;
  }
  const minActive = !!ordering.minOrderEnabled;
  const feeActive = !!ordering.deliveryFeeEnabled;
  // Smart fee: authoritative quote from the pin distance (server recomputes
  // the same from the trusted pin — the client number is display-only).
  const distanceKm = Number.isFinite(distanceMeters) && distanceMeters >= 0
    ? distanceMeters / 1000
    : null;
  const feeQuote = resolveDeliveryFee(ordering, location ? distanceKm : null, subtotal);
  const deliveryFee = feeActive ? feeQuote.fee : 0;
  const feeDetail = !feeActive
    ? null
    : feeQuote.freeApplied
      ? (isAr ? `توصيل مجاني للطلبات التي تتجاوز ${formatPrice(ordering.freeDeliveryMin ?? 0, currency)}` : `Free delivery over ${formatPrice(ordering.freeDeliveryMin ?? 0, currency)}`)
      : feeQuote.distanceKm !== null && ordering.deliveryFeeMode === 'distance'
        ? (isAr ? `على بعد ${formatDistance(distanceMeters, lang)}` : `${formatDistance(distanceMeters, lang)} away`)
        : null;
  const grandTotal = subtotal + deliveryFee;
  const isBelowMin = minActive && ordering.minOrder > 0 && subtotal < ordering.minOrder;
  const minOrder = ordering.minOrder;

  const sendOrder = async () => {
    setErrorMsg('');

    // Payments kill-switch: COD is the only method, so a disabled COD means
    // there is no way to pay — refuse before any validation or network use.
    if (menu.settings.payments?.codEnabled === false) {
      setErrorMsg(isAr ? 'الدفع غير متاح حاليًا — تواصل معنا لإتمام طلبك' : 'Payment is currently unavailable — please contact us to place your order');
      return;
    }

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
    // Pin is OPTIONAL (manual addresses allowed): a typed delivery address
    // alone is enough. A present pin sharpens the ticket (exact Telegram
    // link, distance-based fee); coarse fixes are degraded downstream,
    // never blocking. A malformed pin state (non-finite) is ignored, not
    // fatal — the order rides on the address text.
    if (location && (!Number.isFinite(location.lat) || !Number.isFinite(location.lng))) {
      clearLocation();
    }
    // Delivery-zone hard block (selected zones only): the pin resolved
    // outside the served area. Same copy as the on-screen panel.
    if (zoneBlocked) {
      setErrorMsg(isAr ? 'موقعك خارج نطاق التوصيل حاليًا، تواصل معنا' : 'Your location isn’t in our delivery area right now — contact us.');
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

    // Optional order-status email: trimmed + lowercased, sent/stored only
    // when it matches the ReportsPanel pattern; empty or invalid is dropped
    // silently (never blocks the order).
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const emailRaw = typeof customer.email === 'string' ? customer.email.trim().toLowerCase() : '';
    const validEmail = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw : '';
    // Standalone email memory: saved on every submit, independent of the
    // remember-me checkbox, so next visit pre-fills it automatically.
    if (validEmail) {
      try {
        saveEmailAddress(validEmail);
      } catch {}
    }
    const customerToSave = validEmail
      ? { ...customer, email: validEmail }
      : (() => {
          const { email: _omit, ...rest } = customer as CustomerDetails & { email?: string };
          void _omit;
          return rest;
        })();

    // Save remember details (checked = persist, unchecked = erase). The pin
    // is deliberately NEVER persisted, so no stale pin can ever ride along.
    // Same for the delivery address: withoutAddress() drops it (old blobs
    // keep their field but it is ignored on load above).
    saveRememberedDetails(withoutAddress(customerToSave));

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
          paymentMethod: 'cod',
          customer: {
            name: customer.name.trim(),
            phone: customer.phone.trim(),
            address: customer.address.trim(),
            ...(validEmail ? { email: validEmail } : {}),
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
        // The pin rides along only when present (optional): the server
        // degrades coarse fixes to the address-query fallback instead of a
        // fake "exact" pin, and address-only orders store no coords.
        ...(location ? { location: { lat: location.lat, lng: location.lng, accuracy: Math.round(location.accuracy) } } : {}),
        // Zone claim for the server-side gate: resolved country (+
        // subdivision when known). Omit when unresolved — the server
        // falls back to the distance backstop alone.
        ...(zoneCheck.pin ? { zone: { cc: zoneCheck.pin.cc, subCode: zoneCheck.pin.subCode, subName: zoneCheck.pin.subName } } : {}),
        lang,
        website: honeypot,
        },
        lang
      );
      if (result.failure === 'blocked') {
        // Server-side availability gate (paused/closed/disabled): show the
        // message and stop here — never a clean confirmation without a
        // tracking number, and the cart stays intact for later.
        setErrorMsg(result.blockedMessage || (isAr ? 'الطلب غير متاح حاليًا — تواصل معنا' : 'Ordering is currently unavailable — please contact us'));
        return;
      }
      if (result.failure === 'timeout' || result.failure === 'invalid') {
        // Transport/server rejection with no order number: stay on the form
        // with the cart intact so the customer can retry. The retry reuses
        // the same idempotency key, so it can never double-record — if the
        // first attempt was actually saved, the retry resolves to it.
        setErrorMsg(
          result.failure === 'timeout'
          ? (isAr ? 'انقطع الاتصال أثناء الإرسال — قد يكون طلبك محفوظًا: تحقق من صفحة التتبع قبل إعادة المحاولة' : 'Connection dropped while sending — your order may be saved: check the dashboard before retrying')
          : (isAr ? 'تعذّر إرسال الطلب — حدّث الصفحة وحاول مجددًا' : 'Server rejected the order — refresh and try again')
        );
        return;
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
    feeDetail,
    feeFreeApplied: feeQuote.freeApplied,
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
    zoneBlocked,
    zoneStatus: zoneCheck.status,
    zonePlaceName: zoneCheck.placeName,
  };
}
