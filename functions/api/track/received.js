/**
 * Customer self-confirm receipt: POST /api/track/received { number, t }
 * PUBLIC (no admin session) — the 128-bit track_token IS the capability,
 * same trust model as GET /api/track (unguessable, per-order, no PII in
 * the request beyond what the customer already knows).
 *
 * Atomic flip confirmed|ready -> completed via completeOrderByTrackToken:
 * exactly one caller wins; repeats are idempotent. A still-`new` order
 * (kitchen hasn't started preparing) is rejected with 404 (no oracle).
 * Receive-unlock gate: only flips once the smart ETA passes plus a small
 * grace buffer (eta_at + 5 min) — too early answers 409
 * { error: 'too_early', retryAfterSec }, mirroring the cancel endpoint's
 * 409 'too_late' shape. Legacy rows without eta_at fall back to the old
 * created+delay guarantee (never trapped).
 * On a real flip the
 * owner is pinged on Telegram (new short message + original order message
 * stamped completed) — best-effort via waitUntil, never blocks the reply.
 * Unknown number/token reads 404 identically (no oracle).
 */

import { jsonNoStore, readJsonBody, safeCompareStrings } from '../../_shared/session.js';
import {
  completeOrderByTrackToken,
  findOrderByNumber,
} from '../../_shared/repositories/orders.repo.js';
import { linkedReceivableAtMs, receivableAtMs } from '../../_shared/eta.js';
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

  // Receive-unlock gate: the button unlocks at eta_at + 5 min (the ETA
  // already encodes prep + queue + route, so the unlock scales with the
  // real wait). ONE edge-cached menu KV read max, on tap only, best-effort
  // with hardcoded fallbacks — a KV miss or a legacy row without eta_at
  // degrades to the legacy guarantee (unlock from created_at + delay,
  // i.e. immediately for old orders, never trapped). Too early answers 409 { error:
  // 'too_early', status, retryAfterSec }, mirroring the cancel endpoint's
  // 409 'too_late' shape.
  let row = null;
  try {
    row = await findOrderByNumber(db, number);
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  let tokenOk = false;
  try {
    tokenOk = !!(row && typeof row.track_token === 'string' && safeCompareStrings(token, row.track_token));
  } catch {
    tokenOk = false;
  }
  if (!row || !tokenOk) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }
  if (row.status === 'completed' || row.status === 'cancelled') {
    return jsonNoStore({ ok: true, status: row.status, number });
  }
  if (row.status !== 'confirmed' && row.status !== 'ready') {
    return jsonNoStore({ error: 'not_found' }, 404);
  }
  let ordering = null;
  try {
    const kv = env.MENU_KV || null;
    const menu = kv ? await kv.get('menu', { type: 'json', cacheTtl: 300 }) : null;
    ordering = menu && menu.settings ? menu.settings.ordering : null;
  } catch {
    ordering = null;
  }
  const nowMs = Date.now();
  let unlockAtMs = -Infinity;
  try {
    const ownMs = receivableAtMs({
      confirmedAt: row.confirmed_at,
      createdAt: row.created_at,
      etaAt: row.eta_at,
      orderType: row.type,
      settings: ordering,
      nowMs,
    });
    unlockAtMs = ownMs;
    // Joint delivery: a follow-up unlocks with its still-active parent.
    if (Number.isInteger(row.parent_number)) {
      try {
        const parent = await db
          .prepare('SELECT status, type, created_at, confirmed_at, eta_at FROM orders WHERE number = ?1')
          .bind(row.parent_number)
          .first();
        unlockAtMs = linkedReceivableAtMs(ownMs, parent, ordering, nowMs);
      } catch {}
    }
  } catch {
    unlockAtMs = -Infinity;
  }
  if (nowMs < unlockAtMs) {
    return jsonNoStore(
      {
        error: 'too_early',
        status: row.status,
        retryAfterSec: Math.max(1, Math.ceil((unlockAtMs - nowMs) / 1000)),
      },
      409
    );
  }

  // Atomic flip confirmed|ready -> completed (unchanged query): exactly one
  // caller wins; a millisecond race between the gate above and this write at
  // minute granularity is irrelevant (worst case the tap lands seconds
  // early) — documented, not guarded.
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
    // Customer email (completed): best-effort only.
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
          await notifyCustomerOrderEvent(db, env, { order: mapped, event: 'completed', origin });
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

  return jsonNoStore({ ok: true, status: 'completed', number });
}
