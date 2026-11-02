/**
 * Repository: orders table — ONLY place (with _shared/*.js) where orders SQL lives.
 * Skill rule: no `db.prepare` / SELECT / INSERT outside `functions/_shared/**`.
 * Routes in `functions/api/**` must call these helpers (thin routes).
 */
import { mapOrderRow, newOrderId } from '../orders.js';

export async function findOrderByIdemKey(db, idemKey) {
  return db.prepare('SELECT number, total, track_token, sent_via FROM orders WHERE idem_key = ?1').bind(idemKey).first();
}

export async function findOrderById(db, id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
}

export async function findOrderByNumber(db, number) {
  return db.prepare('SELECT * FROM orders WHERE number = ?1').bind(number).first();
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
 * Customer self-cancel: token-gated like the track page, atomic, and
 * time-boxed. Only a FRESH `new` order flips — once the kitchen confirms
 * (or the window lapses) the row is untouched and the caller gets `false`
 * (answer: "too late, call us"). Returns true only on a real flip.
 */
export async function cancelOrderByTrackToken(db, number, token, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cutoffIso = new Date(now - CUSTOMER_CANCEL_WINDOW_MS).toISOString();
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
        "SELECT 1 AS x FROM orders WHERE status = 'new' AND released_at IS NOT NULL AND created_at <= ?1 AND created_at >= ?2 LIMIT 1"
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

/** Stamp sweep success with duration + result counts. */
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

/** Stamp sweep failure (only reachable if code outside the swallowed per-sweep try/catch throws). */
export async function recordCronRunError(db, service, outcome) {
  try {
    const o = outcome && typeof outcome === 'object' ? outcome : {};
    const endedIso = typeof o.endedIso === 'string' ? o.endedIso : new Date().toISOString();
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
    void endedIso;
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
  await db.batch([
    db
      .prepare(
        'INSERT INTO orders (id, number, idem_key, track_token, created_at, updated_at, status, type, customer_name, customer_phone, phone_norm, customer_address, customer_table, notes, location_lat, location_lng, items_json, subtotal, delivery_fee, total, lang) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)'
      )
      .bind(
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
      ),
  ]);
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

export async function updateOrderStatus(db, id, status) {  const nowIso = new Date().toISOString();
  const res = await db
    .prepare('UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3')
    .bind(status, nowIso, id)
    .run();
  const changed = res && res.meta ? res.meta.changes : 0;
  if (!changed) return null;
  const row = await findOrderById(db, id);
  return row ? mapOrderRow(row) : null;
}
