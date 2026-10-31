import { useState, useEffect, useRef } from 'react';
import { MenuData, CustomerDetails, ResolvedCartLine } from '@/src/types/menu';
import { buildWhatsAppMessage, haversineMeters, parseMapUrlCoords, formatDistance } from '@/src/utils/menuHelpers';
import { formatPrice, round2 } from '@/src/utils/pricing';
import { serverNow } from '@/src/utils/serverTime';
import { fetchOrderingStatus, type OrderingStatus } from '@/src/utils/status';
import { phoneDigitsOnly } from '@/src/utils/digits';
import { loadRememberedDetails, saveCustomerOrder, saveRememberedDetails } from '@/src/utils/customerOrders';
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
  /** Called after an order is successfully sent (WhatsApp opened). The
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
  // Cloud API delivered (no wa.me draft exists): confirmation screen variant.
  const [apiSent, setApiSent] = useState(false);
  // Last placed order (number + tracking token) for the confirmation
  // screen: tracking link + push subscribe. Reset when the drawer closes.
  const [lastOrder, setLastOrder] = useState<{ number: number; trackToken: string | null } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // Honeypot state (always empty for real users; bots fill it).
  // NOTE: must stay above the `if (!isOpen)` early return — hooks order
  // must never change between renders or the drawer crashes open.
  const [honeypot, setHoneypot] = useState('');

  // Shared delivery location (React state only — never persisted, never
  // logged). Cleared when the cart closes/clears or after an order is sent.
  // Detection + picking live in the LocationPicker sheet below.
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locSheetOpen, setLocSheetOpen] = useState(false);
  const clearLocation = () => { setLocation(null); };
  const closeLocSheet = (keep: boolean) => { if (!keep) clearLocation(); setLocSheetOpen(false); };
  const handleMapPick = (lat: number, lng: number, accuracy: number, addressText: string | null) => {
    setLocation({ lat, lng, accuracy });
    setCustomer((prev) => {
      if (prev.address.trim()) return prev;
      const fill = addressText && addressText.trim() ? addressText.trim().slice(0, 200) : `${lat}, ${lng}`;
      return { ...prev, address: fill };
    });
    setLocSheetOpen(false);
  };

  // Clear customer-facing answer: how far is the pinned point from the
  // restaurant (parsed from the saved Google Maps URL). Null when unknown.
  const restaurantCoords = parseMapUrlCoords(menu.settings.mapUrl);
  const distanceText = location && restaurantCoords
    ? formatDistance(haversineMeters(location.lat, location.lng, restaurantCoords.lat, restaurantCoords.lng), lang)
    : null;

  // Stable idempotency key for this drawer session: retries ("Re-open
  // WhatsApp") reuse it so they never create a duplicate order; it resets
  // when the drawer closes so the next checkout is a new order.
  const idemKeyRef = useRef<string | null>(null);

  // In-flight guard (ref = synchronous, state = button skin): double-taps
  // while the first POST is still running are ignored, so concurrent
  // same-key submits can never race each other.
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

  // Exact wa.me URL built by the first send. "Re-open WhatsApp" re-opens
  // THIS and never POSTs again — so it can neither record a second order
  // row nor message the kitchen an emptied cart.
  const lastWaUrlRef = useRef<string | null>(null);

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
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!pausedLive) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
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
    // A non-open answer stops everything and WhatsApp never opens. When the
    // call fails, fall back to the last known menu state (fail open).
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
    // here with a specific message and WhatsApp never opens.
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
    saveRememberedDetails(customer);

    // Record the order on the server BEFORE opening WhatsApp. Never blocks
    // the WhatsApp flow: any failure still opens WhatsApp immediately.
    // Transport lives in features/cart/services/cart.api.ts (single place).
    let orderNumber: number | null = null;
    let trackToken: string | null = null;
    let sentVia: 'wa' | 'api' = 'wa';
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
            qty: l.quantity,
          })),
          ...(location ? { location: { lat: location.lat, lng: location.lng, accuracy: Math.round(location.accuracy) } } : {}),
          lang,
          website: honeypot,
          whatsappUpdates: customer.whatsappUpdates === true,
        },
        lang
      );
      if (result.blockedMessage) {
        // Server-side availability gate (paused/closed/disabled): show the
        // message and never open WhatsApp.
        setErrorMsg(result.blockedMessage || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable'));
        return;
      }
      if (result.failure === 'timeout' || result.failure === 'invalid') {
        // The WhatsApp message still opens below (fail-open ordering), but
        // the customer sees exactly why it carries no number — and the code
        // in caps is the machine cause for remote diagnosis.
        setErrorMsg(
          result.failure === 'timeout'
            ? (isAr ? 'انقطع الاتصال أثناء الإرسال (NET-TIMEOUT) — قد يكون طلبك محفوظًا: تحقق من الداشبورد قبل إعادة المحاولة' : 'Connection dropped while sending (NET-TIMEOUT) — your order may be saved: check the dashboard before retrying')
            : (isAr ? 'رفض السيرفر الطلب (SRV-INVALID) — حدّث الصفحة وحاول مجددًا' : 'Server rejected the order (SRV-INVALID) — refresh and try again')
        );
      }
      orderNumber = result.orderNumber;
      trackToken = result.trackToken ?? null;
      sentVia = result.sentVia;
      if (result.orderNumber) {
        setLastOrder({ number: result.orderNumber, trackToken: result.trackToken ?? null });
        // Shelf for the floating bell (48h, this device only). Needs the
        // token to fetch status / confirm receipt later.
        if (result.trackToken) saveCustomerOrder(result.orderNumber, result.trackToken);
      }
    } catch {
      orderNumber = null;
    }

    if (sentVia === 'api' && orderNumber) {
      // Cloud API delivered it: no WhatsApp hop at all. Tracking + updates
      // replace the wa.me draft (see confirmation screen); Re-open stays
      // hidden because there is no draft to reopen.
      setApiSent(true);
      clearLocation();
      if (clientConfig.cart?.clearAfterOrder) onOrderSuccess?.();
      setOrderPrepared(true);
      return;
    }

    // NOTE: trackUrl is deliberately NOT passed: WhatsApp unfurls any URL
    // into a logo/title preview card and the owner wants a clean text-only
    // message. Tracking stays one tap away on the confirmation screen
    // (lastOrder -> Track button). Re-enable by passing trackUrl again —
    // the builder + tests already support it.
    const trackUrl = null;
    const message = buildWhatsAppMessage(
      menu,
      lines.map((l) => ({ item: l.item, variantId: l.variantId, addonIds: l.addonIds, quantity: l.quantity })),
      customer,
      lang,
      orderNumber,
      location ? { lat: location.lat, lng: location.lng } : null,
      distanceText,
      trackUrl
    );
    const whatsappNum = (menu.settings.whatsapp || '').replace(/[^0-9]/g, '');
    if (!whatsappNum) {
      // No restaurant number (settings validation normally prevents this,
      // but legacy data can lack it): the order above IS the record — say so
      // plainly instead of opening a broken wa.me link.
      setErrorMsg(orderNumber
        ? (isAr ? `تم حفظ طلبك #${orderNumber}، لكن رقم واتساب المطعم غير مضبوط — اتصل بالمطعم لتأكيده.` : `Order #${orderNumber} saved, but the restaurant WhatsApp number is missing — please call to confirm.`)
        : (isAr ? 'رقم واتساب المطعم غير مضبوط ولا يمكن فتح المحادثة — اتصل بالمطعم.' : 'Restaurant WhatsApp number is missing — please call the restaurant.'));
      clearLocation();
      if (clientConfig.cart?.clearAfterOrder) onOrderSuccess?.();
      setOrderPrepared(true);
      return;
    }
    const url = `https://wa.me/${whatsappNum}?text=${encodeURIComponent(message)}`;
    lastWaUrlRef.current = url;

    // Open WhatsApp
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.href = url;
    }

    clearLocation();
    // Talabat/Elmenus standard: the order is placed (WhatsApp opened), so
    // the cart empties now — otherwise the next visit re-sends a duplicate.
    // Runs only on the success path (validation/availability gates above
    // return early). State clear re-persists via the cart hook's effect.
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

  // Re-open re-opens the FIRST message only — zero server contact, zero new
  // rows, zero ghost empty messages. Falls back to a fresh send when no
  // message was ever built (e.g. hot-reload wiped the ref).
  const reopenWhatsApp = () => {
    const url = lastWaUrlRef.current;
    if (!url) {
      void handleSendOrder();
      return;
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.href = url;
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
    apiSent,
    setApiSent,
    lastOrder,
    setLastOrder,
    errorMsg,
    setErrorMsg,
    idemKeyRef,
    sending,
    lastWaUrlRef,
    handleSendOrder,
    reopenWhatsApp,
  };
}
