/**
 * Repository: monthly_reports + report email state.
 * Wraps the UPDATE/LIST queries used by admin/reports + internal/run-reports routes.
 * Read aggregation stays in `../reports*.js`; only route-inline SQL moves here.
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
