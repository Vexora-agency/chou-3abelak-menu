/**
 * Public Order Tracking: GET /api/track?number=1001&t=<track_token>
 * Token-gated (128-bit, minted at order time) and exposes NO PII: no name,
 * phone, address, location or notes — only items, status and totals, which
 * the customer already knows. Unknown number/token -> 404 (same shape, no
 * oracle). No auth session needed: the token IS the capability.
 */
import { jsonNoStore } from '../_shared/session.js';
import { isRateLimited, noteRateLimitHit, rateKey } from '../_shared/access.js';

// Polling math: the bell re-checks each order every 60s, so a customer
// with a few orders stays far below this. 120 hits / 5 min per IP only
// bites scrapers — and a 429 here fails soft client-side (unknown state,
// retried on the next tick), never a dead page.
// KV discipline: the probe below is read-only; only FAILED token checks
// cost a write (noteRateLimitHit). Tokens are 128-bit unguessable, so
// brute force is the only threat worth counting — legitimate polls
// (the 99.99% case) stay write-free and off the 1k/day quota.
const TRACK_MAX = 120;
const TRACK_TTL_SEC = 5 * 60;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const limitKey = rateKey('track', request);
  if (await isRateLimited(env.MENU_KV || null, limitKey, TRACK_MAX)) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
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
        'SELECT id, number, status, type, items_json, subtotal, delivery_fee, total, lang, created_at, updated_at FROM orders WHERE number = ?1'
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
    // Failed guess: the only hit worth counting (see top comment).
    await noteRateLimitHit(env.MENU_KV || null, limitKey, TRACK_MAX, TRACK_TTL_SEC);
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
          // Pricing unit for "2 دستتين" (absent on pre-unit rows → omitted).
          ...(typeof it.unit === 'string' && it.unit ? { unit: it.unit.slice(0, 16) } : {}),
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
          // Split-count passthrough: when the stored line carries addonQty,
          // each name entry gains an optional `count` (0..qty). Legacy lines
          // (no addonQty) omit it, so old readers keep working unchanged.
          // Stored addonNames order matches stored addonIds order (orders.js
          // builds both from the same list), so index alignment holds.
          const hasQty = !!(it.addonQty && typeof it.addonQty === 'object' && !Array.isArray(it.addonQty));
          const lineQty = typeof it.qty === 'number' ? it.qty : 0;
          const names = [];
          for (let ni = 0; ni < it.addonNames.length; ni++) {
            const a = it.addonNames[ni];
            if (!a || typeof a !== 'object') continue;
            const base = {
              en: typeof a.en === 'string' ? a.en : '',
              ar: typeof a.ar === 'string' ? a.ar : '',
            };
            if (hasQty) {
              const fid = Array.isArray(it.addonIds) ? it.addonIds[ni] : null;
              const raw = fid && Object.prototype.hasOwnProperty.call(it.addonQty, fid)
                ? it.addonQty[fid]
                : lineQty;
              if (typeof raw === 'number' && Number.isInteger(raw)) {
                base.count = raw;
              }
            }
            names.push(base);
          }
          out.addonNames = names;
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
    // Order type drives the customer-facing ready label (out for delivery
    // vs ready for pickup). Allowlisted, defaults to delivery.
    type: row.type === 'pickup' || row.type === 'dinein' ? row.type : 'delivery',
    items,
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
    lang: row.lang === 'ar' ? 'ar' : 'en',
    // Server clock truth for the customer cancel countdown (5-min window).
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
