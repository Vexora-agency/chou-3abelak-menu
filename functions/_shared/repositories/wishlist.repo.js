/**
 * Repository: member wishlist (saved menu items).
 *
 * SQL only here; the route stays thin. Every query is scoped by the
 * session-derived user id — a customer-supplied user id is never read.
 *
 * Item ids are opaque menu ids (not a foreign key: the menu document lives
 * outside D1). Unknown/stale ids are harmless and filtered by the client.
 */

/** Hard cap per member: keeps one account from filling the table. */
export const MAX_WISHLIST_ITEMS = 200;

const MAX_ITEM_ID_LEN = 80;

/** Trim + validate an item id. Returns '' when unusable. */
export function normalizeWishlistItemId(value) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  if (!id || id.length > MAX_ITEM_ID_LEN) return '';
  // IDs are generated tokens; reject control characters and whitespace-only
  // payloads without imposing a charset the menu editor might not follow.
  if (/[\u0000-\u001f\u007f]/.test(id)) return '';
  return id;
}

function rowToEntry(row) {
  return {
    itemId: typeof row.item_id === 'string' ? row.item_id : '',
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

/** Newest-first saved items for one member. */
export async function listWishlist(db, userId, limit = MAX_WISHLIST_ITEMS) {
  if (!db || typeof userId !== 'string' || !userId) return [];
  const max = Math.min(
    MAX_WISHLIST_ITEMS,
    Math.max(1, Number.isInteger(limit) ? limit : MAX_WISHLIST_ITEMS)
  );
  const res = await db
    .prepare(
      `SELECT item_id, created_at
         FROM customer_wishlist
        WHERE user_id = ?1
        ORDER BY created_at DESC, item_id ASC
        LIMIT ?2`
    )
    .bind(userId, max)
    .all();
  const rows = res && Array.isArray(res.results) ? res.results : [];
  return rows.map(rowToEntry).filter((entry) => entry.itemId);
}

/** Number of rows for one member (cap check). */
export async function countWishlist(db, userId) {
  if (!db || typeof userId !== 'string' || !userId) return 0;
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM customer_wishlist WHERE user_id = ?1')
    .bind(userId)
    .first();
  const n = row && Number.isFinite(Number(row.n)) ? Number(row.n) : 0;
  return n;
}

/**
 * Save one item. Idempotent: re-saving keeps the original created_at (the
 * saved order stays stable). Returns `{ ok, added, reason? }`.
 */
export async function addWishlistItem(db, userId, itemId, nowIso) {
  const id = normalizeWishlistItemId(itemId);
  if (!db || typeof userId !== 'string' || !userId) return { ok: false, reason: 'unavailable' };
  if (!id) return { ok: false, reason: 'invalid' };
  const stamp = typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString();

  const existing = await db
    .prepare('SELECT 1 AS hit FROM customer_wishlist WHERE user_id = ?1 AND item_id = ?2')
    .bind(userId, id)
    .first();
  if (existing) return { ok: true, added: false };

  const count = await countWishlist(db, userId);
  if (count >= MAX_WISHLIST_ITEMS) return { ok: false, reason: 'full' };

  const res = await db
    .prepare(
      `INSERT INTO customer_wishlist (user_id, item_id, created_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id, item_id) DO NOTHING`
    )
    .bind(userId, id, stamp)
    .run();
  const changes = res && res.meta && Number.isFinite(Number(res.meta.changes))
    ? Number(res.meta.changes)
    : 0;
  return { ok: true, added: changes > 0 };
}

/** Remove one item. Returns `{ ok, removed }` (removed = rows deleted). */
export async function removeWishlistItem(db, userId, itemId) {
  const id = normalizeWishlistItemId(itemId);
  if (!db || typeof userId !== 'string' || !userId) return { ok: false, removed: 0 };
  if (!id) return { ok: false, removed: 0 };
  const res = await db
    .prepare('DELETE FROM customer_wishlist WHERE user_id = ?1 AND item_id = ?2')
    .bind(userId, id)
    .run();
  const removed = res && res.meta && Number.isFinite(Number(res.meta.changes))
    ? Number(res.meta.changes)
    : 0;
  return { ok: true, removed };
}
