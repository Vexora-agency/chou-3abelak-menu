import { CustomerDetails, MenuData, MenuItem } from '../types/menu';

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

export function formatPrice(amount: number, currency?: string): string {  if (isNaN(amount) || amount === undefined || amount === null) return currency ? `0 ${currency}` : '0';
  const formatted = Math.round(amount).toLocaleString('en-US');
  return currency ? `${formatted} ${currency}` : formatted;
}

export function buildWhatsAppMessage(
  menu: MenuData,
  cartItems: { item: MenuItem; quantity: number }[],
  customer: CustomerDetails,
  lang: 'en' | 'ar'
): string {
  const isAr = lang === 'ar';
  const currency = isAr ? menu.settings.currency.ar : menu.settings.currency.en;
  const storeName = pickLangText(menu.settings.name, lang);

  const header = isAr
    ? `🍔 طلب جديد من ${storeName}`
    : `🍔 New Order from ${storeName}`;

  const lines: string[] = [header, '-------------------------'];

  let subtotal = 0;
  cartItems.forEach(({ item, quantity }) => {
    const itemTotal = item.price * quantity;
    subtotal += itemTotal;
    const name = pickLangText(item.name, lang);
    lines.push(`${quantity}x ${name} — ${formatPrice(itemTotal, currency)}`);
  });

  lines.push('-------------------------');
  lines.push(isAr ? `المجموع: ${formatPrice(subtotal, currency)}` : `Subtotal: ${formatPrice(subtotal, currency)}`);

  if (customer.orderType === 'delivery' && menu.settings.ordering.deliveryFee > 0) {
    const fee = menu.settings.ordering.deliveryFee;
    lines.push(isAr ? `رسوم التوصيل: ${formatPrice(fee, currency)}` : `Delivery Fee: ${formatPrice(fee, currency)}`);
    lines.push(isAr ? `الإجمالي النهائي: ${formatPrice(subtotal + fee, currency)}` : `Total: ${formatPrice(subtotal + fee, currency)}`);
  }

  lines.push('-------------------------');
  const typeMap = {
    delivery: isAr ? '🛵 توصيل إلى المنزل' : '🛵 Delivery',
    pickup: isAr ? '🛍️ استلام من الفرع' : '🛍️ Takeaway / Pickup',
    dinein: isAr ? '🍽️ تناول في المطعم' : '🍽️ Dine-in'
  };

  lines.push(isAr ? `نوع الطلب: ${typeMap[customer.orderType]}` : `Order Type: ${typeMap[customer.orderType]}`);
  if (customer.name.trim()) {
    lines.push(isAr ? `الاسم: ${customer.name.trim()}` : `Name: ${customer.name.trim()}`);
  }
  if (customer.phone.trim()) {
    lines.push(isAr ? `الهاتف: ${customer.phone.trim()}` : `Phone: ${customer.phone.trim()}`);
  }

  if (customer.orderType === 'delivery' && customer.address.trim()) {
    lines.push(isAr ? `العنوان: ${customer.address.trim()}` : `Address: ${customer.address.trim()}`);
  }

  if (customer.orderType === 'dinein' && customer.tableNumber.trim()) {
    lines.push(isAr ? `رقم الطاولة: ${customer.tableNumber.trim()}` : `Table #: ${customer.tableNumber.trim()}`);
  }

  if (customer.notes.trim()) {
    lines.push(isAr ? `ملاحظات: ${customer.notes.trim()}` : `Notes: ${customer.notes.trim()}`);
  }

  const orderNote = isAr ? menu.settings.ordering.note?.ar : menu.settings.ordering.note?.en;
  if (orderNote && orderNote.trim()) {
    lines.push(`\n📌 ${orderNote.trim()}`);
  }

  const fullMsg = lines.join('\n');
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

// Get Directions link: uses the saved Google Maps URL when valid,
// otherwise falls back to a Maps search for the written address.
export function buildMapUrl(settings: MenuData['settings']): string {
  const direct = (settings.mapUrl || '').trim();
  if (direct.startsWith('https://')) return direct;
  const query = (settings.address?.en || '').trim() || (settings.name?.en || '').trim();
  if (query) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  return '#';
}
