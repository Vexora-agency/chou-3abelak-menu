/**
 * Repository: phone_verifications — SQL only.
 *
 * One row per member request. `phone` is always normalized international
 * digits (no plus, no separators) so the order gate and the admin list compare
 * the same value the member's WhatsApp number resolves to.
 */

import { normalizePhoneDigits } from '../validate-auth.js';
import { VERIFICATION_VALIDITY_MS } from '../phone-verification.js';

function phoneOrNull(value) {
  const digits = normalizePhoneDigits(value);
  return digits || null;
}

/**
 * Flip pending rows whose code window elapsed. Called before a new request
 * (frees the one-pending-per-number slot) and before admin decisions.
 */
export async function expireStalePending(db, nowIso, { userId = null, phone = null } = {}) {
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  if (userId && phone) {
    const digits = phoneOrNull(phone);
    if (!digits) return 0;
    const res = await db
      .prepare(
        `UPDATE phone_verifications
            SET status = 'expired', decided_at = ?1
          WHERE status = 'pending' AND user_id = ?2 AND phone = ?3 AND expires_at <= ?1`
      )
      .bind(stamp, userId, digits)
      .run();
    return Number(res?.meta?.changes) || 0;
  }
  const res = await db
    .prepare(
      `UPDATE phone_verifications
          SET status = 'expired', decided_at = ?1
        WHERE status = 'pending' AND expires_at <= ?1`
    )
    .bind(stamp)
    .run();
  return Number(res?.meta?.changes) || 0;
}

/** Retire one pending row (resend supersedes the previous code). */
export async function expireVerificationById(db, id, nowIso) {
  if (!db || typeof id !== 'string' || !id) return false;
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const res = await db
    .prepare(
      `UPDATE phone_verifications
          SET status = 'expired', decided_at = ?1
        WHERE id = ?2 AND status = 'pending'`
    )
    .bind(stamp, id)
    .run();
  return (Number(res?.meta?.changes) || 0) > 0;
}

/** Newest live pending row for this member + number, or null. */
export async function findPendingVerification(db, userId, phone, nowIso) {
  const digits = phoneOrNull(phone);
  if (!db || !userId || !digits) return null;
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  return db
    .prepare(
      `SELECT id, user_id, phone, reference, code_hash, status, lang, created_at, expires_at, decided_at, decided_by
         FROM phone_verifications
        WHERE user_id = ?1 AND phone = ?2 AND status = 'pending' AND expires_at > ?3
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(userId, digits, stamp)
    .first();
}

/** Request count for a member+number since an ISO cutoff. */
export async function countPhoneRequestsSince(db, userId, phone, sinceIso) {
  const digits = phoneOrNull(phone);
  if (!db || !userId || !digits) return 0;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM phone_verifications
        WHERE user_id = ?1 AND phone = ?2 AND created_at >= ?3`
    )
    .bind(userId, digits, sinceIso)
    .first();
  return Number(row?.n) || 0;
}

/** Request count for a member across every number since an ISO cutoff. */
export async function countUserRequestsSince(db, userId, sinceIso) {
  if (!db || !userId) return 0;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM phone_verifications
        WHERE user_id = ?1 AND created_at >= ?2`
    )
    .bind(userId, sinceIso)
    .first();
  return Number(row?.n) || 0;
}

/**
 * Insert a request. Returns true when inserted; false when the partial unique
 * index rejected it because another pending row already exists.
 */
export async function insertVerification(db, row) {
  const digits = phoneOrNull(row.phone);
  if (!db || !digits) return false;
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO phone_verifications
         (id, user_id, phone, reference, code_hash, status, lang, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8)`
    )
    .bind(
      row.id,
      row.userId,
      digits,
      row.reference,
      row.codeHash,
      row.lang === 'ar' ? 'ar' : 'en',
      row.createdAt,
      row.expiresAt
    )
    .run();
  return (Number(res?.meta?.changes) || 0) > 0;
}

