import { useState, useEffect, useRef } from 'react';
import { MenuData, CustomerDetails, ResolvedCartLine } from '@/src/types/menu';
import { MAX_DELIVERY_DISTANCE_KM, haversineMeters, parseMapUrlCoords, formatDistance } from '@/src/utils/menuHelpers';
import { resolveDeliveryFee } from '@/src/utils/deliveryFees';
import { formatPrice } from '@/src/utils/pricing';
import { serverNow } from '@/src/utils/serverTime';
import { fetchOrderingStatus, type OrderingStatus } from '@/src/utils/status';
import { checkPhone, dialFromSettings } from '@/src/utils/phoneCountry';
import { loadRememberedDetails, loadSavedEmail, saveCustomerOrder, saveEmailAddress, saveRememberedDetails, withoutAddress } from '@/src/utils/customerOrders';
import { pinAddress } from './useMidSplitLocationMap';
import { resolveLiveOrdering } from '@/src/utils/ordering';
import { formatMMSS } from '@/src/utils/countdown';
import { clientConfig } from '@/src/config/client.config';
import { AUTH_STR, isProfileComplete } from '@/src/features/auth';
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
  accountProfile?: { phone: string | null; address: string | null; location?: { lat: number; lng: number; accuracy: number } | null } | null;
  /** Session/profile still loading — don't treat a pending member as a guest. */
  accountLoading?: boolean;
  /** Opens the signup sheet when cash-on-delivery needs an account. */
  onRequireAccount?: () => void;
  /** Opens account settings when the mandatory profile is incomplete. */
  onRequireProfile?: () => void;
}

