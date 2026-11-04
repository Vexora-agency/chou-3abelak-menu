/**
 * Customer self-cancel: POST /api/track/cancel { number, t }
 * PUBLIC (no admin login) — the 128-bit track_token IS the capability,
 * same trust model as /api/track and /api/track/received.
 *
 * Rules (server-enforced, never trust the client's countdown):
 * - Only a FRESH `new` order flips (status + 5-minute window, atomic).
 * - Already confirmed/completed/cancelled or expired -> 409 { error:
 *   'too_late' } so the UI can say "call us" instead of failing silently.
 * - Unknown number/token -> 404 (same shape, no oracle).
 * On a real flip the owner is pinged on Telegram (new message + the order
 * message stamped cancelled) — best-effort via waitUntil, never blocking.
 */

import { jsonNoStore, readJsonBody } from '../../_shared/session.js';
import {
  cancelOrderByTrackToken,
  findOrderByNumber,
} from '../../_shared/repositories/orders.repo.js';
import { notifyOwnerCustomerCancelled, syncOrderStatusToTelegram } from '../../_shared/telegram.js';

const MAX_BODY_BYTES = 1 * 1024;
const TOKEN_RE = /^[0-9a-f]{32}$/;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  const number = typeof body.number === 'number' ? body.number : NaN;
  const token = typeof body.t === 'string' ? body.t.trim() : '';
  if (!Number.isInteger(number) || number <= 0 || !TOKEN_RE.test(token)) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  let flipped = false;
  try {
    flipped = await cancelOrderByTrackToken(db, number, token, Date.now());
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  if (!flipped) {
    // Honest current status when the token is valid (idempotent reads);
    // anything else stays a flat 404.
    try {
      const row = await findOrderByNumber(db, number);
      if (row) {
        const check = await db
          .prepare('SELECT 1 AS ok FROM orders WHERE number = ?1 AND track_token = ?2')
          .bind(number, token)
          .first();
        if (check && check.ok === 1) {
          if (row.status === 'cancelled') return jsonNoStore({ ok: true, status: 'cancelled', number });
          return jsonNoStore({ error: 'too_late', status: row.status }, 409);
        }
      }
    } catch {}
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  // Owner loop (Telegram ping + stamp the original order message).
  // Best-effort only — the customer's cancel already succeeded.
  const after = (async () => {
    try {
      const row = await findOrderByNumber(db, number);
      const token2 = env.TELEGRAM_BOT_TOKEN || null;
      let origin = '';
      try {
        origin = new URL(request.url).origin;
      } catch {}
      const name = row && typeof row.customer_name === 'string' ? row.customer_name : '';
      await notifyOwnerCustomerCancelled(db, token2, { orderNumber: number, customerName: name });
      if (row && typeof row.id === 'string' && row.id) {
        await syncOrderStatusToTelegram(db, token2, {
          orderId: row.id,
          status: 'cancelled',
          adminUrl: origin ? `${origin}/admin/dashboard` : '',
        });
      }
    } catch {}
    // Customer email (cancelled): best-effort only.
    try {
      const { mapOrderRow } = await import('../../_shared/orders.js');
      const { notifyCustomerOrderEvent } = await import('../../_shared/customer-email.js');
      const fresh = await findOrderByNumber(db, number);
      if (fresh) {
        const mapped = mapOrderRow(fresh);
        if (mapped && mapped.customer && typeof mapped.customer.email === 'string' && mapped.customer.email) {
          let origin = '';
          try {
            origin = new URL(request.url).origin;
          } catch {}
          await notifyCustomerOrderEvent(db, env, { order: mapped, event: 'cancelled', origin });
        }
      }
    } catch {}
  })();
  if (context.waitUntil) {
    try {
      context.waitUntil(after);
    } catch {}
  } else {
    await after;
  }

  return jsonNoStore({ ok: true, status: 'cancelled', number });
}
