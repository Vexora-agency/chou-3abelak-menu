/**
 * Public Order Endpoint: POST /api/orders
 * Records a customer order. Prices/names always come from the live menu —
 * client-supplied totals are ignored. Never reads or modifies existing orders
 * except through the idempotency key.
 */

import { jsonNoStore, readJsonBody } from '../_shared/session.js';
import { captureBackendException } from '../_shared/sentry.js';
import { mapOrderRow, validateOrderInput } from '../_shared/orders.js';
import { assessOrderRisk } from '../_shared/order-risk.js';
import { newTrackToken } from '../_shared/push.js';
import { LINK_WINDOW_MS, checkAndReserveOrderBudget, countActiveOrdersByPhone, findLinkCandidate, findOrderById, findOrderByIdemKey, insertOrderWithNumber, isPhoneBlocked, nextOrderNumber } from '../_shared/repositories/orders.repo.js';
import { getOrderingState } from '../_shared/status.js';

const MAX_BODY_BYTES = 8 * 1024;
const RATE_KEY_PREFIX = 'order:ip:';
const RATE_WINDOW_SEC = 10 * 60;
const RATE_MAX = 15;
// Human bursts welcome (family + guests ordering together), bots capped:
// 15 distinct orders per 10 minutes per IP. Same-key retries never consume
// budget (a retry is not a new order — the dedupe returns the stored row).
const PHONE_KEY_PREFIX = 'order:phone:';
// Per-phone fake-order caps (migration 0032): max 3 new delivery orders per
// phone per UTC calendar day, and max 2 orders still in a non-terminal
// state (new/confirmed/ready — the only live states). Same atomic
// check-and-reserve UPSERT as the IP budget (rate_counters table).
const PHONE_DAILY_MAX = 3;
const PHONE_ACTIVE_MAX = 2;
// Generic refusal (Arabic-first): caps AND the blocklist share ONE code and
// ONE message so probers cannot distinguish a blocked number from a capped
// one. The frontend maps any 403 to its blocked UI + this message.
const REJECTED_MESSAGE = {
  en: 'This order could not be placed right now. Please try again later or contact us.',
  ar: 'تعذّر تسجيل الطلب حاليًا. يرجى المحاولة لاحقًا أو التواصل معنا.',
};

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  let reqOrigin;
  try {
    reqOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (!origin) return false;
  const sameHost = (h) => h === 'localhost' || h === '127.0.0.1';
  let originHost;
  let reqHost;
  try {
    originHost = new URL(origin).hostname;
    reqHost = new URL(reqOrigin).hostname;
  } catch {
    return false;
  }
  const local = sameHost(originHost) && sameHost(reqHost);
  return origin === reqOrigin || local;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  if (!checkOrigin(request)) {
    return jsonNoStore({ error: 'forbidden' }, 403);
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  // Honeypot: bots fill it, humans never see it. Fake success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return jsonNoStore({ ok: true });
  }

  const kv = env.MENU_KV || null;
  const db = env.ORDERS_DB || null;
  if (!kv || !db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Load the live menu (prices/names come only from here)
  let menu = null;
  try {
    menu = await kv.get('menu', { type: 'json' });
  } catch (err) {
    captureBackendException(context, err, { binding: 'kv', code: 'order_menu_read' });
  }
  if (!menu || !Array.isArray(menu.items)) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Availability is evaluated FIRST from the live menu at submit time, so
  // the answer is always 403 {error:'paused'|'closed'|'disabled', message}.
  // Client-sent state is ignored. Not open -> no order is recorded.
  let orderingState = { state: 'open' };
  try {
    orderingState = getOrderingState((menu && menu.settings) || {}, Date.now());
  } catch {}
  if (orderingState.state !== 'open') {
    return jsonNoStore({ error: orderingState.state, message: orderingState.message || { en: '', ar: '' } }, 403);
  }

  const checked = validateOrderInput(body, menu);
  if (!checked.ok) {
    const code = (checked.errors && checked.errors[0]) || 'invalid';
    if (code === 'min_order') {
      const out = { error: code };
      if (typeof checked.minOrder === 'number') out.minOrder = checked.minOrder;
      return jsonNoStore(out, 400);
    }
    if (code === 'out_of_zone') {
      return jsonNoStore({ error: code, message: { en: 'Your location isn’t in our delivery area right now — contact us.', ar: 'موقعك خارج منطقة التوصيل حاليًا. يرجى التواصل معنا.' } }, 400);
    }
    if (code === 'blocked_phone') {
      // Dead path kept for shape-compat: the route enforces the blocklist
      // directly (single 'rejected' code) and never passes opts.isBlocked.
      return jsonNoStore({ error: 'rejected', message: REJECTED_MESSAGE }, 403);
    }
    return jsonNoStore({ error: code }, 400);
  }
  const c = checked.cleaned;
  // Tracking token: minted once per logical order (retries reuse the stored
  // row's token below), gates the public /api/track page. No PII in it.
  c.trackToken = newTrackToken();

  // Idempotency FIRST (free retries): a repeated key returns the original
  // order — stored totals win, the menu may have changed since the first
  // insert — without consuming rate budget. A retry is not a new order.
  if (c.idemKey) {
    try {
      const existing = await findOrderByIdemKey(db, c.idemKey);
      if (existing && typeof existing.number === 'number') {
        return jsonNoStore({
          ok: true,
          orderNumber: existing.number,
          total: typeof existing.total === 'number' ? existing.total : c.total,
          trackToken: typeof existing.track_token === 'string' ? existing.track_token : null,
        });
      }
    } catch {}
  }

  // Owner blocklist (migration 0032): checked BEFORE any budget reserve so
  // a blocked phone burns no IP budget. Fails CLOSED with the single
  // generic 403 (never reveals the block). Fail OPEN on infra errors — a
  // blip must not eat real dinner orders.
  try {
    if (await isPhoneBlocked(db, c.phoneNorm)) {
      return jsonNoStore({ error: 'rejected', message: REJECTED_MESSAGE }, 403);
    }
  } catch (err) {
    captureBackendException(context, err, { binding: 'd1', code: 'order_block_read' });
  }

  // Rate limit: 15 orders per 10 minutes per IP (atomic check-and-reserve
  // BEFORE the insert, so parallel bursts cannot slip past a stale read).
  // Same-key retries were already deduped above and cost no budget.
  const ip = clientIp(request);
  try {
    const budget = await checkAndReserveOrderBudget(
      db,
      RATE_KEY_PREFIX + ip,
      RATE_MAX,
      RATE_WINDOW_SEC,
      Math.floor(Date.now() / 1000)
    );
    if (!budget.allowed) {
      return jsonNoStore({ error: 'rate_limited' }, 429);
    }
  } catch (err) {
    // Fail OPEN (a blip must not eat real dinner orders — the insert itself
    // would 503 anyway) and log for the owner.
    captureBackendException(context, err, { binding: 'd1', code: 'order_rate_reserve' });
  }

  // Per-phone caps (migration 0032): active non-terminal orders first, then
  // the atomic daily reserve BEFORE the insert. The active-count read is
  // intentionally read-then-insert (NOT atomic): a millisecond race can slip
  // one extra active order past the cap, but the atomic daily reserve below
  // bounds the damage to 3/day/phone — an accepted trade-off, documented.
  // UTC-midnight window (not Beirut): up to ~3h skew around midnight is
  // accepted to keep the reserve a single atomic UPSERT with no DST math.
  // Same fail-closed posture as the IP budget. Same-key retries were
  // already deduped above and cost no budget.
  try {
    const active = await countActiveOrdersByPhone(db, c.phoneNorm);
    if (active >= PHONE_ACTIVE_MAX) {
      return jsonNoStore({ error: 'rejected', message: REJECTED_MESSAGE }, 403);
    }
  } catch (err) {
    captureBackendException(context, err, { binding: 'd1', code: 'order_phone_active_read' });
  }
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const d = new Date(nowSec * 1000);
    const midnightSec = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000);
    const budget = await checkAndReserveOrderBudget(
      db,
      PHONE_KEY_PREFIX + c.phoneNorm,
      PHONE_DAILY_MAX,
      Math.max(1, midnightSec - nowSec),
      nowSec
    );
    if (!budget.allowed) {
      return jsonNoStore({ error: 'rejected', message: REJECTED_MESSAGE }, 403);
    }
  } catch (err) {
    captureBackendException(context, err, { binding: 'd1', code: 'order_phone_daily_reserve' });
  }

  // Suspicious-order risk score (migration 0032): stored at insert, powers
  // the Telegram review line + the admin badge. Fail-open — a scoring blip
  // must never block a real order.
  try {
    const risk = await assessOrderRisk({ name: c.name, phoneNorm: c.phoneNorm }, { db, nowMs: Date.now() });
    c.riskScore = risk.riskScore;
    c.riskReasons = risk.riskReasons;
    c.needsReview = risk.needsReview;
  } catch {
    c.riskScore = 0;
    c.riskReasons = [];
    c.needsReview = false;
  }

  // One timestamp per request (verbatim original: created_at/updated_at identical, even on retry).
  const nowIso = new Date().toISOString();
  // Follow-up link (display-only, never merged): same phone with an ACTIVE
  // order inside the 15-minute window links to the most recent one. Best
  // effort — any failure reads as standalone, the order itself never waits.
  try {
    const cutoff = new Date(Date.now() - LINK_WINDOW_MS).toISOString();
    const cand = await findLinkCandidate(db, c.phoneNorm, cutoff);
    c.parentNumber = cand && Number.isInteger(cand.number) ? cand.number : null;
  } catch {
    c.parentNumber = null;
  }
  const insertWithNumber = async (num) => insertOrderWithNumber(db, c, num, nowIso);

  // Order numbers come from the atomic order_counter (UPDATE ... RETURNING):
  // no read-modify-write, no conflict retry needed. Numbers stay sequential
  // per DB (first order = 1001 via the migration seed).
  let created = null;
  try {
    const next = await nextOrderNumber(db);
    created = await insertWithNumber(next);
  } catch (err) {
    // D1 write failure: visible in Sentry, response contract unchanged (503
    // unless the idempotency fallback below finds the original row).
    // (created is already null on every path that lands here.)
    captureBackendException(context, err, { binding: 'd1', code: 'order_insert' });
    if (c.idemKey) {
      try {
        const existing = await findOrderByIdemKey(db, c.idemKey);
        if (existing && typeof existing.number === 'number') {
          return jsonNoStore({
            ok: true,
            orderNumber: existing.number,
            total: typeof existing.total === 'number' ? existing.total : c.total,
            trackToken: typeof existing.track_token === 'string' ? existing.track_token : null,
          });
        }
      } catch {}
    }
  }
  if (!created) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Bookkeeping (never blocks the response). Retention lives in the daily
  // /api/internal/run-reports job now — never here.
  // (Rate budget was already reserved atomically BEFORE the insert, so no
  // post-insert counter write is needed here.)
  // Kitchen grace period: NO owner notification here (no Telegram message,
  // no admin push). The 1-minute /api/internal/order-nag sweep "releases"
  // the order once the 5-minute customer-cancel window lapses — only then
  // does it appear in the admin dashboard + Telegram. A customer cancel
  // inside the window pings the owner from /api/track/cancel instead.

  // Fetch the stored row back so the response reflects exactly what was saved
  let savedTotal = c.total;
  let savedParent = typeof c.parentNumber === 'number' ? c.parentNumber : null;
  try {
    const row = await findOrderById(db, created.id);
    if (row) {
      const mapped = mapOrderRow(row);
      savedTotal = mapped.total;
      savedParent = typeof mapped.parentNumber === 'number' ? mapped.parentNumber : null;
    }
  } catch {}
  // No customer email here by design: the order sits in the 5-minute
  // customer-cancel window (ORDER_GRACE_MS) and the kitchen hasn't seen it
  // yet. The FIRST email goes out from the release sweep in
  // /api/internal/order-nag once the window lapses ("order received" with
  // full details) — a cancel inside the window makes `cancelled` the first
  // email instead. Same rule as Telegram/web push (release-only).
  const out = { ok: true, orderNumber: created.num, total: savedTotal, trackToken: c.trackToken };
  if (Number.isInteger(savedParent)) out.parentNumber = savedParent;
  return jsonNoStore(out);
}