/** Latest approved row that is still inside its 365-day validity window. */
export async function findValidVerification(db, userId, phone, nowMs = Date.now()) {
  const digits = phoneOrNull(phone);
  if (!db || !userId || !digits) return null;
  const cutoffIso = new Date(nowMs - VERIFICATION_VALIDITY_MS).toISOString();
  return db
    .prepare(
      `SELECT id, user_id, phone, reference, status, lang, created_at, expires_at, decided_at, decided_by
         FROM phone_verifications
        WHERE user_id = ?1 AND phone = ?2 AND status = 'approved' AND decided_at >= ?3
        ORDER BY decided_at DESC
        LIMIT 1`
    )
    .bind(userId, digits, cutoffIso)
    .first();
}

/** One row by id (optionally scoped to its owner). */
export async function getVerificationById(db, id, userId = null) {
  if (!db || typeof id !== 'string' || !id) return null;
  if (userId) {
    return db
      .prepare(
        `SELECT id, user_id, phone, reference, code_hash, status, lang, created_at, expires_at, decided_at, decided_by
           FROM phone_verifications WHERE id = ?1 AND user_id = ?2`
      )
      .bind(id, userId)
      .first();
  }
  return db
    .prepare(
      `SELECT id, user_id, phone, reference, code_hash, status, lang, created_at, expires_at, decided_at, decided_by
         FROM phone_verifications WHERE id = ?1`
    )
    .bind(id)
    .first();
}

/**
 * Admin list. `status='pending'` only returns live rows; `all` returns the
 * newest requests across every state. Member name/email are joined for the
 * approval card, never the code.
 */
export async function listVerifications(db, { status = 'pending', limit = 50, nowIso = new Date().toISOString() } = {}) {
  const max = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 50));
  if (status === 'pending') {
    const res = await db
      .prepare(
        `SELECT v.id, v.user_id, v.phone, v.reference, v.status, v.lang,
                v.created_at, v.expires_at, v.decided_at,
                u.name AS user_name, u.email AS user_email
           FROM phone_verifications v
           LEFT JOIN "user" u ON u.id = v.user_id
          WHERE v.status = 'pending' AND v.expires_at > ?1
          ORDER BY v.created_at ASC
          LIMIT ?2`
      )
      .bind(nowIso, max)
      .all();
    return res && Array.isArray(res.results) ? res.results : [];
  }
  const res = await db
    .prepare(
      `SELECT v.id, v.user_id, v.phone, v.reference, v.status, v.lang,
              v.created_at, v.expires_at, v.decided_at,
              u.name AS user_name, u.email AS user_email
         FROM phone_verifications v
         LEFT JOIN "user" u ON u.id = v.user_id
        ORDER BY v.created_at DESC
        LIMIT ?1`
    )
    .bind(max)
    .all();
  return res && Array.isArray(res.results) ? res.results : [];
}

