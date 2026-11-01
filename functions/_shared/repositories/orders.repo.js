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
 * capability (128-bit, unguessable — same trust as /api/track). Atomic:
 * exactly one caller can flip new|confirmed -> completed; repeats and
 * terminal states change nothing. Returns true only on a real flip.
 */
export async function completeOrderByTrackToken(db, number, token) {
  const nowIso = new Date().toISOString();
  const res = await db
    .prepare(
      "UPDATE orders SET status = 'completed', updated_at = ?3 WHERE number = ?1 AND track_token = ?2 AND status IN ('new','confirmed')"
    )
    .bind(number, token, nowIso)
    .run();
  const changed = res && res.meta ? res.meta.changes : 0;
  return changed === 1;
}

/**
 * Auto-complete sweep candidates: confirmed orders older than the cutoff
 * (customer never pressed "received"). Only confirmed — an unacked `new`
 * order stays the owner's responsibility (the nag covers it).
 * Bounded (oldest first) so a minute-cron pass stays cheap.
 */
export async function findStaleConfirmedForAutoComplete(db, cutoffIso, limit) {
  const n = Number.isInteger(limit) ? Math.min(50, Math.max(1, limit)) : 20;
  const res = await db
    .prepare(
      "SELECT id, number, customer_name FROM orders WHERE status = 'confirmed' AND created_at < ?1 ORDER BY created_at ASC LIMIT ?2"
    )
    .bind(cutoffIso, n)
    .all();
  return (res && res.results) || [];
}

/**
 * Customer self-cancel: token-gated like the track page, atomic, and
 * time-boxed. Only a FRESH `new` order flips — once the kitchen confirms
 * (or the window lapses) the row is untouched and the caller gets `false`
 * (answer: "too late, call us"). Returns true only on a real flip.
 */
export const CUSTOMER_CANCEL_WINDOW_MS = 2 * 60 * 1000;

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

/** Flip one order confirmed -> completed (race-safe; true only on flip). */
export async function completeOrderByIdIfConfirmed(db, id) {
  const res = await db
    .prepare(
      "UPDATE orders SET status = 'completed', updated_at = ?2 WHERE id = ?1 AND status = 'confirmed'"
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
