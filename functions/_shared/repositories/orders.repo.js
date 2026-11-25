/**
 * Repository: orders table — ONLY place (with _shared/*.js) where orders SQL lives.
 * Skill rule: no `db.prepare` / SELECT / INSERT outside `functions/_shared/**`.
 * Routes in `functions/api/**` must call these helpers (thin routes).
 */
import { isSameCustomerPhone, mapOrderRow, newOrderId } from '../orders.js';
import { orderingEtaOrDefaults } from '../eta.js';

/**
 * Follow-up window: a new order within this long after an ACTIVE order
 * (new/confirmed/ready) from the same phone links to it via parent_number.
 * 20 minutes covers "نسيت أضيف صنف" without ever merging strangers —
 * completed/cancelled orders never link, and the link is display-only
 * (two separate kitchen tickets, two separate totals, never auto-merged).
 */
export const LINK_WINDOW_MS = 20 * 60 * 1000;

export async function findOrderByIdemKey(db, idemKey) {
  return db.prepare('SELECT number, total, track_token, sent_via FROM orders WHERE idem_key = ?1').bind(idemKey).first();
}

/**
 * Order spam cap (15 orders / 10 min / IP): check AND reserve in ONE
 * atomic UPSERT, so parallel bursts cannot all read the old counter and
 * slip past (the old KV read-then-increment-after-insert could). Returns
 * `{ allowed, count }`. Expired windows reset to 1 in place, so the
 * `rate_counters` table (migration 0027) never grows past distinct keys.
 * Throws on DB failure — callers fail OPEN (availability: a blip must not
 * eat real dinner orders) and log the error.
 */
export async function checkAndReserveOrderBudget(db, key, max, windowSec, nowSec) {
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  const reset = now + windowSec;
  const row = await db
    .prepare(
      'INSERT INTO "rate_counters" ("key", "hits", "window_reset") VALUES (?1, 1, ?2) ' +
        'ON CONFLICT ("key") DO UPDATE SET ' +
        '"hits" = CASE WHEN "rate_counters"."window_reset" > ?3 THEN "rate_counters"."hits" + 1 ELSE 1 END, ' +
        '"window_reset" = CASE WHEN "rate_counters"."window_reset" > ?3 THEN "rate_counters"."window_reset" ELSE ?2 END ' +
        'RETURNING "hits" AS "hits"'
    )
    .bind(key, reset, now)
    .first();
  const n = row && typeof row.hits === 'number' ? row.hits : 0;
  return { allowed: n >= 1 && n <= max, count: n };
}

/**
 * Fake-order protection: phone blocklist + per-phone caps (migration 0032).
 * All reads THROW on DB failure — callers fail OPEN for infra blips
 * (availability) and fail CLOSED only on a positive abuse signal.
 */

/** True when this digits-only phone is owner-blocked. */
export async function isPhoneBlocked(db, phoneNorm) {
  if (typeof phoneNorm !== 'string' || !phoneNorm) return false;
  const row = await db
    .prepare('SELECT 1 AS x FROM phone_blocks WHERE phone_norm = ?1')
    .bind(phoneNorm)
    .first();
  return !!(row && row.x === 1);
}

/** Owner blocklist, newest first. Never throws (empty on any failure). */
export async function listPhoneBlocks(db) {
  try {
    const res = await db
      .prepare('SELECT phone_norm, reason, created_at FROM phone_blocks ORDER BY created_at DESC LIMIT 500')
      .all();
    const rows = (res && res.results) || [];
    // Snake-case rows: the admin dashboard renders these keys directly.
    return rows
      .filter((r) => r && typeof r.phone_norm === 'string' && r.phone_norm)
      .map((r) => ({
        phone_norm: r.phone_norm,
        reason: typeof r.reason === 'string' && r.reason ? r.reason : null,
        created_at: typeof r.created_at === 'string' ? r.created_at : null,
      }));
  } catch {
    return [];
  }
}

/** Block a phone (upsert — re-blocking updates reason + stamp). */
export async function addPhoneBlock(db, phoneNorm, reason) {
  const nowIso = new Date().toISOString();
  const rsn = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 140) : null;
  await db
    .prepare(
      'INSERT INTO phone_blocks (phone_norm, reason, created_at) VALUES (?1, ?2, ?3) ' +
        'ON CONFLICT(phone_norm) DO UPDATE SET reason = ?2, created_at = ?3'
    )
    .bind(phoneNorm, rsn, nowIso)
    .run();
  return { phone_norm: phoneNorm, reason: rsn, created_at: nowIso };
}

/** Unblock a phone. Returns true only when a row was removed. */
export async function removePhoneBlock(db, phoneNorm) {
  const res = await db.prepare('DELETE FROM phone_blocks WHERE phone_norm = ?1').bind(phoneNorm).run();
  const changed = res && res.meta ? res.meta.changes : 0;
  return changed === 1;
}

/**
 * Non-terminal orders for a phone: new/confirmed/ready (the only live
 * states — released_at is a column, not a status; completed/cancelled are
 * terminal). The per-phone active cap (2) reads this.
 */
export async function countActiveOrdersByPhone(db, phoneNorm) {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE phone_norm = ?1 AND status IN ('new','confirmed','ready')")
    .bind(phoneNorm)
    .first();
  const c = row && typeof row.c === 'number' ? row.c : 0;
  return Number.isFinite(c) && c >= 0 ? Math.floor(c) : 0;
}

/** Orders from a phone since an ISO instant (any status — risk history). */
export async function countRecentOrdersByPhone(db, phoneNorm, sinceIso) {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM orders WHERE phone_norm = ?1 AND created_at >= ?2')
    .bind(phoneNorm, sinceIso)
    .first();
  const c = row && typeof row.c === 'number' ? row.c : 0;
  return Number.isFinite(c) && c >= 0 ? Math.floor(c) : 0;
}

