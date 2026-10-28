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

export async function submitOrder(payload: SubmitOrderPayload, lang: 'en' | 'ar'): Promise<{ orderNumber: number | null; blockedMessage: string | null }> {
  try {
    const res = await publicPostRaw('/api/orders', payload, 4000);
    if (!res) return { orderNumber: null, blockedMessage: null };
    if (res.ok) {
      const data: unknown = await readJson(res);
      const orderNumber = isRecord(data) && typeof data.orderNumber === 'number' ? data.orderNumber : null;
      return { orderNumber, blockedMessage: null };
    }
    if (res.status === 403) {
      const data: unknown = await readJson(res);
      const msg = isRecord(data) && isRecord(data.message) ? str(lang === 'ar' ? data.message.ar : data.message.en) : '';
      return { orderNumber: null, blockedMessage: msg || null };
    }
    return { orderNumber: null, blockedMessage: null };
  } catch {
    return { orderNumber: null, blockedMessage: null };
  }
}
