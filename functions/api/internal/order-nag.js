/**
 * POST /api/internal/order-nag — 1-minute kitchen nag (called by an external
 * free cron, NOT by browsers).
 *
 * Auth: `Authorization: Bearer <secret>` where the secret lives in the
 * service_secrets D1 table (key 'order-nag'). Constant-time compare; wrong
 * or missing secret answers 404 so the route is indistinguishable from a
 * missing one (same convention as run-reports).
 *
 * Effects (same pass, same auth):
 * - nag: re-pushes unacknowledged orders (status new, 5–30 min old) with
 *   their stable tag — a closed phone re-blips every minute until the owner
 *   acks, instead of staying silent after the first ping. Best-effort only.
 * - release: orders still `new` past the 5-minute customer-cancel window
 *   are "released" (released_at stamped, exactly once via atomic claim):
 *   the owner gets the Telegram order message + admin web push NOW, and the
 *   customer gets the FIRST email ("order received", full details) — never
 *   at order time. This is the ONLY sender of first notifications; the
 *   /api/orders route sends none (kitchen grace period). A customer cancel
 *   inside the window flips to `cancelled` and is visible immediately, so
 *   it never waits for release (the `cancelled` email is its first email).
 * - receipt-check: CONFIRMED/READY orders past their ETA that were never
 *   asked get ONE "did your order arrive?" customer email (owner gets
 *   nothing new here — the redundant lock-notice ping was retired).
 * - auto-complete: CONFIRMED or READY orders older than 12h whose customer
 *   never pressed "received" are completed (stamp + owner ping).
 */
import { jsonNoStore, readJsonBody, safeCompareStrings } from '../../_shared/session.js';
import { nagUnackedOrders, notifyNewOrder } from '../../_shared/push.js';
import {
  ORDER_GRACE_MS,
  ORDER_NAG_SERVICE,
  RECEIPT_CHECK_BATCH,
  RECEIPT_CHECK_MAX_AGE_MS,
  cancelWindowMsFromMenu,
  claimOrderRelease,
  claimReceiptCheck,
  completeOrderByIdIfActive,
  findDueForReceiptCheck,
  findDueForRelease,
  findStaleActiveForAutoComplete,
  hasUnackedOrders,
  recordCronRunError,
  recordCronRunStarted,
  recordCronRunSuccess,
} from '../../_shared/repositories/orders.repo.js';
import {
  notifyOwnerAutoCompleted,
  notifyNewOrderTelegram,
  orderRowToCleaned,
  storeCountry,
  syncOrderStatusToTelegram,
} from '../../_shared/telegram.js';

/**
 * Local alias for the shared sweep-counters shape. Type-only — the four
 * counters below still travel as one `CronCounts` object per site.
 * @typedef {import('../../_shared/repositories/orders.repo.js').CronCounts} CronCounts
 */