export function useCartCheckoutSubmit({ menu, lines, lang, currency, orderingState, onOrderSuccess, accountUser, accountProfile, accountLoading = false, onRequireAccount, onRequireProfile }: UseCartCheckoutSubmitArgs) {
  const isAr = lang === 'ar';
  const ordering = menu.settings.ordering;
  const phoneDial = dialFromSettings(menu.settings);

  // Retrieve remembered customer details if available (delivery only).
  // Prefill is independent from consent: the box checks only when the saved
  // record carries an explicit `remember: true` from the current opt-in. A
  // legacy record can prefill name/phone but never checks itself.
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
  // logged). Members may start from their saved default pin once; guests
  // start pin-less. The device "remember me" blob never restores a pin, so a
  // stale pin from another visit/city cannot ride along silently. Pinning is
  // OPTIONAL at checkout — a typed address alone is enough; a fresh pin is a
  // precision bonus (exact Telegram link, distance-based fee). Clearing the
  // pin is respected until the profile pin changes. Text + pin travel as a
  // pair: typing refines the address but keeps the pin (explicit X removes
  // it).
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locSheetOpen, setLocSheetOpen] = useState(false);

  // A signed-in member's account is the source of truth for identity
  // (name/phone/email) and for the starting delivery defaults. The device
  // "remember me" blob is guest data and must never override it. This runs
  // when the profile values change, so account-settings edits land here
  // without a reload; a per-order address/pin edit remains intact until the
  // next profile change.
  const memberProfileKeyRef = useRef('');
  const memberIdentitySeenRef = useRef(false);
  useEffect(() => {
    if (!accountUser) {
      // Signing out must not leave the member's name/phone/address in a
      // guest checkout on a shared device. The initial guest render never
      // enters this branch with a seen member, so remembered guest details
      // are preserved.
      if (memberIdentitySeenRef.current) {
        memberIdentitySeenRef.current = false;
        memberProfileKeyRef.current = '';
        setCustomer((prev) => ({ ...prev, name: '', phone: '', address: '', email: '', remember: false }));
        setLocation(null);
      }
      return;
    }
    memberIdentitySeenRef.current = true;
    const saved = accountProfile?.location;
    const key = [
      accountUser.id,
      accountUser.name,
      accountUser.email,
      accountProfile?.phone ?? '',
      accountProfile?.address ?? '',
      saved?.lat ?? '',
      saved?.lng ?? '',
      saved?.accuracy ?? '',
    ].join('|');
    if (memberProfileKeyRef.current === key) return;
    memberProfileKeyRef.current = key;
    setCustomer((prev) => ({
      ...prev,
      name: accountUser.name || prev.name,
      phone: accountProfile?.phone || '',
      address: accountProfile?.address || '',
      email: accountUser.email || '',
      // Members now get the same device opt-in as guests. Their identity
      // still comes from the account; the flag persists device-side extras
      // (e.g. special instructions) and the checkbox state. Address stays
      // fresh every order by design.
      remember: prev.remember || false,
    }));
    setLocation(saved ? { lat: saved.lat, lng: saved.lng, accuracy: saved.accuracy ?? 0 } : null);
  }, [
    accountUser?.id,
    accountUser?.name,
    accountUser?.email,
    accountProfile?.phone,
    accountProfile?.address,
    accountProfile?.location?.lat,
    accountProfile?.location?.lng,
    accountProfile?.location?.accuracy,
  ]);
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
  // A confirmed pick always owns the address. Typing after the pin is kept
  // for that pin, but the next pick replaces the text with the new pin's
  // reverse geocode (or coords when geocoding fails) — a manual address from
  // a previous location must never ride with fresh coordinates.
  // State-only clear. Storage is the remembered pair and is synced atomically
  // on submit (see sendOrder) so a pick without a submit, a sheet dismiss,
  // or a drawer close can never strand a new pin against an old address.
  const clearLocation = () => {
    setLocation(null);
  };
  // Dismissing the sheet without confirming leaves the parent pair untouched:
  // the unconfirmed point lives only in picker state, so there is nothing to
  // wipe — wiping here used to destroy the saved pin on a mere view.
  const closeLocSheet = (_keep: boolean) => { void _keep; setLocSheetOpen(false); };
  const handleMapPick = (lat: number, lng: number, accuracy: number, addressText: string | null) => {
    setLocation({ lat, lng, accuracy });
    const fill = pinAddress(lat, lng, addressText);
    setCustomer((prev) => ({ ...prev, address: fill }));
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
      ? `على بعد ${formatDistance(distanceMeters, lang)} — خارج نطاق التوصيل المعتاد. تواصل معنا قبل الطلب.`
      : `${formatDistance(distanceMeters, lang)} away — outside our usual delivery zone. Contact us first.`)
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
  // Free-delivery celebration only. The distance is stated once in the
  // pinned-location card; repeating it under the fee line read as a second,
  // redundant message (owner feedback).
  const feeDetail = !feeActive
    ? null
    : feeQuote.freeApplied
      ? (isAr ? `توصيل مجاني للطلبات التي تتجاوز ${formatPrice(ordering.freeDeliveryMin ?? 0, currency)}` : `Free delivery over ${formatPrice(ordering.freeDeliveryMin ?? 0, currency)}`)
      : null;
  const grandTotal = subtotal + deliveryFee;
  const isBelowMin = minActive && ordering.minOrder > 0 && subtotal < ordering.minOrder;
  const minOrder = ordering.minOrder;

  const sendOrder = async () => {
    setErrorMsg('');

    // Cash on delivery now requires a registered account (the owner's rule).
    // The same rule is enforced server-side; this gate keeps the UX clear and
    // opens the signup sheet in-place without losing the cart.
    if (!accountUser) {
      if (accountLoading) {
        setErrorMsg(isAr ? 'جارٍ التحقق من حسابك — لحظة واحدة ثم حاول مجددًا' : 'Checking your account — one moment, then try again');
        return;
      }
      setErrorMsg(
        isAr
          ? 'الدفع عند الاستلام متاح لحسابات المسجلة فقط. أنشئ حسابًا لإتمام طلبك.'
          : 'Cash on delivery is available to registered accounts. Create an account to place your order.'
      );
      onRequireAccount?.();
      return;
    }

    // Mandatory member profile (owner rule, server-enforced): phone, default
    // address and its map pin must exist before any order. Google accounts
    // go through the same gate. Opening Settings over the cart keeps the
    // basket intact.
    if (accountLoading) {
      setErrorMsg(isAr ? 'جارٍ التحقق من بيانات حسابك — لحظة واحدة ثم حاول مجددًا' : 'Checking your account details — one moment, then try again');
      return;
    }
    if (!isProfileComplete(accountProfile)) {
      setErrorMsg(AUTH_STR[lang].profileIncompleteOrder);
      onRequireProfile?.();
      return;
    }

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
    // with one extra gate: the phone must belong to the restaurant's country
    // (admin WhatsApp picker). Name 2+ chars, delivery address required,
    // phone 6–15 digits and matching dial code. Anything else stops here with
    // a specific message.
    if (customer.name.trim().length < 2) {
      setErrorMsg(isAr ? 'يرجى إدخال الاسم (حرفان على الأقل)' : 'Please enter your name (2+ characters)');
      return;
    }
    const phoneCheck = checkPhone(customer.phone, phoneDial.code);
    if (!phoneCheck.ok) {
      setErrorMsg(
        phoneCheck.reason === 'country'
          ? (isAr
            ? `رقم الهاتف غير مدعوم. نقبل أرقام +${phoneDial.code} فقط.`
            : `This phone number isn’t supported. Use a +${phoneDial.code} number.`)
          : (isAr
            ? 'رقم الهاتف يجب أن يكون من 6 إلى 15 رقمًا (أرقام فقط)'
            : 'Phone must be 6–15 digits (numbers only)')
      );
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

    // Save remember details (checked = persist, unchecked = erase). The
    // device opt-in is available to guests AND signed-in members; the pin is
    // never persisted, and withoutAddress() still drops the delivery address
    // so a stale address from another visit can never ride along.
    saveRememberedDetails(
      withoutAddress({ ...customerToSave, remember: customerToSave.remember })
    );

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
            phone: phoneCheck.normalized,
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
      if (result.failure === 'profile') {
        // Server-side profile gate (defense in depth): the client may hold a
        // stale complete profile. Show why and open Settings over the cart.
        setErrorMsg(result.blockedMessage || AUTH_STR[lang].profileIncompleteOrder);
        onRequireProfile?.();
        return;
      }
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
