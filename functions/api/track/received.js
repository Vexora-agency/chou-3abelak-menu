/**
 * Customer self-confirm receipt: POST /api/track/received { number, t }
 * PUBLIC (no admin session) — the 128-bit track_token IS the capability,
 * same trust model as GET /api/track (unguessable, per-order, no PII in
 * the request beyond what the customer already knows).
 *
 * Atomic flip new|confirmed -> completed via completeOrderByTrackToken:
 * exactly one caller wins; repeats are idempotent. On a real flip the
 * owner is pinged on Telegram (new short message + original order message
 * stamped completed) — best-effort via waitUntil, never blocks the reply.
 * Unknown number/token reads 404 identically (no oracle).
 */

import { jsonNoStore, readJsonBody } from '../../_shared/session.js';
import {
  completeOrderByTrackToken,
  findOrderByNumber,
} from '../../_shared/repositories/orders.repo.js';
import { notifyOwnerReceived, syncOrderStatusToTelegram } from '../../_shared/telegram.js';

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

  let flipped;
  try {
    flipped = await completeOrderByTrackToken(db, number, token);
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  if (!flipped) {
    // Idempotent reads: already-completed (or cancelled) by this same token
    // returns the honest current status; anything else is 404 (no oracle).
    try {
      const row = await findOrderByNumber(db, number);
      if (row) {
        const check = await db
          .prepare('SELECT 1 AS ok FROM orders WHERE number = ?1 AND track_token = ?2')
          .bind(number, token)
          .first();
        if (check && check.ok === 1 && (row.status === 'completed' || row.status === 'cancelled')) {
          return jsonNoStore({ ok: true, status: row.status, number });
        }
      }
    } catch {}
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  // Owner loop (Telegram ping + stamp the original order message).
  // Best-effort only — the customer's confirm already succeeded.
  const after = (async () => {
    try {
      const row = await findOrderByNumber(db, number);
      const token2 = env.TELEGRAM_BOT_TOKEN || null;
      let origin = '';
      try {
        origin = new URL(request.url).origin;
      } catch {}
      const name = row && typeof row.customer_name === 'string' ? row.customer_name : '';
      await notifyOwnerReceived(db, token2, { orderNumber: number, customerName: name });
      if (row && typeof row.id === 'string' && row.id) {
        await syncOrderStatusToTelegram(db, token2, {
          orderId: row.id,
          status: 'completed',
          adminUrl: origin ? `${origin}/admin/dashboard` : '',
        });
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

  return jsonNoStore({ ok: true, status: 'completed', number });
}