/** Cancelled orders from a phone since an ISO instant (risk history). */
export async function countRecentCancelledByPhone(db, phoneNorm, sinceIso) {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE phone_norm = ?1 AND status = 'cancelled' AND created_at >= ?2")
    .bind(phoneNorm, sinceIso)
    .first();
  const c = row && typeof row.c === 'number' ? row.c : 0;
  return Number.isFinite(c) && c >= 0 ? Math.floor(c) : 0;
}

export async function findOrderById(db, id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
}

export async function findOrderByNumber(db, number) {
  return db.prepare('SELECT * FROM orders WHERE number = ?1').bind(number).first();
}

/**
 * Follow-up candidate: the most recent ACTIVE order (new/confirmed/ready)
 * inside the link window whose phone matches (exact or shared suffix —
 * see isSameCustomerPhone). Returns { number } or null. Read-only, never
 * throws (fail open = standalone order). Bounded to the last 50 rows in
 * the window so a busy 20 minutes stays one cheap indexed read.
 */
export async function findLinkCandidate(db, phoneNorm, cutoffIso) {
  try {
    if (typeof phoneNorm !== 'string' || !phoneNorm || phoneNorm.replace(/[^0-9]/g, '').length < 7) return null;
    if (typeof cutoffIso !== 'string' || !cutoffIso) return null;
    const res = await db
      .prepare(
        "SELECT number, phone_norm FROM orders WHERE created_at >= ?1 AND status IN ('new','confirmed','ready') ORDER BY created_at DESC LIMIT 50"
      )
      .bind(cutoffIso)
      .all();
    const rows = (res && res.results) || [];
    for (const r of rows) {
      if (!r || !Number.isInteger(r.number)) continue;
      if (isSameCustomerPhone(typeof r.phone_norm === 'string' ? r.phone_norm : '', phoneNorm)) {
        return { number: r.number };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Customer self-confirm receipt (bell / tracking page): token-gated
 * capability (128-bit, unguessable — same trust as /api/track).
 * Atomic: exactly one caller flips confirmed|ready -> completed;
 * a still-`new` order (kitchen hasn't tapped "بدء التحضير" yet) is
 * rejected — the customer button stays disabled until prepare.
 * Terminal states change nothing. Returns true only on a real flip.
 */
export async function completeOrderByTrackToken(db, number, token) {
  const nowIso = new Date().toISOString();
  const res = await db
    .prepare(
      "UPDATE orders SET status = 'completed', updated_at = ?3 WHERE number = ?1 AND track_token = ?2 AND status IN ('confirmed','ready')"
    )
    .bind(number, token, nowIso)
    .run();
  const changed = res && res.meta ? res.meta.changes : 0;
  return changed === 1;
}

/**
 * Linked delivery group for joint receipt (migration 0023 parent_number
 * chains). Walks up to the root (<=5 hops, cycle-guarded), then collects
 * every descendant (2 rounds, <=12 members). Returns { root, members }
 * with full rows sorted by number. A group is same-customer by
 * construction (links only form on a phone match inside the window).
 * Fail-open: { root: null, members: [] } on any error.
 */
export async function findLinkedGroup(db, row) {
  try {
    if (!db || !row || !Number.isInteger(row.number)) return { root: null, members: [] };
    const seen = new Map();
    seen.set(row.number, row);
    let cur = row;
    for (let i = 0; i < 5; i++) {
      const p = Number.isInteger(cur.parent_number) ? cur.parent_number : null;
      if (p === null || seen.has(p)) break;
      let prow = null;
      try {
        prow = await findOrderByNumber(db, p);
      } catch {
        break;
      }
      if (!prow || !Number.isInteger(prow.number)) break;
      seen.set(prow.number, prow);
      cur = prow;
    }
    const root = cur.number;
    for (let round = 0; round < 2 && seen.size < 12; round++) {
      const nums = [...seen.keys()];
      let res = null;
      try {
        res = await db
          .prepare(`SELECT * FROM orders WHERE parent_number IN (${nums.map(() => '?').join(',')}) LIMIT 50`)
          .bind(...nums)
          .all();
      } catch {
        break;
      }
      const rows = (res && res.results) || [];
      let added = false;
      for (const r of rows) {
        if (r && Number.isInteger(r.number) && !seen.has(r.number)) {
          seen.set(r.number, r);
          added = true;
        }
      }
      if (!added) break;
    }
    const members = [...seen.values()].sort((a, b) => a.number - b.number);
    return { root, members };
  } catch {
    return { root: null, members: [] };
  }
}

/**
 * Joint receipt: flip every confirmed|ready member of a linked group in ONE
 * atomic UPDATE. Siblings ride on the requester's token: the group exists
 * only because the same phone placed follow-ups inside the link window, so
 * one member's capability covers the joint delivery. Cancelled/completed
 * members are never touched. Returns the flipped numbers (via RETURNING).
 */
export async function completeGroupByNumbers(db, numbers) {
  const list = [...new Set((Array.isArray(numbers) ? numbers : []).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 12);
  if (!list.length) return [];
  const res = await db
    .prepare(
      `UPDATE orders SET status = 'completed', updated_at = ?1 WHERE number IN (${list.map(() => '?').join(',')}) AND status IN ('confirmed','ready') RETURNING number`
    )
    .bind(new Date().toISOString(), ...list)
    .all();
  const rows = (res && res.results) || [];
  return rows.map((r) => r.number).filter((n) => Number.isInteger(n));
}

/**
 * Auto-complete sweep candidates: confirmed or ready + older than the
 * cutoff (customer silent — no "received" tap). An unacked `new` order
 * stays the owner's job (the nag covers it). Bounded (oldest first) so a
 * minute-cron pass stays cheap.
 */
export async function findStaleActiveForAutoComplete(db, cutoffIso, limit) {
  const n = Number.isInteger(limit) ? Math.min(50, Math.max(1, limit)) : 20;
  const res = await db
    .prepare(
      "SELECT id, number, customer_name FROM orders WHERE status IN ('confirmed','ready') AND created_at < ?1 ORDER BY created_at ASC LIMIT ?2"
    )
    .bind(cutoffIso, n)
    .all();
  return (res && res.results) || [];
}

/**
 * Kitchen grace period (also the customer self-cancel window): 5 minutes
 * from order creation. While `status = 'new'` AND `created_at` is fresher
 * than this, the order stays hidden from the admin dashboard + Telegram +
 * admin push — the 1-minute order-nag sweep "releases" it once the window
 * lapses (sets `released_at`, sends the Telegram message + web push). A
 * customer cancel inside the window flips to `cancelled`, which is visible
 * immediately (never grace-hidden). Single source of truth — the frontend
 * countdown in CancelOrderButton.tsx mirrors this value.
 */
export const ORDER_GRACE_MS = 5 * 60 * 1000;
export const CUSTOMER_CANCEL_WINDOW_MS = ORDER_GRACE_MS;

/** Default customer self-cancel / kitchen grace window (whole minutes). */
export const CANCEL_WINDOW_MIN_DEFAULT = 5;
/** Allowed range for the owner-tunable window (minutes). */
export const CANCEL_WINDOW_MIN = 1;
export const CANCEL_WINDOW_MAX = 30;

/**
 * Coerce a raw `cancelWindowMin` (minutes) to the allowed 1..30 range.
 * Zero/blank/non-finite/out-of-range in old docs falls back to 5 so
 * legacy menus behave exactly as today.
 */
export function cancelWindowMinOrDefault(v, fallback = CANCEL_WINDOW_MIN_DEFAULT) {
  const fb = Number.isFinite(fallback) ? fallback : CANCEL_WINDOW_MIN_DEFAULT;
  return typeof v === 'number' && Number.isFinite(v) && v >= CANCEL_WINDOW_MIN && v <= CANCEL_WINDOW_MAX
    ? Math.round(v)
    : fb;
}

/**
 * Resolve the cancel/grace window (ms) from a menu doc or an ordering
 * block. Reads the owner-tuned `cancelWindowMin` (1..30 min) and falls
 * back to ORDER_GRACE_MS when absent — never throws (fail open).
 */
export function cancelWindowMsFromOrdering(ordering) {
  try {
    const o = ordering && typeof ordering === 'object' ? ordering : {};
    return cancelWindowMinOrDefault(o.cancelWindowMin, CANCEL_WINDOW_MIN_DEFAULT) * 60000;
  } catch {
    return ORDER_GRACE_MS;
  }
}

export function cancelWindowMsFromMenu(menu) {
  try {
    const settings = menu && typeof menu === 'object' ? menu.settings : null;
    const ordering = settings && typeof settings === 'object' ? settings.ordering : null;
    return cancelWindowMsFromOrdering(ordering);
  } catch {
    return ORDER_GRACE_MS;
  }
}

/**
 * Batch track lookup: one D1 round-trip for up to N numbers.
 * Includes the confirm/unlock columns the batch route needs (`type` for
 * the per-type delay bucket, `confirmed_at`/`eta_at` for the unlock).
 * The placeholders are generated from the validated count only (never
 * from user input); every value stays bound — injection is impossible by
 * construction, which is why this builder (unlike the fixed WINDOW_WHERE
 * templates) takes a dynamic list.
 */
export async function findTrackRowsByNumbers(db, numbers) {
  const nums = Array.isArray(numbers)
    ? [...new Set(numbers.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50)
    : [];
  if (!nums.length) return [];
  const placeholders = nums.map((_, i) => `?${i + 1}`).join(',');
  const res = await db
    .prepare(
      `SELECT number, track_token, status, type, total, items_json, created_at, confirmed_at, eta_at, parent_number FROM orders WHERE number IN (${placeholders})`
    )
    .bind(...nums)
    .all();
  return (res && res.results) || [];
}

/**
 * Grace-pipeline visibility (count only, no PII): how many `new` orders
 * are still inside the customer-cancel window and therefore hidden from
 * the admin dashboard. Lets the dashboard show "N orders in grace" so a
 * quiet board is distinguishable from a dead cron.
 */
export async function countGraceHiddenOrders(db, graceCutoffIso) {
  try {
    const row = await db
      .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'new' AND created_at > ?1")
      .bind(graceCutoffIso)
      .first();
    const c = row && typeof row.c === 'number' ? row.c : 0;
    return Number.isFinite(c) && c >= 0 ? Math.floor(c) : 0;
  } catch {
    return 0;
  }
}

/**
 * Grace check (pure, unit-testable): a `new` order younger than the grace
 * window is hidden from admin surfaces. Cancelled/completed/old orders are
 * never grace-hidden.
 */
export function isOrderInGrace(status, createdAtIso, nowMs, graceMs = ORDER_GRACE_MS) {
  if (status !== 'new') return false;
  const t = Date.parse(createdAtIso || '');
  if (!Number.isFinite(t)) return false;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const g = Number.isFinite(graceMs) ? graceMs : ORDER_GRACE_MS;
  return now - t < g;
}

/**
 * Release sweep candidates: still-`new`, never released, past the grace
 * window — but not ancient (upper bound mirrors the nag window so a
 * stalled cron can't resurrect week-old unacked orders with a ping).
 * Bounded (oldest first) so a minute-cron pass stays cheap.
 */
export async function findDueForRelease(db, releaseCutoffIso, recentCutoffIso, limit) {
  const n = Number.isInteger(limit) ? Math.min(50, Math.max(1, limit)) : 20;
  const res = await db
    .prepare(
      "SELECT * FROM orders WHERE status = 'new' AND released_at IS NULL AND created_at <= ?1 AND created_at >= ?2 ORDER BY created_at ASC LIMIT ?3"
    )
    .bind(releaseCutoffIso, recentCutoffIso, n)
    .all();
  return (res && res.results) || [];
}

/**
 * Atomic release claim: exactly one cron pass owns the release
 * (sets released_at). Returns true only on a real claim — the caller
 * sends Telegram + web push only then, so neither ever double-fires.
 */
export async function claimOrderRelease(db, id, nowIso) {
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const res = await db
    .prepare('UPDATE orders SET released_at = ?2, updated_at = ?2 WHERE id = ?1 AND released_at IS NULL')
    .bind(id, stamp)
    .run();
  const changed = res && res.meta ? res.meta.changes : 0;
  return changed === 1;
}

/**
 * وصل الاستلام: حدّ الدفعة + نافذة ٢٤ ساعة بعد الإنشاء.
 * Receipt-check sweep bounds: past-ETA confirmed/ready, never asked, recent
 * (upper bound mirrors the 24h freshness window so a stalled cron can't
 * nag week-old orders). Bounded (oldest ETA first) so a minute-cron pass
 * stays cheap.
 */
export const RECEIPT_CHECK_BATCH = 20;
export const RECEIPT_CHECK_MAX_AGE_MS = 24 * 3600 * 1000;

/**
 * Receipt-check candidates: confirmed/ready + ETA passed + never asked +
 * created within the freshness window. Bounded (earliest ETA first).
 */
export async function findDueForReceiptCheck(db, etaCutoffIso, recentCutoffIso, limit) {
  const n = Number.isInteger(limit) ? Math.min(50, Math.max(1, limit)) : 20;
  const res = await db
    .prepare(
      "SELECT * FROM orders WHERE status IN ('confirmed','ready') AND eta_at IS NOT NULL AND eta_at <= ?1 AND receipt_asked_at IS NULL AND created_at >= ?2 ORDER BY eta_at ASC LIMIT ?3"
    )
    .bind(etaCutoffIso, recentCutoffIso, n)
    .all();
  return (res && res.results) || [];
}

/**
 * Atomic receipt-check claim: exactly one cron pass owns the ask
 * (sets receipt_asked_at). Returns true only on a real claim — the caller
 * sends the `receipt_check` email only then, so it never double-fires.
 */
export async function claimReceiptCheck(db, id, nowIso) {
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const res = await db
    .prepare('UPDATE orders SET receipt_asked_at = ?2 WHERE id = ?1 AND receipt_asked_at IS NULL')
    .bind(id, stamp)
    .run();
  const changed = res && res.meta ? res.meta.changes : 0;
  return changed === 1;
}

/**
 * Customer self-cancel: token-gated like the track page, atomic, and
 * time-boxed. Only a FRESH `new` order flips — once the kitchen confirms
 * (or the window lapses) the row is untouched and the caller gets `false`
 * (answer: "too late, call us"). Returns true only on a real flip.
 */
export async function cancelOrderByTrackToken(db, number, token, nowMs, windowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const w = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : CUSTOMER_CANCEL_WINDOW_MS;
  const cutoffIso = new Date(now - w).toISOString();
  const nowIso = new Date(now).toISOString();
  const res = await db
    .prepare(
      "UPDATE orders SET status = 'cancelled', updated_at = ?4 WHERE number = ?1 AND track_token = ?2 AND status = 'new' AND created_at > ?3"
    )
    .bind(number, token, cutoffIso, nowIso)
    .run();
  const changed = res && res.meta ? res.meta.changes : 0;
  return changed === 1;
}

/**
 * Shared released-but-unacked predicate: still-`new` AND already released.
 * Single source of truth for the nag SELECT (push.js) and the nag existence
 * probe (hasUnackedOrders below) — both SQL strings interpolate this const
 * so the gate can never drift between the two queries.
 */
export const RELEASED_UNACKED_PREDICATE = "status = 'new' AND released_at IS NOT NULL";

/**
 * Nag existence probe (KV-free): is there at least one unacknowledged,
 * ALREADY-RELEASED order inside the nag window? Lets the minute-cron skip
 * the menu KV read on idle minutes — the common case. Bounded to one row.
 * Gated on `released_at` exactly like nagUnackedOrders: the first ping is
 * the release sweep's job, so unreleased rows must not trigger a fetch.
 */
export async function hasUnackedOrders(db, releaseCutoffIso, recentCutoffIso) {
  try {
    const row = await db
      .prepare(
        `SELECT 1 AS x FROM orders WHERE ${RELEASED_UNACKED_PREDICATE} AND created_at <= ?1 AND created_at >= ?2 LIMIT 1`
      )
      .bind(releaseCutoffIso, recentCutoffIso)
      .first();
    return !!(row && row.x === 1);
  } catch {
    return true;
  }
}

/**
 * Cron heartbeat (kitchen health signal): the 1-minute external order-nag
 * sweep stamps `started` on entry and `success` (+ duration + result
 * counts) at the end of every pass. Started-without-success means the
 * sweep began but crashed mid-run. D1, never KV — a per-minute KV write
 * would burn the 1k/day free writes alone; D1 allows 100k/day.
 * All helpers never throw (route stays best-effort).
 */
export const ORDER_NAG_SERVICE = 'order-nag';

/** Staleness bounds for the 60s cron: warn after 3 missed runs, critical after 5. */
export const CRON_STALE_AFTER_MS = 3 * 60 * 1000;
export const CRON_CRITICAL_AFTER_MS = 5 * 60 * 1000;

/**
 * Cron sweep counters (order-nag result shape).
 *
 * Bundles the four counters that travel together as the heartbeat
 * `result` and the JSON response body. Type-only — no runtime change.
 *
 * @typedef {object} CronCounts
 * @property {number} nagged
 * @property {number} released
 * @property {number} autoCompleted
 * @property {number} lockNoticed
 * @property {number} receiptChecked
 */

/** Stamp sweep start (call once per pass, right after auth). */
export async function recordCronRunStarted(db, service, nowIso) {
  try {
    const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO cron_heartbeat (service, last_started_at, runs)
         VALUES (?1, ?2, 1)
         ON CONFLICT(service) DO UPDATE SET last_started_at = excluded.last_started_at, runs = runs + 1`
      )
      .bind(service, stamp)
      .run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Stamp sweep success with duration + result counts.
 * @param {any} db
 * @param {string} service
 * @param {{ endedIso?: string, durationMs?: number, result?: CronCounts }} outcome
 */
export async function recordCronRunSuccess(db, service, outcome) {
  try {
    const o = outcome && typeof outcome === 'object' ? outcome : {};
    const endedIso = typeof o.endedIso === 'string' ? o.endedIso : new Date().toISOString();
    const durationMs = Number.isFinite(o.durationMs) ? Math.max(0, Math.round(o.durationMs)) : null;
    let resultJson = null;
    try {
      resultJson = o.result !== undefined ? JSON.stringify(o.result) : null;
    } catch {
      resultJson = null;
    }
    const res = await db
      .prepare(
        `UPDATE cron_heartbeat
         SET last_success_at = ?2, last_duration_ms = ?3, consecutive_errors = 0, last_error = NULL, last_result = ?4
         WHERE service = ?1`
      )
      .bind(service, endedIso, durationMs, resultJson)
      .run();
    return !!res && !!res.meta && res.meta.changes === 1;
  } catch {
    return false;
  }
}

/**
 * Stamp sweep failure (only reachable if code outside the swallowed per-sweep try/catch throws).
 * @param {any} db
 * @param {string} service
 * @param {{ endedIso?: string, error?: string, result?: CronCounts }} outcome
 */
export async function recordCronRunError(db, service, outcome) {
  try {
    const o = outcome && typeof outcome === 'object' ? outcome : {};
    // endedIso accepted for API symmetry with recordCronRunSuccess but not
    // stored (no error-time column; the heartbeat tracks success time only).
    const err = typeof o.error === 'string' ? o.error.slice(0, 200) : 'error';
    let resultJson = null;
    try {
      resultJson = o.result !== undefined ? JSON.stringify(o.result) : null;
    } catch {
      resultJson = null;
    }
    const res = await db
      .prepare(
        `UPDATE cron_heartbeat
         SET consecutive_errors = consecutive_errors + 1, last_error = ?2, last_result = ?3
         WHERE service = ?1`
      )
      .bind(service, err, resultJson)
      .run();
    return !!res && !!res.meta && res.meta.changes === 1;
  } catch {
    return false;
  }
}

/** Read the raw heartbeat row (null when the sweep never recorded one). */
export async function getCronHeartbeat(db, service) {
  try {
    const row = await db
      .prepare(
        `SELECT service, last_started_at, last_success_at, last_duration_ms, runs, consecutive_errors, last_error, last_result
         FROM cron_heartbeat WHERE service = ?1`
      )
      .bind(service)
      .first();
    return row && typeof row === 'object' ? row : null;
  } catch {
    return null;
  }
}

/**
 * Pure health view (unit-testable): the server clock decides stale vs
 * critical from last_success_at. A never-recorded row is NOT stale (fresh
 * install must not alarm before the first tick lands).
 */
export function cronHealthFromRow(row, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const base = {
    service: row && typeof row.service === 'string' ? row.service : ORDER_NAG_SERVICE,
    lastStartedAt: row && typeof row.last_started_at === 'string' ? row.last_started_at : null,
    lastSuccessAt: row && typeof row.last_success_at === 'string' ? row.last_success_at : null,
    lastDurationMs: row && Number.isFinite(row.last_duration_ms) ? row.last_duration_ms : null,
    runs: row && Number.isFinite(row.runs) ? row.runs : 0,
    consecutiveErrors: row && Number.isFinite(row.consecutive_errors) ? row.consecutive_errors : 0,
    lastError: row && typeof row.last_error === 'string' ? row.last_error : null,
    lastResult: null,
    stale: false,
    critical: false,
    neverRan: !row,
  };
  if (row && typeof row.last_result === 'string') {
    try {
      base.lastResult = JSON.parse(row.last_result);
    } catch {
      base.lastResult = null;
    }
  }
  if (!row || !base.lastSuccessAt) return base;
  const successMs = Date.parse(base.lastSuccessAt);
  if (!Number.isFinite(successMs)) return base;
  const age = now - successMs;
  base.stale = age > CRON_STALE_AFTER_MS;
  base.critical = age > CRON_CRITICAL_AFTER_MS;
  return base;
}

/**
 * Lock-notice sweep candidates: still-`new` orders past the customer
 * cancel window that were Telegram-notified but never lock-noticed.
 * Bounded (oldest first).
 */
export async function findUnackedForLockNotice(db, cutoffIso, limit) {
  const n = Number.isInteger(limit) ? Math.min(50, Math.max(1, limit)) : 20;
  const res = await db
    .prepare(
      `SELECT o.id, o.number, o.customer_name FROM orders o
       INNER JOIN telegram_notifications t ON t.order_id = o.id
       WHERE o.status = 'new' AND o.created_at < ?1
         AND t.status = 'sent' AND t.locked_notified_at IS NULL
       ORDER BY o.created_at ASC LIMIT ?2`
    )
    .bind(cutoffIso, n)
    .all();
  return (res && res.results) || [];
}

export async function markLockNotified(db, orderId) {
  try {
    await db
      .prepare('UPDATE telegram_notifications SET locked_notified_at = ?2 WHERE order_id = ?1')
      .bind(orderId, new Date().toISOString())
      .run();
  } catch {}
}

/** Flip one active order (confirmed|ready) -> completed (race-safe; true only on flip). */
export async function completeOrderByIdIfActive(db, id) {
  const res = await db
    .prepare(
      "UPDATE orders SET status = 'completed', updated_at = ?2 WHERE id = ?1 AND status IN ('confirmed','ready')"
    )
    .bind(id, new Date().toISOString())
    .run();
  const changed = res && res.meta ? res.meta.changes : 0;
  return changed === 1;
}

/**
 * Atomic order-number allocation via the order_counter table
 * (migrations/0006_order_counter.sql). UPDATE ... RETURNING is ONE
 * statement, so concurrent inserts can never draw the same number —
 * unlike the old MAX(number)+1 read-modify-write. Throws when the
 * counter row is missing or unparsable (fail loud, never guess).
 */
export async function nextOrderNumber(db) {
  const row = await db
    .prepare('UPDATE order_counter SET last_number = last_number + 1 WHERE id = 1 RETURNING last_number')
    .first();
  const n = row && typeof row.last_number === 'number' ? row.last_number : NaN;
  if (!Number.isInteger(n)) throw new Error('order_counter_unavailable');
  return n;
}

export async function insertOrderWithNumber(db, cleaned, num, nowIso) {
  const id = newOrderId();
  // nowIso is passed by the caller (one timestamp per request, shared across retries —
  // verbatim original behaviour: created_at/updated_at identical even on retry).
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const parent = cleaned && Number.isInteger(cleaned.parentNumber) && cleaned.parentNumber > 0
    ? cleaned.parentNumber
    : null;
  const emailVal = cleaned && typeof cleaned.email === 'string' && cleaned.email ? cleaned.email : null;
  const paymentMethod = cleaned && typeof cleaned.paymentMethod === 'string' && cleaned.paymentMethod ? cleaned.paymentMethod : 'cod';
  const paymentStatus = cleaned && typeof cleaned.paymentStatus === 'string' && cleaned.paymentStatus ? cleaned.paymentStatus : 'pending';
  // Registered-customer link (migration 0034): set by the route from the
  // server-side session, never from the request body. Null = guest order.
  const customerUserId = cleaned && typeof cleaned.customerUserId === 'string' && cleaned.customerUserId
    ? cleaned.customerUserId
    : null;
  // Risk score (migration 0032): integers only, reasons capped so one row
  // stays a few dozen bytes. Absent/invalid reads as unscored (0 / '[]').
  const riskScore = cleaned && Number.isInteger(cleaned.riskScore) && cleaned.riskScore >= 0 ? cleaned.riskScore : 0;
  let riskReasons = '[]';
  try {
    const rr = Array.isArray(cleaned.riskReasons) ? cleaned.riskReasons : [];
    riskReasons = JSON.stringify(
      rr.filter((s) => typeof s === 'string' && s).map((s) => s.slice(0, 120)).slice(0, 10)
    );
  } catch {
    riskReasons = '[]';
  }
  const runInsert = (withParent, withEmail, withPayment, withRisk, withCustomer) => {
    const cols = ['id', 'number', 'idem_key', 'track_token', 'created_at', 'updated_at', 'status', 'type', 'customer_name', 'customer_phone', 'phone_norm'];
    if (withEmail) cols.push('customer_email');
    cols.push('customer_address', 'customer_table', 'notes', 'location_lat', 'location_lng', 'items_json', 'subtotal', 'delivery_fee', 'total', 'lang');
    if (withPayment) cols.push('payment_method', 'payment_status');
    if (withParent) cols.push('parent_number');
    // Risk columns ride LAST so the missing-column retry below only ever
    // drops trailing columns (keeps the legacy fake-DB column mapping intact).
    if (withRisk) cols.push('risk_score', 'risk_reasons');
    if (withCustomer) cols.push('customer_user_id');
    const placeholders = cols.map((_, i) => `?${i + 1}`).join(',');
    const values = [
      id,
      num,
      cleaned.idemKey,
      typeof cleaned.trackToken === 'string' ? cleaned.trackToken : null,
      stamp,
      stamp,
      'new',
      cleaned.type,
      cleaned.name,
      cleaned.phone,
      cleaned.phoneNorm,
    ];
    if (withEmail) values.push(emailVal);
    values.push(
      cleaned.address,
      cleaned.table,
      cleaned.notes,
      cleaned.location ? cleaned.location.lat : null,
      cleaned.location ? cleaned.location.lng : null,
      JSON.stringify(cleaned.items),
      cleaned.subtotal,
      cleaned.deliveryFee,
      cleaned.total,
      cleaned.lang
    );
    if (withPayment) values.push(paymentMethod, paymentStatus);
    if (withParent) values.push(parent);
    if (withRisk) values.push(riskScore, riskReasons);
    if (withCustomer) values.push(customerUserId);
    return db.batch([db.prepare(`INSERT INTO orders (${cols.join(', ')}) VALUES (${placeholders})`).bind(...values)]);
  };
  let withParent = parent !== null;
  // Omit the column when there is no email: legacy fakes + unmigrated DBs
  // keep the exact pre-0024 shape for the common email-less order, while
  // email orders carry the new column (NULL default covers the rest).
  let withEmail = emailVal !== null;
  // Payment columns (migration 0031): included when the DB has them,
  // dropped on `no such column` so unmigrated DBs still record the order.
  let withPayment = true;
  // Risk columns (migration 0032): same degrade path as payment above.
  let withRisk = true;
  // Customer link (migration 0034): only present for a signed-in customer.
  // Drop it on an unmigrated DB so a registered order still records as guest
  // instead of failing.
  let withCustomer = customerUserId !== null;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      await runInsert(withParent, withEmail, withPayment, withRisk, withCustomer);
      break;
    } catch (e) {
      // Unmigrated DB (missing parent_number and/or customer_email): drop
      // the missing column and retry — the order itself must never fail
      // because of a new column.
      const msg = e && typeof e.message === 'string' ? e.message : '';
      if (!/no such column/i.test(msg)) throw e;
      const missingEmail = /customer_email/i.test(msg);
      const missingParent = /parent_number/i.test(msg);
      const missingPayment = /payment_method|payment_status/i.test(msg);
      const missingRisk = /risk_score|risk_reasons/i.test(msg);
      const missingCustomer = /customer_user_id/i.test(msg);
      if (missingPayment && withPayment) {
        withPayment = false;
        continue;
      }
      if (missingEmail && withEmail) {
        withEmail = false;
        continue;
      }
      if (missingParent && withParent) {
        withParent = false;
        continue;
      }
      if (missingRisk && withRisk) {
        withRisk = false;
        continue;
      }
      if (missingCustomer && withCustomer) {
        withCustomer = false;
        continue;
      }
      if (withPayment) {
        withPayment = false;
        continue;
      }
      if (withEmail) {
        withEmail = false;
        continue;
      }
      if (withParent) {
        withParent = false;
        continue;
      }
      if (withRisk) {
        withRisk = false;
        continue;
      }
      if (withCustomer) {
        withCustomer = false;
        continue;
      }
      throw e;
    }
  }
  return { id, num };
}

/**
 * Allowlist of window WHERE templates — the ONLY strings that may reach the
 * SQL below. listOrders() throws on anything else, so a caller-supplied
 * string can never become SQL (injection impossible by construction, not
 * by convention). Add new entries here, never at call sites.
 */
const WINDOW_WHERE = {
  explicit: 'WHERE created_at >= ?1 AND created_at < ?2',
  days: 'WHERE created_at >= ?1',
};

export async function listOrders(db, where, args, limit) {
  // Enforced allowlist: unknown clauses throw before any SQL is built.
  if (!Object.values(WINDOW_WHERE).includes(where)) {
    throw new Error(`Invalid where clause: ${where}`);
  }
  const res = await db
    .prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ?${args.length + 1}`)
    .bind(...args, limit)
    .all();
  const rows = (res && res.results) || [];
  return rows.map(mapOrderRow);
}

/**
 * Windowed order list. The ONLY entry point routes use: the template is
 * picked from WINDOW_WHERE above (never raw SQL from the route), values
 * are binds. Shape mirrors the original admin route: explicit from/to
 * window, else days window.
 */
export async function listOrdersByWindow(db, { from, to, days }, limit) {
  if (typeof from === 'string' && typeof to === 'string') {
    return listOrders(db, WINDOW_WHERE.explicit, [from, to], limit);
  }
  const n = Number.isInteger(days) ? Math.min(365, Math.max(1, days)) : 35;
  return listOrders(db, WINDOW_WHERE.days, [new Date(Date.now() - n * 86400000).toISOString()], limit);
}

/* ---------- Customer account history (session-scoped, never user-supplied) ---------- */

/** Orders for one authenticated customer, newest first, capped window.
 *  `activeOnly` restricts the query to live orders for the header badge
 *  (new/confirmed/ready), keeping that light surface small. The owner's
 *  track token rides along so the account sheet can reuse the bell's
 *  track/cancel/receive actions; the response is session-scoped and
 *  no-store, so the capability never leaves the owner's own session. */
export async function listOrdersForCustomer(db, userId, sinceIso, limit = 50, activeOnly = false) {
  const max = Math.min(50, Math.max(1, Number.isInteger(limit) ? limit : 50));
  const activeWhere = activeOnly ? " AND status IN ('new','confirmed','ready')" : '';
  const res = await db
    .prepare(
      `SELECT * FROM orders
       WHERE customer_user_id = ?1 AND created_at >= ?2${activeWhere}
       ORDER BY created_at DESC
       LIMIT ?3`
    )
    .bind(userId, sinceIso, max)
    .all();
  const rows = (res && res.results) || [];
  return rows.map(mapOrderRow);
}

/** One order only when it belongs to the authenticated customer. */
export async function findOrderForCustomer(db, userId, number) {
  const row = await db
    .prepare('SELECT * FROM orders WHERE customer_user_id = ?1 AND number = ?2')
    .bind(userId, number)
    .first();
  return row ? mapOrderRow(row) : null;
}


export async function updateOrderStatus(db, id, status, opts) {
  const nowIso = new Date().toISOString();
  const o = opts && typeof opts === 'object' ? opts : {};
  // Last-status actor (migration 0029): the PATCH route passes
  // `updatedBy` explicitly — a kitchen/client username to stamp, or null
  // to clear (owner changes show nothing extra). Absent = legacy caller
  // (Telegram callbacks, tests, sweeps): leave the column untouched so the
  // primary UPDATE keeps its exact historical shape.
  const hasActor = Object.prototype.hasOwnProperty.call(o, 'updatedBy');
  const actorVal =
    hasActor && typeof o.updatedBy === 'string' && o.updatedBy.trim()
      ? o.updatedBy.trim().slice(0, 64)
      : null;
  let res;
  if (hasActor) {
    try {
      res = await db
        .prepare('UPDATE orders SET status = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4')
        .bind(status, nowIso, actorVal, id)
        .run();
    } catch (e) {
      // Pre-0029 database (missing column): degrade to the legacy write —
      // the status flip must never fail because of a new column.
      if (!/no such column|has no column named/i.test(String((e && e.message) || e))) throw e;
      res = await db
        .prepare('UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3')
        .bind(status, nowIso, id)
        .run();
    }
  } else {
    res = await db
      .prepare('UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3')
      .bind(status, nowIso, id)
      .run();
  }
  const changed = res && res.meta ? res.meta.changes : 0;
  if (!changed) return null;
  // Confirm stamping (migration 0022): the choke point for BOTH confirm
  // paths (dashboard PATCH route + Telegram callbacks) — a flip TO
  // `confirmed` stamps confirmed_at + eta_at best-effort. Never throws and
  // never blocks the status write (a stamp failure still returns the order;
  // the re-read below then simply carries NULL stamps). First-writer-wins
  // via the `confirmed_at IS NULL` guard inside stampConfirmation, so a
  // repeated confirm keeps the ORIGINAL instant.
  let stamp = null;
  if (status === 'confirmed') {
    try {
      stamp = await stampConfirmation(db, id, opts);
    } catch {
      stamp = null;
    }
  }
  const row = await findOrderById(db, id);
  if (!row) return null;
  const mapped = mapOrderRow(row);
  if (stamp) {
    mapped.confirmedAt = stamp.confirmedAt;
    mapped.etaAt = stamp.etaAt;
  }
  return mapped;
}

/**
 * Admin review dismissal (migration 0043): marks a flagged order as
 * checked-and-legitimate. The score/reasons stay untouched (audit trail);
 * only the badge computation changes. Returns the mapped order, or null
 * when the row is missing. Throws on an unmigrated DB (no such column) so
 * the route can answer 503 instead of silently pretending.
 */
export async function clearOrderReview(db, id) {
  await db
    .prepare('UPDATE orders SET review_cleared = 1 WHERE id = ?1')
    .bind(id)
    .run();
  const row = await findOrderById(db, id);
  if (!row) return null;
  return mapOrderRow(row);
}

/**
 * Smart ETA math (pure, unit-testable — no DB, no clock reads beyond the
 * explicit confirmedAtMs input).
 *
 * total = prepMinutes + queueAhead * kitchenMinutesPerOrder + travel, where
 * queueAhead counts orders AHEAD of this one (never itself — prep covers
 * this order's own work), and travel = 0 for pickup/dinein (the customer
 * comes to us) and for delivery either the road-adjusted ride
 * (distanceKm * roadFactor / courierSpeedKmh * 60) or
 * defaultDeliveryMinutes when no precise distance is known.
 * Floored at 10 minutes (never zero/negative), rounded — and deliberately
 * NOT capped above: a far pin must show its true computed time so a wrong
 * estimate is visible and investigable instead of hiding behind a cap.
 * Returns the ETA instant + minutes.
 */
export function computeEta({ confirmedAtMs, orderType, queueLen, distanceKm, settings }) {
  const s = orderingEtaOrDefaults(settings);
  const base = Number.isFinite(confirmedAtMs) ? confirmedAtMs : Date.now();
  const q = Number.isFinite(queueLen) ? Math.max(0, Math.floor(queueLen)) : 0;
  // Anything that is not an explicit counter handoff travels like delivery.
  const travels = orderType !== 'pickup' && orderType !== 'dinein';
  let travel = 0;
  if (travels) {
    travel =
      typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm >= 0
        ? (distanceKm * s.roadFactor / s.courierSpeedKmh) * 60
        : s.defaultDeliveryMinutes;
  }
  const total = s.prepMinutes + q * s.kitchenMinutesPerOrder + travel;
  const etaMinutes = Math.max(10, Math.round(total));
  return { etaAtMs: base + etaMinutes * 60000, etaMinutes };
}

/**
 * Kitchen load at confirm time: orders already occupying the line
 * (`new` + `confirmed` — grace-hidden ones included, they are real work).
 * Includes the order being confirmed itself; stampConfirmation subtracts
 * it since the queue means "orders AHEAD". Never throws (0 on any failure
 * — the ETA degrades, the confirm proceeds).
 */
export async function countActiveKitchenOrders(db) {
  try {
    const row = await db
      .prepare("SELECT COUNT(*) AS c FROM orders WHERE status IN ('new','confirmed')")
      .first();
    const c = row && typeof row.c === 'number' ? row.c : 0;
    return Number.isFinite(c) && c >= 0 ? Math.floor(c) : 0;
  } catch {
    return 0;
  }
}

/**
 * Stamp confirmed_at + eta_at for a JUST-confirmed order (migration 0022).
 * Called by updateOrderStatus (both confirm paths); also importable for
 * tests. Inputs ride in `opts` so entry points can piggyback data they
 * already hold — NO KV/D1 reads are added here beyond the one row load and
 * (only when queueLen is absent) the kitchen count:
 *   opts.settings   — settings.ordering (or anything shaped like it);
 *                     absent/invalid → ETA defaults.
 *   opts.queueLen   — precomputed kitchen load INCLUDING this order (as
 *                     counted live); the stamp subtracts it so the queue
 *                     means "orders ahead". Absent → counted live.
 *   opts.distanceKm — precomputed order→restaurant km; absent → default leg.
 *   opts.nowMs      — confirm instant; absent → Date.now().
 * Idempotent: only fills NULL stamps (first confirm wins). Returns the
 * stamped instants ({ confirmedAt, etaAt, etaMinutes }) or null when there
 * is nothing to stamp (not confirmed / already stamped / write lost a
 * race). Never throws — an unmigrated DB (missing columns) yields null and
 * the confirm still succeeds with NULL stamps (fail open, legacy-safe).
 */
export async function stampConfirmation(db, id, opts) {
  try {
    if (!db || typeof id !== 'string' || !id) return null;
    const o = opts && typeof opts === 'object' ? opts : {};
    const row = await findOrderById(db, id);
    if (!row || row.status !== 'confirmed') return null;
    if (row.confirmed_at) return { confirmedAt: row.confirmed_at, etaAt: row.eta_at || null, etaMinutes: null };
    const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let queueLen = Number.isFinite(o.queueLen) ? Math.max(0, Math.floor(o.queueLen)) : NaN;
    if (!Number.isFinite(queueLen)) queueLen = await countActiveKitchenOrders(db);
    // Exclude self: the live count (and any caller count taken the same
    // way) includes the order being confirmed — but prepMinutes already
    // covers this order's own work, so the queue means "orders ahead of it".
    queueLen = Math.max(0, queueLen - 1);
    const { etaAtMs, etaMinutes } = computeEta({
      confirmedAtMs: nowMs,
      orderType: row.type,
      queueLen,
      distanceKm: o.distanceKm,
      settings: o.settings,
    });
    const etaIso = new Date(etaAtMs).toISOString();
    const res = await db
      .prepare(
        "UPDATE orders SET confirmed_at = ?1, eta_at = ?2, updated_at = ?1 WHERE id = ?3 AND status = 'confirmed' AND confirmed_at IS NULL"
      )
      .bind(nowIso, etaIso, id)
      .run();
    const changed = res && res.meta ? res.meta.changes : 0;
    if (changed === 1) return { confirmedAt: nowIso, etaAt: etaIso, etaMinutes };
    // Lost a race (or the columns are missing): re-read best-effort so a
    // concurrent stamper's values still surface; else null (fail open).
    try {
      const reread = await findOrderById(db, id);
      if (reread && reread.confirmed_at) {
        return { confirmedAt: reread.confirmed_at, etaAt: reread.eta_at || null, etaMinutes: null };
      }
    } catch {}
    return null;
  } catch {
    return null;
  }
}
