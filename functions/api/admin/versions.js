/**
 * GET /api/admin/versions — version history (newest first, metadata only)
 * plus the backup status card data. Works on every plan (no feature gate).
 */

import { checkApiHeaders, jsonNoStore } from '../../_shared/session.js';
import { getAutoBackup, listVersions } from '../../_shared/versions.js';
import { getReportSettings } from '../../_shared/reports.js';

export async function onRequest(context) {
  const { request, env } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  const versions = await listVersions(env);
  const auto = await getAutoBackup(env);
  let destination;
  try {
    const rs = env.ORDERS_DB ? await getReportSettings(env.ORDERS_DB) : null;
    if (rs && rs.verified && rs.email) destination = rs.email;
  } catch {}
  return jsonNoStore({
    versions,
    status: { lastBackupAt: auto.lastBackupAt || undefined, autoWeekly: auto.enabled, destination },
  });
}
