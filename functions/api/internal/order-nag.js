/**
 * POST /api/internal/order-nag — 1-minute kitchen nag (called by an external
 * free cron, NOT by browsers).
 *
 * Auth: `Authorization: Bearer <secret>` where the secret lives in the
 * service_secrets D1 table (key 'order-nag'). Constant-time compare; wrong
 * or missing secret answers 404 so the route is indistinguishable from a
 * missing one (same convention as run-reports).
 *
 * Effect: re-pushes unacknowledged orders (status new, 1–30 min old) with
 * their stable tag — a closed phone re-blips every minute until the owner
 * acks, instead of staying silent after the first ping. Best-effort only.
 *
 * Second effect (same pass, same auth): auto-completes CONFIRMED orders
 * older than 12h whose customer never pressed "received" — the system
 * marks them complete, stamps the Telegram message and pings the owner.
 * Only confirmed (an unacked `new` order stays the owner's job). Also
 * best-effort: failures are counted, never thrown.
 */
import { jsonNoStore, readJsonBody, safeCompareStrings } from '../../_shared/session.js';
import { nagUnackedOrders } from '../../_shared/push.js';
import {
  completeOrderByIdIfConfirmed,
  findStaleConfirmedForAutoComplete,
  findUnackedForLockNotice,
  markLockNotified,
} from '../../_shared/repositories/orders.repo.js';
import { notifyOwnerAutoCompleted, notifyOwnerOrderLocked, syncOrderStatusToTelegram } from '../../_shared/telegram.js';

const AUTO_COMPLETE_AFTER_MS = 12 * 3600 * 1000;
const AUTO_COMPLETE_BATCH = 20;
// Customer self-cancel window: 2 minutes from order creation. Past that,
// still-`new` Telegram-notified orders get ONE "final, proceed" notice.
const LOCK_NOTICE_AFTER_MS = 2 * 60 * 1000;
const LOCK_NOTICE_BATCH = 20;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return jsonNoStore({ error: 'not_found' }, 404);

  const db = env.ORDERS_DB || null;
  const kv = env.MENU_KV || null;
  if (!db) return jsonNoStore({ error: 'not_found' }, 404);

  let want = '';
  try {
    const row = await db
      .prepare('SELECT secret FROM service_secrets WHERE key = ?1')
      .bind('order-nag')
      .first();
    want = row && typeof row.secret === 'string' ? row.secret : '';
  } catch {
    return jsonNoStore({ error: 'not_found' }, 404);
  }
  const auth = request.headers.get('Authorization') || '';
  const got = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  let ok = false;
  try {
    ok = !!want && !!got && (await safeCompareStrings(got, want));
  } catch {
    ok = false;
  }
  if (!ok) return jsonNoStore({ error: 'not_found' }, 404);

  // Drain a body if the caller sends one (some crons POST empty forms).
  try {
    await readJsonBody(request, 1024);
  } catch {}

  let origin = '';
  try {
    origin = new URL(request.url).origin;
  } catch {}
  let storeName = '';
  let cur = '';
  try {
    const menu = kv ? await kv.get('menu', { type: 'json' }) : null;
    const nm = menu?.settings?.name;
    storeName = nm && typeof nm === 'object' ? String(nm.en || nm.ar || '') : '';
    const currency = menu?.settings?.currency;
    cur = currency && typeof currency === 'object' ? String(currency.en || currency.ar || '') : '';
  } catch {}

  let nagged = 0;
  try {
    const out = await nagUnackedOrders(db, {
      storeName,
      currency: cur,
      adminUrl: origin ? `${origin}/admin` : '',
      subject: origin || undefined,
    });
    nagged = out.nagged;
  } catch {}

  // Lock-notice sweep: still-`new` and past the 2-minute customer-cancel
  // window gets ONE "final, proceed" Telegram notice (marked, never repeated).
  let lockNoticed = 0;
  try {
    const cutoff = new Date(Date.now() - LOCK_NOTICE_AFTER_MS).toISOString();
    const candidates = await findUnackedForLockNotice(db, cutoff, LOCK_NOTICE_BATCH);
    const token = env.TELEGRAM_BOT_TOKEN || null;
    for (const cand of candidates) {
      if (!cand || typeof cand.id !== 'string' || !cand.id) continue;
      try {
        await notifyOwnerOrderLocked(db, token, {
          orderNumber: cand.number,
          customerName: cand.customer_name,
        });
      } catch {}
      try {
        await markLockNotified(db, cand.id);
      } catch {}
      lockNoticed += 1;
    }
  } catch {}

  // Auto-complete sweep: confirmed + older than 12h + customer silent.
  let autoCompleted = 0;
  try {
    const cutoff = new Date(Date.now() - AUTO_COMPLETE_AFTER_MS).toISOString();
    const candidates = await findStaleConfirmedForAutoComplete(db, cutoff, AUTO_COMPLETE_BATCH);
    const token = env.TELEGRAM_BOT_TOKEN || null;
    for (const cand of candidates) {
      if (!cand || typeof cand.id !== 'string' || !cand.id) continue;
      let flipped = false;
      try {
        flipped = await completeOrderByIdIfConfirmed(db, cand.id);
      } catch {
        flipped = false;
      }
      if (!flipped) continue;
      autoCompleted += 1;
      try {
        await syncOrderStatusToTelegram(db, token, {
          orderId: cand.id,
          status: 'completed',
          adminUrl: origin ? `${origin}/admin/dashboard` : '',
        });
        await notifyOwnerAutoCompleted(db, token, {
          orderNumber: cand.number,
          customerName: cand.customer_name,
        });
      } catch {}
    }
  } catch {}

  return jsonNoStore({ ok: true, nagged, autoCompleted, lockNoticed });
}
