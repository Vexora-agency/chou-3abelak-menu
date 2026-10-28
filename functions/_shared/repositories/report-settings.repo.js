/**
 * Repository: report_settings table.
 * Single place for the SELECT/UPSERT/verify queries used by report-settings routes + confirm link.
 * Canonical settings SELECT lives in ./reports.repo.js (no duplication);
 * the `getReportSettings` compat alias stays here because confirm.js +
 * versions.js import it alongside the UPSERT helpers.
 */
import { getReportSettingsRow } from './reports.repo.js';

export { getReportSettingsRow };
export { getReportSettings } from '../reports.js';

export async function upsertReportSettings(db, { enabled, email, verified, language, tokenHash, expiresAt, nowIso }) {
  await db
    .prepare(
      'INSERT INTO report_settings (id, enabled, email, verified, language, verify_token_hash, verify_expires_at, updated_at) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7) ' +
        'ON CONFLICT(id) DO UPDATE SET enabled = ?1, email = ?2, verified = ?3, language = ?4, verify_token_hash = ?5, verify_expires_at = ?6, updated_at = ?7'
    )
    .bind(enabled ? 1 : 0, email, verified, language, tokenHash, expiresAt, nowIso)
    .run();
}

export async function updateVerifyToken(db, hash, expiresAt, nowIso) {
  await db
    .prepare('UPDATE report_settings SET verify_token_hash = ?1, verify_expires_at = ?2, updated_at = ?3 WHERE id = 1')
    .bind(hash, expiresAt, nowIso)
    .run();
}

export async function confirmReportEmail(db, nowIso) {
  await db
    .prepare('UPDATE report_settings SET verified = 1, verify_token_hash = NULL, verify_expires_at = NULL, updated_at = ?1 WHERE id = 1')
    .bind(nowIso)
    .run();
}
