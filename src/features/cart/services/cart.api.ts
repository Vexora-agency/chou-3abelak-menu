import { isRecord, readJson, str } from '@/src/utils/safeJson';
import { publicPostRaw } from '@/src/lib/api-client';

/** Cart service — POST /api/orders lives here and uses ONLY lib/api-client (never raw fetch). */

export interface SubmitOrderPayload {
  idemKey: string;
  type: string;
  customer: { name: string; phone: string; address: string; email?: string };
  notes: string;
  // Payment method: today always 'cod' (whitelisted server-side, fail-safe
  // default). Sent explicitly so future gateways plug in without payload
  // shape changes.
  paymentMethod?: 'cod' | string;
  // Split quantities: present ONLY when the line actually uses splits
  // (non-trivial per-option counts). Legacy lines omit the key entirely so
  // the payload byte-shape is untouched until a real split is sent.
  items: Array<{ id: string; variantId?: string; addonIds?: string[]; addonQty?: Record<string, number>; qty: number }>;
  location?: { lat: number; lng: number; accuracy: number };
  /** Reverse-geocoded pin zone for the server-side delivery gate (best effort — omit when unresolved). */
  zone?: { cc: string; subCode: string | null; subName: string | null };
  lang: string;
  website: string;
}

export interface SubmitOrderResult {
  orderNumber: number | null;
  trackToken: string | null;
  blockedMessage: string | null;
  /** Machine cause for UI + remote diagnosis (null = recorded OK). */
  failure: null | 'timeout' | 'rate' | 'blocked' | 'invalid' | 'profile' | 'phone' | 'phone_taken';
}

export async function submitOrder(payload: SubmitOrderPayload, lang: 'en' | 'ar'): Promise<SubmitOrderResult> {
  const fail = (failure: NonNullable<SubmitOrderResult['failure']>, blockedMessage: string | null = null): SubmitOrderResult =>
    ({ orderNumber: null, trackToken: null, blockedMessage, failure });
  const send = async (timeoutMs: number) => {
    try {
      return await publicPostRaw('/api/orders', payload, timeoutMs);
    } catch {
      return null;
    }
  };
  try {
    let res = await send(4000);
    if (!res) {
      // Transport failure only (timeout/offline blip): ONE retry with the
      // SAME idemKey — idempotent-safe by construction, so a lost response
      // (order recorded, reply dropped) still resolves to the same number
      // instead of a number-less error. HTTP errors never retry.
      res = await send(6000);
    }
    if (!res) return fail('timeout');
    if (res.ok) {
      const data: unknown = await readJson(res);
      const orderNumber = isRecord(data) && typeof data.orderNumber === 'number' ? data.orderNumber : null;
      const trackToken = isRecord(data) && typeof data.trackToken === 'string' ? data.trackToken : null;
      if (!orderNumber) return fail('invalid');
      return { orderNumber, trackToken, blockedMessage: null, failure: null };
    }
    // Delivery-zone rejection carries the bilingual reason — surface it
    // verbatim (same copy as the on-screen block panel).
    try {
      const data: unknown = await readJson(res);
      if (isRecord(data) && data.error === 'out_of_zone') {
        const msg = isRecord(data.message) ? str(lang === 'ar' ? data.message.ar : data.message.en) : '';
        return {
          orderNumber: null,
          trackToken: null,
          blockedMessage: msg || (lang === 'ar'
            ? 'موقعك خارج نطاق التوصيل حاليًا، تواصل معنا'
            : 'Your location isn’t in our delivery area right now — contact us.'),
          failure: 'blocked',
        };
      }
      // Missing heat degree (badged-spicy line recorded without one — stale
      // cart or tampered payload): tell the customer exactly how to fix it
      // (re-add the line and pick a degree) instead of a generic error.
      if (isRecord(data) && data.error === 'heat_required') {
        return {
          orderNumber: null,
          trackToken: null,
          blockedMessage: lang === 'ar'
            ? 'صنف حار دون تحديد درجة الحرارة — احذف السطر من السلة وأعده مع اختيار الدرجة'
            : 'A spicy item is missing its heat level — remove the line and re-add it with a level',
          failure: 'blocked',
        };
      }
      if (res.status === 401 && isRecord(data) && data.error === 'account_required') {
        const msg = isRecord(data.message) ? str(lang === 'ar' ? data.message.ar : data.message.en) : '';
        return {
          orderNumber: null,
          trackToken: null,
          blockedMessage: msg || (lang === 'ar'
            ? 'أنشئ حسابًا لإتمام طلب الدفع عند الاستلام.'
            : 'Create an account to place a cash-on-delivery order.'),
          failure: 'blocked',
        };
      }
      if (res.status === 403 && isRecord(data) && data.error === 'phone_linked_other_account') {
        const msg = isRecord(data.message) ? str(lang === 'ar' ? data.message.ar : data.message.en) : '';
        return {
          orderNumber: null,
          trackToken: null,
          blockedMessage: msg || (lang === 'ar'
            ? 'هذا الرقم مرتبط بحساب عضو آخر. استخدم رقمك أو تواصل معنا.'
            : 'This number is linked to another member account. Use your own number or contact us.'),
          failure: 'phone_taken',
        };
      }
      if (res.status === 403 && isRecord(data) && data.error === 'phone_verification_required') {
        const msg = isRecord(data.message) ? str(lang === 'ar' ? data.message.ar : data.message.en) : '';
        return {
          orderNumber: null,
          trackToken: null,
          blockedMessage: msg || (lang === 'ar'
            ? 'أكّد رقم الهاتف عبر واتساب قبل إرسال الطلب.'
            : 'Verify your phone number on WhatsApp before placing the order.'),
          failure: 'phone',
        };
      }
      if (res.status === 403 && isRecord(data) && data.error === 'profile_incomplete') {
        const msg = isRecord(data.message) ? str(lang === 'ar' ? data.message.ar : data.message.en) : '';
        return {
          orderNumber: null,
          trackToken: null,
          blockedMessage: msg || null,
          failure: 'profile',
        };
      }
      if (res.status === 403) {
        const msg = isRecord(data) && isRecord(data.message) ? str(lang === 'ar' ? data.message.ar : data.message.en) : '';
        return { orderNumber: null, trackToken: null, blockedMessage: msg || null, failure: 'blocked' };
      }
    } catch {
      /* fall through to status-based handling below */
    }
    if (res.status === 403) {
      // Ordering-state gate with an unreadable body (same as before).
      return { orderNumber: null, trackToken: null, blockedMessage: null, failure: 'blocked' };
    }
    if (res.status === 429) {
      // Too fast: show it and STOP (no numberless ghost message to the
      // kitchen). Retrying the same tap later succeeds — same key, same row.
      return {
        orderNumber: null,
        trackToken: null,
        blockedMessage: lang === 'ar'
          ? 'طلبات كثيرة في وقت قصير — انتظر دقيقة ثم حاول مجددًا'
          : 'Too many orders at once — wait a minute and try again',
        failure: 'rate',
      };
    }
    return fail('invalid');
  } catch {
    return fail('timeout');
  }
}
