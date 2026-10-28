/**
 * Repository: orders table — ONLY place (with _shared/*.js) where orders SQL lives.
 * Skill rule: no `db.prepare` / SELECT / INSERT outside `functions/_shared/**`.
 * Routes in `functions/api/**` must call these helpers (thin routes).
 */
import { mapOrderRow, newOrderId } from '../orders.js';

export async function findOrderByIdemKey(db, idemKey) {
  return db.prepare('SELECT number, total FROM orders WHERE idem_key = ?1').bind(idemKey).first();
}

export async function findOrderById(db, id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
}

export async function getMaxOrderNumber(db) {
  const row = await db.prepare('SELECT MAX(number) AS m FROM orders').first();
  return row && typeof row.m === 'number' ? row.m : 1000;
}

export async function insertOrderWithNumber(db, cleaned, num, nowIso) {
  const id = newOrderId();
  // nowIso is passed by the caller (one timestamp per request, shared across retries —
  // verbatim original behaviour: created_at/updated_at identical even on retry).
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  await db.batch([
    db
      .prepare(
        'INSERT INTO orders (id, number, idem_key, created_at, updated_at, status, type, customer_name, customer_phone, phone_norm, customer_address, customer_table, notes, location_lat, location_lng, items_json, subtotal, delivery_fee, total, lang) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)'
      )
      .bind(
        id,
        num,
        cleaned.idemKey,
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

export async function listOrders(db, where, args, limit) {
  // Internal: where is one of the two fixed templates built by listOrdersByWindow below.
  const res = await db
    .prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ?${args.length + 1}`)
    .bind(...args, limit)
    .all();
  const rows = (res && res.results) || [];
  return rows.map(mapOrderRow);
}

/**
 * Windowed order list. The ONLY entry point routes use: where-clauses are
 * fixed templates chosen here (never raw SQL from the route), values are binds.
 * Shape mirrors the original admin route: explicit from/to window, else days window.
 */
export async function listOrdersByWindow(db, { from, to, days }, limit) {
  if (typeof from === 'string' && typeof to === 'string') {
    return listOrders(db, 'WHERE created_at >= ?1 AND created_at < ?2', [from, to], limit);
  }
  const n = Number.isInteger(days) ? Math.min(365, Math.max(1, days)) : 35;
  return listOrders(db, 'WHERE created_at >= ?1', [new Date(Date.now() - n * 86400000).toISOString()], limit);
}

export async function updateOrderStatus(db, id, status) {
  const nowIso = new Date().toISOString();
  const res = await db
    .prepare('UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3')
    .bind(status, nowIso, id)
    .run();
  const changed = res && res.meta ? res.meta.changes : 0;
  if (!changed) return null;
  const row = await findOrderById(db, id);
  return row ? mapOrderRow(row) : null;
}
