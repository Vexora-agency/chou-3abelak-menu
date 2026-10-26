import { CustomerDetails, MenuData, MenuItem } from '../types/menu';
import { formatPrice as sharedFormatPrice, perUnitPrice, getVariant, featureName, lineMathText, round2 } from './pricing';

export function isOpenNow(settings: MenuData['settings']): { isOpen: boolean; label: { en: string; ar: string } } {
  if (settings.statusMode === 'open') {
    return {
      isOpen: true,
      label: {
        en: `Open now · ${settings.hoursText.en || 'Welcome'}`,
        ar: `مفتوح الآن · ${settings.hoursText.ar || 'أهلاً بكم'}`
      }
    };
  }
  if (settings.statusMode === 'closed') {
    return {
      isOpen: false,
      label: {
        en: 'Closed now',
        ar: 'مغلق حالياً'
      }
    };
  }

  // Auto mode
  try {
    const tz = settings.timezone || 'Asia/Beirut';
    const now = new Date();
    // Current weekday in the restaurant timezone (sat..fri keys)
    let dayKey = '';
    try {
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now).toLowerCase().slice(0, 3);
      const dayMap: Record<string, string> = { sat: 'sat', sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri' };
      dayKey = dayMap[weekday] || '';
    } catch {}
    const workingDays = Array.isArray(settings.workingDays) && settings.workingDays.length
      ? settings.workingDays
      : ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
    if (dayKey && !workingDays.includes(dayKey)) {
      return {
        isOpen: false,
        label: {
          en: `Closed today · Opens ${settings.openTime || '12:00'}`,
          ar: `مغلق اليوم · يفتح ${settings.openTime || '12:00'}`,
        },
      };
    }
    // Get time in target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.format(now).split(':');
    const curHour = parseInt(parts[0], 10);
    const curMin = parseInt(parts[1], 10);
    const curMinutes = curHour * 60 + curMin;

    const [openH, openM] = (settings.openTime || '12:00').split(':').map(Number);
    const [closeH, closeM] = (settings.closeTime || '00:00').split(':').map(Number);

    const openMinutes = openH * 60 + openM;
    let closeMinutes = closeH * 60 + closeM;

    let isOpen = false;
    if (closeMinutes <= openMinutes) {
      // Closes after midnight (e.g. 12:00 to 02:00 or 00:00)
      if (closeMinutes === 0) closeMinutes = 24 * 60;
      isOpen = curMinutes >= openMinutes || curMinutes < (closeMinutes % (24 * 60));
    } else {
      isOpen = curMinutes >= openMinutes && curMinutes < closeMinutes;
    }

    return {
      isOpen,
      label: {
        en: isOpen ? `Open now · ${settings.hoursText.en}` : `Closed · Opens at ${settings.openTime}`,
        ar: isOpen ? `مفتوح الآن · ${settings.hoursText.ar}` : `مغلق · يفتح في ${settings.openTime}`
      }
    };
  } catch {
    return {
      isOpen: true,
      label: {
        en: `Open · ${settings.hoursText.en || '12:00 PM – 12:00 AM'}`,
        ar: `مفتوح · ${settings.hoursText.ar || '12:00 ظهراً – 12:00 صباحاً'}`
      }
    };
  }
}

/**
 * Bilingual text picker with automatic fallback: if the requested language
 * is empty (admin left it blank), the other language is used instead.
 */
export function pickLangText(
  v: { en: string; ar: string } | undefined | null,
  lang: 'en' | 'ar'
): string {
  if (!v) return '';
  const primary = (lang === 'ar' ? v.ar : v.en) || '';
  if (primary.trim()) return primary;
  return (lang === 'ar' ? v.en : v.ar) || '';
}

export function formatPrice(amount: number, currency?: string | { code?: string; decimals?: number }): string {
  return sharedFormatPrice(typeof amount === 'number' && !isNaN(amount) ? amount : 0, currency);
}

export interface WhatsAppLine {
  item: MenuItem;
  variantId?: string;
  addonIds?: string[];
  quantity: number;
}

