/**
 * Repository: customer-data tool (phone_norm LIKE queries).
 * `findMatches` already lives in `../customer-data.js` — reused for search/count.
 * Full-export + destructive queries live here so routes stay thin.
 */
export { findMatches } from '../customer-data.js';

/** Single LIKE-pattern builder (phone-digit fragment match). */
function likePhoneNorm(q) {
  return `%${q}%`;
}

export async function deleteByPhoneNorm(db, phoneDigits) {
  await db.prepare('DELETE FROM orders WHERE phone_norm LIKE ?1').bind(likePhoneNorm(phoneDigits)).run();
}

export async function anonymizeByPhoneNorm(db, nowIso, phoneDigits) {
  await db
    .prepare(
      'UPDATE orders SET customer_name = NULL, customer_phone = NULL, phone_norm = NULL, customer_address = NULL, customer_table = NULL, notes = NULL, location_lat = NULL, location_lng = NULL, pii_purged_at = ?1 WHERE phone_norm LIKE ?2'
    )
    .bind(nowIso, likePhoneNorm(phoneDigits))
    .run();
}

export async function exportByPhoneNorm(db, phoneDigits) {
  const full = await db
    .prepare(
      'SELECT id, number, created_at, updated_at, status, type, customer_name, customer_phone, phone_norm, customer_address, customer_table, notes, location_lat, location_lng, items_json, subtotal, delivery_fee, total, lang, pii_purged_at FROM orders WHERE phone_norm LIKE ?1 ORDER BY created_at DESC LIMIT 50'
    )
    .bind(likePhoneNorm(phoneDigits))
    .all();
  return (full && full.results) || [];
}