const AUTO_COMPLETE_AFTER_MS = 12 * 3600 * 1000;
const AUTO_COMPLETE_BATCH = 20;
// Release sweep bounds: past the grace window, but not ancient (upper bound
// mirrors the nag window so a stalled cron can't resurrect week-old
// unacked orders with a first ping).
const RELEASE_BATCH = 20;
const RELEASE_MAX_AGE_MS = 30 * 60 * 1000;

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

  // Heartbeat: stamp sweep start (D1, never KV) so the dashboard can
  // tell a dead cron from a slow one. Best-effort — never blocks sweeps.
  const sweepStartMs = Date.now();
  try {
    await recordCronRunStarted(db, ORDER_NAG_SERVICE, new Date(sweepStartMs).toISOString());
  } catch {}

  // Drain a body if the caller sends one (some crons POST empty forms).
  try {
    await readJsonBody(request, 1024);
  } catch {}

  let origin = '';
  try {
    origin = new URL(request.url).origin;
  } catch {}
  // Menu KV read (store name + currency for notification text) is LAZY:
  // the sweeps below are D1-only until one of them actually has an order
  // to notify, so idle minutes cost zero KV. Cached after first fetch —
  // at most one KV read per cron run, usually none.
  let menuCache = null;
  let menuTried = false;
  const loadMenu = async () => {
    if (menuTried) return menuCache;
    menuTried = true;
    try {
      menuCache = kv ? await kv.get('menu', { type: 'json' }) : null;
    } catch {
      menuCache = null;
    }
    return menuCache;
  };
  let storeName = '';
  let cur = '';
  let country = { en: 'Lebanon', ar: 'لبنان' };
  const needMenuText = async () => {
    const menu = await loadMenu();
    try {
      const nm = menu?.settings?.name;
      storeName = nm && typeof nm === 'object' ? String(nm.en || nm.ar || '') : '';
      const currency = menu?.settings?.currency;
      // Arabic-first: the Telegram order message is Arabic-first, so the
      // currency word must match (ل.ل), falling back to English when unset.
      cur = currency && typeof currency === 'object' ? String(currency.ar || currency.en || '') : '';
      country = storeCountry(menu?.settings);
    } catch {}
  };

  let nagged = 0;
  let lockNoticed = 0;
  let released = 0;
  let receiptChecked = 0;
  let autoCompleted = 0;
  // Owner-tunable grace/cancel window (settings.ordering.cancelWindowMin,
  // 1..30 min, default 5): one best-effort menu KV read up front so the
  // nag + release cutoffs below honor it; any failure falls back to the
  // 5-minute constant (legacy behavior). The cached doc is reused by
  // needMenuText, so notification passes still cost at most one KV read.
  let graceMs = ORDER_GRACE_MS;
  try {
    graceMs = cancelWindowMsFromMenu(await loadMenu());
  } catch {
    graceMs = ORDER_GRACE_MS;
  }
  // Outer guard: anything escaping the per-sweep swallowing try/catches
  // (auth already passed) records the error heartbeat, then returns the
  // normal shape — heartbeat bookkeeping must never 500 the cron.
  try {
  try {
    // Cheap D1 existence probe first: no released-but-unacked order in the
    // nag window means the menu KV read below is skipped entirely.
    // ORDER MATTERS: this runs BEFORE the release sweep below. The nag's
    // released-gate only dedupes same-pass doubles while release hasn't
    // claimed yet — move release above this block and due orders get
    // nagged + released in the same pass again.
    const nowMs = Date.now();
    const nagFrom = new Date(nowMs - 30 * 60 * 1000).toISOString();
    const nagTo = new Date(nowMs - graceMs).toISOString();
    if (await hasUnackedOrders(db, nagTo, nagFrom)) {
      await needMenuText();
      const out = await nagUnackedOrders(db, {
        storeName,
        currency: cur,
        adminUrl: origin ? `${origin}/admin` : '',
        subject: origin || undefined,
        graceMs,
      });
      nagged = out.nagged;
    }
  } catch {}

  // Release sweep: still-`new`, past the grace window, never released —
  // claim atomically, then send the FIRST Telegram order message + admin
  // web push. Exactly-once per order: only the pass that wins the claim
  // notifies.
  try {
    const nowMs = Date.now();
    const releaseCutoff = new Date(nowMs - graceMs).toISOString();
    const recentCutoff = new Date(nowMs - RELEASE_MAX_AGE_MS).toISOString();
    const due = await findDueForRelease(db, releaseCutoff, recentCutoff, RELEASE_BATCH);
    if (due.length > 0) await needMenuText();
    const token = env.TELEGRAM_BOT_TOKEN || null;
    const adminBase = origin ? `${origin}/admin` : '';
    const dashUrl = origin ? `${origin}/admin/dashboard` : '';
    for (const row of due) {
      if (!row || typeof row.id !== 'string' || !row.id) continue;
      let claimed = false;
      try {
        claimed = await claimOrderRelease(db, row.id, new Date(nowMs).toISOString());
      } catch {
        claimed = false;
      }
      if (!claimed) continue;
      released += 1;
      try {
        const cleaned = orderRowToCleaned(row);
        await notifyNewOrderTelegram(db, token, {
          orderId: row.id,
          orderNumber: row.number,
          cleaned,
          storeName,
          currency: cur,
          adminUrl: dashUrl,
          storeCountry: country,
        });
      } catch {}
      try {
        await notifyNewOrder(db, {
          storeName,
          orderNumber: row.number,
          total: row.total,
          currency: cur,
          adminUrl: adminBase,
          subject: origin || undefined,
          tag: `new-order-${row.number}`,
        });
      } catch {}
      // Customer email (placed = "order received", full details): the FIRST
      // customer email, sent only once the cancel window lapses — never at
      // order time. Same exactly-once claim as Telegram/push above, so it
      // can never double-fire; a cancel inside the window means the order
      // never reaches this sweep and `cancelled` stays the first email.
      try {
        const { mapOrderRow } = await import('../../_shared/orders.js');
        const { notifyCustomerOrderEvent } = await import('../../_shared/customer-email.js');
        const mapped = mapOrderRow(row);
        if (mapped && mapped.customer && typeof mapped.customer.email === 'string' && mapped.customer.email) {
          await notifyCustomerOrderEvent(db, env, { order: mapped, event: 'placed', origin });
        }
      } catch {}
    }
  } catch {}

  // Receipt-check sweep (AFTER release, BEFORE auto-complete): confirmed/ready
  // + ETA passed + never asked + created within 24h — claim atomically, then
  // send the `receipt_check` customer email. Exactly-once per order: only the
  // pass that wins the claim notifies. Best-effort only.
  try {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const recentCutoff = new Date(nowMs - RECEIPT_CHECK_MAX_AGE_MS).toISOString();
    const due = await findDueForReceiptCheck(db, nowIso, recentCutoff, RECEIPT_CHECK_BATCH);
    for (const row of due) {
      if (!row || typeof row.id !== 'string' || !row.id) continue;
      let claimed = false;
      try {
        claimed = await claimReceiptCheck(db, row.id, nowIso);
      } catch {
        claimed = false;
      }
      if (!claimed) continue;
      receiptChecked += 1;
      try {
        const { mapOrderRow } = await import('../../_shared/orders.js');
        const { notifyCustomerOrderEvent } = await import('../../_shared/customer-email.js');
        const mapped = mapOrderRow(row);
        if (mapped && mapped.customer && typeof mapped.customer.email === 'string' && mapped.customer.email) {
          await notifyCustomerOrderEvent(db, env, { order: mapped, event: 'receipt_check', origin });
        }
      } catch {}
    }
  } catch {}

  // Auto-complete sweep: confirmed/ready + older than 12h + customer silent.
  try {
    const cutoff = new Date(Date.now() - AUTO_COMPLETE_AFTER_MS).toISOString();
    const candidates = await findStaleActiveForAutoComplete(db, cutoff, AUTO_COMPLETE_BATCH);
    const token = env.TELEGRAM_BOT_TOKEN || null;
    for (const cand of candidates) {
      if (!cand || typeof cand.id !== 'string' || !cand.id) continue;
      let flipped = false;
      try {
        flipped = await completeOrderByIdIfActive(db, cand.id);
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
          env,
        });
        await notifyOwnerAutoCompleted(db, token, {
          orderNumber: cand.number,
          customerName: cand.customer_name,
        });
      } catch {}
      // Customer email (completed): best-effort only.
      try {
        const { findOrderById } = await import('../../_shared/repositories/orders.repo.js');
        const { mapOrderRow } = await import('../../_shared/orders.js');
        const { notifyCustomerOrderEvent } = await import('../../_shared/customer-email.js');
        const fresh = await findOrderById(db, cand.id);
        if (fresh) {
          const mapped = mapOrderRow(fresh);
          if (mapped && mapped.customer && typeof mapped.customer.email === 'string' && mapped.customer.email) {
            await notifyCustomerOrderEvent(db, env, { order: mapped, event: 'completed', origin });
          }
        }
      } catch {}
    }
  } catch {}
  } catch (sweepErr) {
    try {
      const msg = sweepErr instanceof Error ? sweepErr.message || 'sweep_failed' : String(sweepErr);
      await recordCronRunError(db, ORDER_NAG_SERVICE, {
        endedIso: new Date().toISOString(),
        error: msg,
        result: /** @type {CronCounts} */ ({ nagged, released, autoCompleted, lockNoticed, receiptChecked }),
      });
    } catch {}
    return jsonNoStore(/** @type {{ ok: true } & CronCounts} */ ({ ok: true, nagged, released, autoCompleted, lockNoticed, receiptChecked }));
  }

  // Heartbeat: stamp sweep success with duration + counts (D1, never KV).
  // The dashboard reads this to banner a dead/slow cron. Best-effort.
  try {
    await recordCronRunSuccess(db, ORDER_NAG_SERVICE, {
      endedIso: new Date().toISOString(),
      durationMs: Date.now() - sweepStartMs,
      result: /** @type {CronCounts} */ ({ nagged, released, autoCompleted, lockNoticed, receiptChecked }),
    });
  } catch {}

  return jsonNoStore(/** @type {{ ok: true } & CronCounts} */ ({ ok: true, nagged, released, autoCompleted, lockNoticed, receiptChecked }));
}
