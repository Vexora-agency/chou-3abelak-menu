/**
 * Repository: monthly_reports + report email state + report queries.
 * Canonical home for ALL reports-domain SQL. Domain files
 * (`../reports.js`, `../reports-generation.js`, `../reports-retention.js`)
 * call these helpers and never use `db.prepare` directly.
 * This file imports nothing from `../reports*.js` (no cycles).
 */

export async function listMonthlyReportSummaries(db) {
  const res = await db
    .prepare('SELECT month, summary_json, emailed_at, email_status FROM monthly_reports ORDER BY month DESC')
    .all();
  return (res && res.results) || [];
}

async function updateAttemptState(db, month, attempts, status) {
  await db
    .prepare('UPDATE monthly_reports SET email_attempts = ?1, email_status = ?2 WHERE month = ?3')
    .bind(attempts, status, month)
    .run();
}

export async function markReportPending(db, month, attempts) {
  return updateAttemptState(db, month, attempts, 'pending');
}

export async function markReportSent(db, month, nowIso) {
  await db
    .prepare("UPDATE monthly_reports SET emailed_at = ?1, email_status = 'sent' WHERE month = ?2")
    .bind(nowIso, month)
    .run();
}

export async function markReportAttempt(db, month, attempts, maxAttempts) {
  // maxAttempts comes from the caller (route MAX_ATTEMPTS) — never hardcoded here.
  return updateAttemptState(db, month, attempts, attempts >= maxAttempts ? 'failed' : 'pending');
}

export async function markReportFailed(db, month) {
  await db.prepare("UPDATE monthly_reports SET email_status = 'failed' WHERE month = ?1").bind(month).run();
}

/* ---------- Settings (canonical; ../reports.js re-exports for compat) ---------- */

export async function getReportSettingsRow(db) {
  return db.prepare('SELECT * FROM report_settings WHERE id = 1').first();
}

/* ---------- Aggregation (canonical; ../reports-generation.js delegates) ---------- */

export async function countRevenueByBounds(db, startISO, endISO) {
  // Revenue baseline: fulfilled orders only (see summarizeMonth rule).
  return db
    .prepare(
      "SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS rev FROM orders WHERE created_at >= ?1 AND created_at < ?2 AND status = 'completed'"
    )
    .bind(startISO, endISO)
    .first();
}

export async function countByStatusByBounds(db, startISO, endISO) {
  const st = await db
    .prepare('SELECT status, COUNT(*) AS c FROM orders WHERE created_at >= ?1 AND created_at < ?2 GROUP BY status')
    .bind(startISO, endISO)
    .all();
  return (st && st.results) || [];
}

export async function fetchOrderRowsByBounds(db, startISO, endISO) {
  const res = await db
    .prepare(
      'SELECT id, number, created_at, type, status, items_json, subtotal, delivery_fee, total FROM orders WHERE created_at >= ?1 AND created_at < ?2 ORDER BY number ASC'
    )
    .bind(startISO, endISO)
    .all();
  return (res && res.results) || [];
}

export async function readMonthlyReportRow(db, month) {
  return db.prepare('SELECT * FROM monthly_reports WHERE month = ?1').bind(month).first();
}

export async function insertMonthlyReportRow(db, { month, summaryJson, csvKey, generatedAt }) {
  await db
    .prepare('INSERT INTO monthly_reports (month, summary_json, csv_key, generated_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(month, summaryJson, csvKey, generatedAt)
    .run();
}

/* ---------- Retention (canonical; ../reports-retention.js delegates) ---------- */

export async function listReportedMonths(db) {
  const res = await db.prepare('SELECT month FROM monthly_reports').all();
  const out = [];
  for (const r of (res && res.results) || []) {
    if (typeof r.month === 'string') out.push(r.month);
  }
  return out;
}

export async function getOldestOrderMonth(db) {
  return db.prepare('SELECT MIN(created_at) AS m FROM orders').first();
}

export async function purgeOldPII(db, nowIso, cutoff) {
  const r = await db
    .prepare(
      'UPDATE orders SET customer_name = NULL, customer_phone = NULL, phone_norm = NULL, customer_address = NULL, notes = NULL, location_lat = NULL, location_lng = NULL, pii_purged_at = ?1 WHERE created_at < ?2 AND pii_purged_at IS NULL'
    )
    .bind(nowIso, cutoff)
    .run();
  return (r && r.meta && typeof r.meta.changes === 'number') ? r.meta.changes : 0;
}

export async function deleteOldOrders(db, cutoff) {
  const r = await db
    .prepare('DELETE FROM orders WHERE created_at < ?1 AND pii_purged_at IS NOT NULL')
    .bind(cutoff)
    .run();
  return (r && r.meta && typeof r.meta.changes === 'number') ? r.meta.changes : 0;
}

export async function listOldReportMonths(db, rptCut) {
  const res = await db.prepare('SELECT month FROM monthly_reports WHERE month < ?1').bind(rptCut).all();
  return ((res && res.results) || []).map((r) => r.month).filter((m) => typeof m === 'string');
}

export async function deleteOldReports(db, rptCut) {
  const del = await db.prepare('DELETE FROM monthly_reports WHERE month < ?1').bind(rptCut).run();
  return (del && del.meta && typeof del.meta.changes === 'number') ? del.meta.changes : 0;
}
