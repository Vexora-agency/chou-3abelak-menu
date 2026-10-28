import { useState, useRef } from 'react';
import { MenuData, CustomerDetails, ResolvedCartLine } from '@/src/types/menu';
import { buildWhatsAppMessage, haversineMeters, parseMapUrlCoords, formatDistance } from '@/src/utils/menuHelpers';
import { formatPrice, round2 } from '@/src/utils/pricing';
import { serverNow } from '@/src/utils/serverTime';
import { getOrderingState, fetchOrderingStatus, type OrderingStatus } from '@/src/utils/status';
import { submitOrder } from '@/src/features/cart/services/cart.api';

interface UseCartCheckoutSubmitArgs {
  menu: MenuData;
  lines: ResolvedCartLine[];
  lang: 'en' | 'ar';
  currency: string;
  orderingState?: OrderingStatus | null;
}

export function useCartCheckoutSubmit({ menu, lines, lang, currency, orderingState }: UseCartCheckoutSubmitArgs) {
  const isAr = lang === 'ar';
  const ordering = menu.settings.ordering;

  // Retrieve remembered customer details if available (delivery only)
  const [customer, setCustomer] = useState<CustomerDetails>(() => {
    try {
      const saved = localStorage.getItem('customer_details_v1');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<CustomerDetails>;
        return {
          name: '',
          phone: '',
          address: '',
          tableNumber: '',
          notes: '',
          ...parsed,
          orderType: 'delivery' as const,
          remember: false,
        };
      }
    } catch {}
    return {
      name: '',
      phone: '',
      address: '',
      tableNumber: '',
      notes: '',
      orderType: 'delivery',
      remember: false,
    };
  });

  const [orderPrepared, setOrderPrepared] = useState(false);
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

  const subtotal = lines.reduce((acc, l) => acc + l.total, 0);
  const liveState = orderingState ?? getOrderingState(menu.settings, serverNow());
  const orderBlocked = liveState.state !== 'open';
  const blockedMsg = liveState.message[lang] || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable');
  let reopenText = '';
  // Paused messages carry no time, so append it. Closed defaults already
  // include the opening time — appending it again would duplicate it.
  if (liveState.state === 'paused' && liveState.reopensAt) {
    try {
      const tz = menu.settings.timezone || 'Asia/Beirut';
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(liveState.reopensAt));
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      reopenText = isAr ? `· يستأنف ${get('hour')}:${get('minute')}` : `· resumes ${get('hour')}:${get('minute')}`;
    } catch {}
  }
  const minActive = !!ordering.minOrderEnabled;
  const feeActive = !!ordering.deliveryFeeEnabled;
  const deliveryFee = feeActive ? round2(Number(ordering.deliveryFee) || 0) : 0;
  const grandTotal = subtotal + deliveryFee;
  const isBelowMin = minActive && ordering.minOrder > 0 && subtotal < ordering.minOrder;
  const minOrder = ordering.minOrder;

  const handleSendOrder = async () => {
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
        const known = orderingState ?? getOrderingState(menu.settings, serverNow());
        if (known.state !== 'open') {
          const msg = known.message[lang];
          setErrorMsg(msg || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable'));
          return;
        }
      }
    } catch {
      const known = orderingState ?? getOrderingState(menu.settings, serverNow());
      if (known.state !== 'open') {
        const msg = known.message[lang];
        setErrorMsg(msg || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable'));
        return;
      }
    }

    // Validation
    if (!customer.name.trim()) {
      setErrorMsg(isAr ? 'يرجى إدخال اسمك الكريم' : 'Please enter your name');
      return;
    }
    if (!customer.phone.trim()) {
      setErrorMsg(isAr ? 'يرجى إدخال رقم هاتفك للتواصل' : 'Please enter your phone number');
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

    // Save remember details
    try {
      if (customer.remember) {
        localStorage.setItem('customer_details_v1', JSON.stringify(customer));
      } else {
        localStorage.removeItem('customer_details_v1');
      }
    } catch {}

    // Record the order on the server BEFORE opening WhatsApp. Never blocks
    // the WhatsApp flow: any failure still opens WhatsApp immediately.
    // Transport lives in features/cart/services/cart.api.ts (single place).
    let orderNumber: number | null = null;
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
        },
        lang
      );
      if (result.blockedMessage) {
        // Server-side availability gate (paused/closed/disabled): show the
        // message and never open WhatsApp.
        setErrorMsg(result.blockedMessage || (isAr ? 'الطلب غير متاح حالياً' : 'Ordering is currently unavailable'));
        return;
      }
      orderNumber = result.orderNumber;
    } catch {
      orderNumber = null;
    }

    const message = buildWhatsAppMessage(
      menu,
      lines.map((l) => ({ item: l.item, variantId: l.variantId, addonIds: l.addonIds, quantity: l.quantity })),
      customer,
      lang,
      orderNumber,
      location ? { lat: location.lat, lng: location.lng } : null
    );
    const whatsappNum = (menu.settings.whatsapp || '').replace(/[^0-9]/g, '');
    const url = `https://wa.me/${whatsappNum}?text=${encodeURIComponent(message)}`;

    // Open WhatsApp
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.href = url;
    }

    clearLocation();
    setOrderPrepared(true);
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
    errorMsg,
    setErrorMsg,
    idemKeyRef,
    handleSendOrder,
  };
}