export function buildWhatsAppMessage(
  menu: MenuData,
  lines: WhatsAppLine[],
  customer: CustomerDetails,
  lang: 'en' | 'ar',
  orderNumber?: number | null,
  location?: { lat: number; lng: number } | null
): string {
  const isAr = lang === 'ar';
  const currency = isAr ? menu.settings.currency.ar : menu.settings.currency.en;
  const storeName = pickLangText(menu.settings.name, lang);

  const header = isAr
    ? `🍔 طلب جديد من ${storeName}`
    : `🍔 New Order from ${storeName}`;
  const numberedHeader =
    typeof orderNumber === 'number'
      ? isAr
        ? `🍔 طلب #${orderNumber} — ${storeName}`
        : `🍔 Order #${orderNumber} — ${storeName}`
      : header;

  const linesOut: string[] = [numberedHeader, '-------------------------'];

  // Same per-line format as the cart: title (name + variant + add-ons),
  // then the math ("3 × 120,000 = 360,000").
  let subtotal = 0;
  for (const line of lines) {
    const { item, quantity } = line;
    if (!item || !Number.isInteger(quantity) || quantity <= 0) continue;
    let unit: number;
    try {
      unit = perUnitPrice(item, { variantId: line.variantId, addonIds: line.addonIds });
    } catch {
      continue;
    }
    const lineTotalValue = quantity * unit;
    subtotal += lineTotalValue;
    const name = pickLangText(item.name, lang);
    const variant = getVariant(item, line.variantId);
    const title = variant ? `${name} (${featureName(menu, line.variantId as string, lang)})` : name;
    const addonNames = (Array.isArray(line.addonIds) ? line.addonIds : [])
      .map((id) => featureName(menu, id, lang));
    const fullTitle = addonNames.length ? `${title} + ${addonNames.join(' + ')}` : title;
    linesOut.push(`${quantity}x ${fullTitle}`);
    linesOut.push(`   ${lineMathText(item, quantity, unit, lang)} ${currency}`);
  }

  linesOut.push('-------------------------');
  linesOut.push(isAr ? `المجموع: ${formatPrice(subtotal, currency)}` : `Subtotal: ${formatPrice(subtotal, currency)}`);

  // Must mirror the server (validateOrderInput) and the cart drawer exactly:
  // the fee applies only when it is enabled AND greater than zero.
  const feeEnabled = !!menu.settings.ordering.deliveryFeeEnabled;
  const fee = feeEnabled ? round2(Number(menu.settings.ordering.deliveryFee) || 0) : 0;
  if (customer.orderType === 'delivery' && fee > 0) {
    linesOut.push(isAr ? `رسوم التوصيل: ${formatPrice(fee, currency)}` : `Delivery Fee: ${formatPrice(fee, currency)}`);
    linesOut.push(isAr ? `الإجمالي النهائي: ${formatPrice(subtotal + fee, currency)}` : `Total: ${formatPrice(subtotal + fee, currency)}`);
  }

  linesOut.push('-------------------------');
  const typeMap = {
    delivery: isAr ? '🛵 توصيل إلى المنزل' : '🛵 Delivery',
    pickup: isAr ? '🛍️ استلام من الفرع' : '🛍️ Takeaway / Pickup',
    dinein: isAr ? '🍽️ تناول في المطعم' : '🍽️ Dine-in'
  };

  linesOut.push(isAr ? `نوع الطلب: ${typeMap[customer.orderType]}` : `Order Type: ${typeMap[customer.orderType]}`);
  if (customer.name.trim()) {
    linesOut.push(isAr ? `الاسم: ${customer.name.trim()}` : `Name: ${customer.name.trim()}`);
  }
  if (customer.phone.trim()) {
    linesOut.push(isAr ? `الهاتف: ${customer.phone.trim()}` : `Phone: ${customer.phone.trim()}`);
  }

  if (customer.orderType === 'delivery' && customer.address.trim()) {
    linesOut.push(isAr ? `العنوان: ${customer.address.trim()}` : `Address: ${customer.address.trim()}`);
  }

  // Shared delivery point: link built ONLY from validated rounded numbers.
  if (customer.orderType === 'delivery' && location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    const link = `https://www.google.com/maps?q=${location.lat},${location.lng}`;
    linesOut.push(isAr ? `الموقع: ${link}` : `Location: ${link}`);
  }

  if (customer.orderType === 'dinein' && customer.tableNumber.trim()) {
    linesOut.push(isAr ? `رقم الطاولة: ${customer.tableNumber.trim()}` : `Table #: ${customer.tableNumber.trim()}`);
  }

  if (customer.notes.trim()) {
    linesOut.push(isAr ? `ملاحظات: ${customer.notes.trim()}` : `Notes: ${customer.notes.trim()}`);
  }

  const orderNote = isAr ? menu.settings.ordering.note?.ar : menu.settings.ordering.note?.en;
  if (orderNote && orderNote.trim()) {
    linesOut.push(`\n📌 ${orderNote.trim()}`);
  }

  const fullMsg = linesOut.join('\n');
  return fullMsg.length > 1400 ? fullMsg.slice(0, 1400) + '...' : fullMsg;
}

export function sanitizeUrl(url: string | undefined): string {
  if (!url) return '#';
  const clean = url.trim();
  if (clean.startsWith('https://') || clean.startsWith('http://') || clean.startsWith('tel:') || clean.startsWith('mailto:')) {
    return clean;
  }
  return '#';
}

// ---- Customer ↔ restaurant distance (a clear customer-facing answer:
// "≈ 569.5 km from restaurant" instead of a confusing ±accuracy number) ----
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3;
  const t = Math.PI / 180;
  const dLat = (bLat - aLat) * t;
  const dLng = (bLng - aLng) * t;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Extract `lat,lng` from a Google Maps URL (?q= / ?query=). Null when absent/invalid. */
export function parseMapUrlCoords(url: string | undefined): { lat: number; lng: number } | null {
  if (!url) return null;
  const m = url.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Customer-facing distance: whole meters below 1 km, 1-decimal km above. */
export function formatDistance(meters: number, lang: 'en' | 'ar'): string {
  const m = Math.max(0, meters);
  if (m < 1000) {
    const v = Math.round(m);
    return lang === 'ar' ? `≈ ${v} م` : `≈ ${v} m`;
  }
  const v = (Math.round((m / 1000) * 10) / 10).toFixed(1);
  return lang === 'ar' ? `≈ ${v} كم` : `≈ ${v} km`;
}

// Get Directions link: uses the saved Google Maps URL when valid,
// otherwise falls back to a Maps search for the written address.
export function buildMapUrl(settings: MenuData['settings']): string {
  const direct = (settings.mapUrl || '').trim();
  if (direct.startsWith('https://')) return direct;
  const query = (settings.address?.en || '').trim() || (settings.name?.en || '').trim();
  if (query) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  return '#';
}
