/**
 * Repository: registered customer accounts + optional profile fields.
 * SQL only here; routes stay thin (see docs/ADD_NEW_FEATURE.md).
 *
 * Better Auth owns "user" / "session" / "account". This module only reads
 * the public profile columns and maintains `customer_profiles`.
 */

/** One registered user with their optional profile fields. */
export async function getCustomerProfile(db, userId) {
  if (!db || typeof userId !== 'string' || !userId) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.image,
              u."createdAt" AS createdAt, u."updatedAt" AS updatedAt,
              p.phone, p.address, p.updated_at AS profileUpdatedAt
       FROM "user" u
       LEFT JOIN customer_profiles p ON p.user_id = u.id
       WHERE u.id = ?1`
    )
    .bind(userId)
    .first();
  if (!row) return null;
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    email: typeof row.email === 'string' ? row.email : '',
    image: typeof row.image === 'string' && row.image ? row.image : null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    phone: typeof row.phone === 'string' && row.phone ? row.phone : null,
    address: typeof row.address === 'string' && row.address ? row.address : null,
    profileUpdatedAt: row.profileUpdatedAt || null,
  };
}

/** Insert or replace the optional profile fields for a user. */
export async function upsertCustomerProfile(db, userId, { phone, address }, nowIso) {
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO customer_profiles (user_id, phone, address, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id) DO UPDATE SET
         phone = excluded.phone,
         address = excluded.address,
         updated_at = excluded.updated_at`
    )
    .bind(userId, phone || null, address || null, stamp)
    .run();
  return { phone: phone || null, address: address || null, updatedAt: stamp };
}

/**
 * Admin list: registered accounts + aggregate order stats.
 * `query` matches name/email/phone (case-insensitive for ASCII); limit capped.
 */
export async function listRegisteredCustomers(db, query, limit = 200) {
  const q = typeof query === 'string' ? query.trim().slice(0, 80) : '';
  const like = `%${q}%`;
  const max = Math.min(200, Math.max(1, Number.isInteger(limit) ? limit : 200));
  const res = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.emailVerified, u.image,
              u."createdAt" AS joinedAt,
              p.phone, p.address,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_user_id = u.id) AS ordersCount,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o
                 WHERE o.customer_user_id = u.id AND o.status <> 'cancelled') AS totalSpent,
              (SELECT MIN(o.created_at) FROM orders o WHERE o.customer_user_id = u.id) AS firstOrderAt,
              (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_user_id = u.id) AS lastOrderAt
       FROM "user" u
       LEFT JOIN customer_profiles p ON p.user_id = u.id
       WHERE (?1 = '' OR u.name LIKE ?2 OR u.email LIKE ?2 OR COALESCE(p.phone, '') LIKE ?2)
       ORDER BY u."createdAt" DESC
       LIMIT ?3`
    )
    .bind(q, like, max)
    .all();
  const rows = res && Array.isArray(res.results) ? res.results : [];
  return rows.map((row) => ({
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    email: typeof row.email === 'string' ? row.email : '',
    emailVerified: !!row.emailVerified,
    image: typeof row.image === 'string' && row.image ? row.image : null,
    phone: typeof row.phone === 'string' && row.phone ? row.phone : null,
    address: typeof row.address === 'string' && row.address ? row.address : null,
    joinedAt: row.joinedAt || null,
    ordersCount: Number.isFinite(Number(row.ordersCount)) ? Number(row.ordersCount) : 0,
    totalSpent: Number.isFinite(Number(row.totalSpent)) ? Number(row.totalSpent) : 0,
    firstOrderAt: row.firstOrderAt || null,
    lastOrderAt: row.lastOrderAt || null,
  }));
}
