/**
 * Public Order Tracking: GET /api/track?number=1001&t=<track_token>
 * Token-gated (128-bit, minted at order time) and exposes NO PII: no name,
 * phone, address, location or notes — only items, status and totals, which
 * the customer already knows. Unknown number/token -> 404 (same shape, no
 * oracle). No auth session needed: the token IS the capability.
 */
import { jsonNoStore } from '../_shared/session.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  let number = NaN;
  let token = '';
  try {
    const url = new URL(request.url);
    number = Number.parseInt(url.searchParams.get('number') || '', 10);
    token = (url.searchParams.get('t') || '').trim();
  } catch {
    return jsonNoStore({ error: 'not_found' }, 404);
  }
  if (!Number.isInteger(number) || number <= 0 || !/^[0-9a-f]{32}$/.test(token)) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  let row = null;
  try {
    row = await db
      .prepare(
        'SELECT id, number, status, items_json, subtotal, delivery_fee, total, lang, created_at, updated_at FROM orders WHERE number = ?1'
      )
      .bind(number)
      .first();
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  if (!row) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  let tokenOk = false;
  try {
    const check = await db
      .prepare('SELECT 1 AS ok FROM orders WHERE number = ?1 AND track_token = ?2')
      .bind(number, token)
      .first();
    tokenOk = !!(check && check.ok === 1);
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  if (!tokenOk) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  let items = [];
  try {
    const parsed = JSON.parse(row.items_json || '[]');
    if (Array.isArray(parsed)) {
      items = parsed.map((it) => {
        if (!it || typeof it !== 'object') return null;
        const out = {
          qty: typeof it.qty === 'number' ? it.qty : 0,
          unitPrice: typeof it.unitPrice === 'number' ? it.unitPrice : 0,
          name: {
            en: typeof it.name?.en === 'string' ? it.name.en : '',
            ar: typeof it.name?.ar === 'string' ? it.name.ar : '',
          },
        };
        if (it.variantName && typeof it.variantName === 'object') {
          out.variantName = {
            en: typeof it.variantName.en === 'string' ? it.variantName.en : '',
            ar: typeof it.variantName.ar === 'string' ? it.variantName.ar : '',
          };
        }
        if (Array.isArray(it.addonNames)) {
          out.addonNames = it.addonNames
            .filter((a) => a && typeof a === 'object')
            .map((a) => ({
              en: typeof a.en === 'string' ? a.en : '',
              ar: typeof a.ar === 'string' ? a.ar : '',
            }));
        }
        return out;
      }).filter(Boolean);
    }
  } catch {
    items = [];
  }

  return jsonNoStore({
    ok: true,
    number: row.number,
    status: row.status,
    items,
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
    lang: row.lang === 'ar' ? 'ar' : 'en',
    updatedAt: row.updated_at,
  });
}
