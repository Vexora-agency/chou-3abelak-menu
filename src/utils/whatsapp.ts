import { CustomerDetails, MenuData, MenuItem } from '@/src/types/menu';
import { formatPrice, perUnitPrice, getVariant, featureName, lineMathText, round2 } from '@/src/utils/pricing';

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

export interface WhatsAppLine {
  item: MenuItem;
  variantId?: string;
  addonIds?: string[];
  quantity: number;
}

/**
 * Smart-badge label in the UI language. Badge keys are stored in English
 * ('top' | 'new' | 'spicy'); Arabic visitors see proper Arabic words.
 */
export function badgeLabel(key: string, lang: 'en' | 'ar'): string {
  const k = (key || '').toLowerCase();
  if (lang === 'ar') {
    if (k === 'top') return 'الأكثر طلباً';
    if (k === 'spicy') return 'حار';
    if (k === 'new') return 'جديد';
    return key;
  }
  return key.toUpperCase();
}

export function buildWhatsAppMessage(
  menu: MenuData,
  lines: WhatsAppLine[],
  customer: CustomerDetails,
  lang: 'en' | 'ar',
  orderNumber?: number | null,
  location?: { lat: number; lng: number } | null,
  /** Pre-formatted customer-facing distance ("≈ 2.3 km") for delivery. */
  distanceText?: string | null,
  /** Live tracking URL (order number + token). Appended when known. */
  trackUrl?: string | null
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

  // Per-line format (WhatsApp *bold*):
  //   2x *Name (Variant)* (*حار*)
  //      *الإضافات:* *إضافة خضرة* (+30,000)
  //      2 × 150,000 = 300,000 LBP
  // Heat is NEVER an add-on line: a spicy badge OR the spicy add-on both
  // render as (*حار*) right after the title (they mean the same thing).
  let subtotal = 0;
  let lineCount = 0;
  let pieceCount = 0;
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
    lineCount += 1;
    pieceCount += quantity;
    const ids = Array.isArray(line.addonIds) ? line.addonIds : [];
    const isHot = (item.badges || []).includes('spicy') || ids.includes('spicy');
    const name = pickLangText(item.name, lang);
    const variant = getVariant(item, line.variantId);
    const title = variant ? `${name} (${featureName(menu, line.variantId as string, lang)})` : name;
    linesOut.push(`${quantity}x *${title}*${isHot ? ` (*${badgeLabel('spicy', lang)}*)` : ''}`);
    const addonBits = ids
      .filter((id) => id !== 'spicy')
      .map((id) => {
        const def = (item.addons || []).find((a) => a && a.featureId === id);
        const tag = def && def.price > 0 ? `+${formatPrice(def.price)}` : (isAr ? 'مجاناً' : 'Free');
        return `*${featureName(menu, id, lang)}* (${tag})`;
      });
    if (addonBits.length) {
      linesOut.push(isAr ? `   *الإضافات:* ${addonBits.join('، ')}` : `   *Add-ons:* ${addonBits.join(', ')}`);
    }
    linesOut.push(`   ${lineMathText(item, quantity, unit, lang)} ${currency}`);
  }

  linesOut.push('-------------------------');
  linesOut.push(
    isAr ? `الأصناف: ${lineCount} (${pieceCount} قطع)` : `Items: ${lineCount} (${pieceCount} pcs)`
  );
  linesOut.push(isAr ? `*المجموع: ${formatPrice(subtotal, currency)}*` : `*Subtotal: ${formatPrice(subtotal, currency)}*`);

  // Must mirror the server (validateOrderInput) and the cart drawer exactly:
  // the fee applies only when it is enabled AND greater than zero.
  const feeEnabled = !!menu.settings.ordering.deliveryFeeEnabled;
  const fee = feeEnabled ? round2(Number(menu.settings.ordering.deliveryFee) || 0) : 0;
  if (customer.orderType === 'delivery' && fee > 0) {
    linesOut.push(isAr ? `رسوم التوصيل: ${formatPrice(fee, currency)}` : `Delivery Fee: ${formatPrice(fee, currency)}`);
    linesOut.push(isAr ? `*الإجمالي النهائي: ${formatPrice(subtotal + fee, currency)}*` : `*Total: ${formatPrice(subtotal + fee, currency)}*`);
  }

  // Live tracking: the same link the confirmation screen shows. Plain URL
  // (no bold) so WhatsApp's link preview + tap-to-open stay clean.
  if (trackUrl && trackUrl.trim()) {
    linesOut.push(isAr ? `📍 تتبع طلبك لحظة بلحظة: ${trackUrl.trim()}` : `📍 Track your order live: ${trackUrl.trim()}`);
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
  // The pre-formatted distance (when the restaurant location is known)
  // rides right below it — the kitchen's delivery-time estimate.
  if (customer.orderType === 'delivery' && location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    const link = `https://www.google.com/maps?q=${location.lat},${location.lng}`;
    linesOut.push(isAr ? `الموقع: ${link}` : `Location: ${link}`);
    if (distanceText && distanceText.trim()) {
      linesOut.push(isAr ? `المسافة من المطعم: ${distanceText.trim()}` : `Distance from restaurant: ${distanceText.trim()}`);
    }
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

  // wa.me links break on extreme lengths (Arabic encodes ~6x), so overlong
  // messages are cut — but NEVER mid-line (a sliced price lies), and only
  // when the order number exists: the kitchen pulls the full order #N from
  // the dashboard. Without a server record, integrity beats convenience
  // and the full text goes out uncut.
  const MAX_MSG = 1400;
  let fullMsg = linesOut.join('\n');
  if (fullMsg.length > MAX_MSG && typeof orderNumber === 'number') {
    const cut = fullMsg.lastIndexOf('\n', MAX_MSG);
    const kept = cut > 0 ? fullMsg.slice(0, cut) : fullMsg.slice(0, MAX_MSG);
    fullMsg =
      kept +
      (isAr
        ? `\n… (الباقي محفوظ في الطلب #${orderNumber})`
        : `\n… (rest saved under order #${orderNumber})`);
  }
  return fullMsg;
}