/** Live pending count for the dashboard badge. */
export async function countPendingVerifications(db, nowIso = new Date().toISOString()) {
  if (!db) return 0;
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM phone_verifications WHERE status = 'pending' AND expires_at > ?1`)
    .bind(nowIso)
    .first();
  return Number(row?.n) || 0;
}

/**
 * Approve/reject one live pending row. The WHERE clause makes the decision
 * single-use: a second click (or an expired row) changes nothing and returns
 * null so the route can answer 409.
 */
export async function decideVerification(db, id, { status, decidedBy, nowIso }) {
  if (!db || typeof id !== 'string' || !id) return null;
  if (status !== 'approved' && status !== 'rejected') return null;
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const res = await db
    .prepare(
      `UPDATE phone_verifications
          SET status = ?1, decided_at = ?2, decided_by = ?3
        WHERE id = ?4 AND status = 'pending' AND expires_at > ?2`
    )
    .bind(status, stamp, decidedBy || null, id)
    .run();
  if ((Number(res?.meta?.changes) || 0) === 0) return null;
  return getVerificationById(db, id);
}

/**
 * Webhook matcher: every live pending row for a number (usually one, but two
 * members can legitimately verify the same family number). The code hash is
 * checked per row, so the message can only approve the row it was minted for.
 */
export async function listPendingVerificationsByPhone(db, phone, nowIso) {
  const digits = phoneOrNull(phone);
  if (!db || !digits) return [];
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const res = await db
    .prepare(
      `SELECT id, user_id, phone, reference, code_hash, status, lang, created_at, expires_at
         FROM phone_verifications
        WHERE phone = ?1 AND status = 'pending' AND expires_at > ?2
        ORDER BY created_at DESC
        LIMIT 10`
    )
    .bind(digits, stamp)
    .all();
  return res && Array.isArray(res.results) ? res.results : [];
}

/** Latest approved row for a number, still inside its 365-day window. */
export async function findValidVerificationByPhone(db, phone, nowMs = Date.now()) {
  const digits = phoneOrNull(phone);
  if (!db || !digits) return null;
  const cutoffIso = new Date(nowMs - VERIFICATION_VALIDITY_MS).toISOString();
  return db
    .prepare(
      `SELECT id, user_id, phone, reference, status, lang, created_at, expires_at, decided_at, decided_by
         FROM phone_verifications
        WHERE phone = ?1 AND status = 'approved' AND decided_at >= ?2
        ORDER BY decided_at DESC
        LIMIT 1`
    )
    .bind(digits, cutoffIso)
    .first();
}

/* ---------- WhatsApp webhook idempotency + cost guard ---------- */

/**
 * Claim a Meta message id before doing any work. The PK makes retries (and
 * duplicate webhook deliveries) a no-op. A stuck 'processing' row means the
 * worker died mid-flight; the member can request a fresh code.
 */
export async function claimWhatsAppEvent(db, { messageId, phone, nowIso }) {
  if (!db || typeof messageId !== 'string' || !messageId) return false;
  const stamp = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO whatsapp_webhook_events (message_id, phone, outcome, received_at)
       VALUES (?1, ?2, 'processing', ?3)`
    )
    .bind(messageId, phoneOrNull(phone), stamp)
    .run();
  return (Number(res?.meta?.changes) || 0) > 0;
}

/** Stamp the final outcome on a claimed message. Best effort. */
export async function finishWhatsAppEvent(db, messageId, outcome) {
  if (!db || typeof messageId !== 'string' || !messageId) return false;
  const res = await db
    .prepare('UPDATE whatsapp_webhook_events SET outcome = ?2 WHERE message_id = ?1')
    .bind(messageId, typeof outcome === 'string' ? outcome.slice(0, 40) : 'unknown')
    .run();
  return (Number(res?.meta?.changes) || 0) > 0;
}

/** Events since an ISO cutoff, optionally for one sender number. */
export async function countWhatsAppEventsSince(db, sinceIso, phone = null) {
  if (!db || typeof sinceIso !== 'string' || !sinceIso) return 0;
  const digits = phoneOrNull(phone);
  const row = digits
    ? await db
        .prepare(
          `SELECT COUNT(*) AS n FROM whatsapp_webhook_events
            WHERE received_at >= ?1 AND phone = ?2`
        )
        .bind(sinceIso, digits)
        .first()
    : await db
        .prepare('SELECT COUNT(*) AS n FROM whatsapp_webhook_events WHERE received_at >= ?1')
        .bind(sinceIso)
        .first();
  return Number(row?.n) || 0;
}

/** Retention sweep for the webhook audit table (90 days is plenty). */
export async function pruneWhatsAppEvents(db, beforeIso) {
  if (!db || typeof beforeIso !== 'string' || !beforeIso) return 0;
  const res = await db
    .prepare('DELETE FROM whatsapp_webhook_events WHERE received_at < ?1')
    .bind(beforeIso)
    .run();
  return Number(res?.meta?.changes) || 0;
}
