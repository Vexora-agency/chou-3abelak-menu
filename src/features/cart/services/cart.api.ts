import { isRecord, readJson, str } from '@/src/utils/safeJson';
import { publicPostRaw } from '@/src/lib/api-client';

/** Cart service — POST /api/orders lives here and uses ONLY lib/api-client (never raw fetch). */

export interface SubmitOrderPayload {
  idemKey: string;
  type: string;
  customer: { name: string; phone: string; address: string };
  notes: string;
  items: Array<{ id: string; variantId?: string; addonIds?: string[]; qty: number }>;
  location?: { lat: number; lng: number; accuracy: number };
  lang: string;
  website: string;
}

export async function submitOrder(payload: SubmitOrderPayload, lang: 'en' | 'ar'): Promise<{ orderNumber: number | null; trackToken: string | null; blockedMessage: string | null }> {
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
      // instead of a token-less WhatsApp message. HTTP errors never retry.
      res = await send(6000);
    }
    if (!res) return { orderNumber: null, trackToken: null, blockedMessage: null };
    if (res.ok) {
      const data: unknown = await readJson(res);
      const orderNumber = isRecord(data) && typeof data.orderNumber === 'number' ? data.orderNumber : null;
      const trackToken = isRecord(data) && typeof data.trackToken === 'string' ? data.trackToken : null;
      return { orderNumber, trackToken, blockedMessage: null };
    }
    if (res.status === 403) {
      const data: unknown = await readJson(res);
      const msg = isRecord(data) && isRecord(data.message) ? str(lang === 'ar' ? data.message.ar : data.message.en) : '';
      return { orderNumber: null, trackToken: null, blockedMessage: msg || null };
    }
    return { orderNumber: null, trackToken: null, blockedMessage: null };
  } catch {
    return { orderNumber: null, trackToken: null, blockedMessage: null };
  }
}
