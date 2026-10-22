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
    const tz = settings.timezone || 'Africa/Cairo';
    const now = new Date();
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

export function buildWhatsAppMessage(
  menu: MenuData,
  cartItems: { item: MenuItem; quantity: number }[],
  customer: CustomerDetails,
  lang: 'en' | 'ar'
): string {
  const isAr = lang === 'ar';
  const currency = isAr ? menu.settings.currency.ar : menu.settings.currency.en;
  const storeName = isAr ? menu.settings.name.ar : menu.settings.name.en;

  const header = isAr
    ? `🍔 طلب جديد من ${storeName}`
    : `🍔 New Order from ${storeName}`;

  const lines: string[] = [header, '-------------------------'];

  let subtotal = 0;
  cartItems.forEach(({ item, quantity }) => {
    const itemTotal = item.price * quantity;
    subtotal += itemTotal;
    const name = isAr ? item.name.ar : item.name.en;
    lines.push(`${quantity}x ${name} — ${itemTotal} ${currency}`);
  });

  lines.push('-------------------------');
  lines.push(isAr ? `المجموع: ${subtotal} ${currency}` : `Subtotal: ${subtotal} ${currency}`);

  if (customer.orderType === 'delivery' && menu.settings.ordering.deliveryFee > 0) {
    const fee = menu.settings.ordering.deliveryFee;
    lines.push(isAr ? `رسوم التوصيل: ${fee} ${currency}` : `Delivery Fee: ${fee} ${currency}`);
    lines.push(isAr ? `الإجمالي النهائي: ${subtotal + fee} ${currency}` : `Total: ${subtotal + fee} ${currency}`);
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
