/**
 * GET /api/admin/versions — version history (newest first, metadata only)
 * plus the backup status card data. Works on every plan (no feature gate).
 *
 * Visibility rule (master invisibility): the owner sees EVERYTHING with
 * actor marks; a client session sees ONLY rows authored by itself — owner
 * rows never leave the server for them, so no pill, name or count can leak
 * the master layer. The destination email never goes to clients either.
 */

import { checkApiHeaders, getSessionCookie, getSessionSecret, jsonNoStore, verifySessionToken } from '../../_shared/session.js';
import { requireOwner } from '../../_shared/access.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import { getAutoBackup, listVersions } from '../../_shared/versions.js';
import { getReportSettings } from '../../_shared/reports.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'backups')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  const owner = await requireOwner(request, env);
  const all = await listVersions(env);
  if (owner) {
    const auto = await getAutoBackup(env);
    let destination;
    try {
      const rs = env.ORDERS_DB ? await getReportSettings(env.ORDERS_DB) : null;
      if (rs && rs.verified && rs.email) destination = rs.email;
    } catch {}
    return jsonNoStore({
      versions: all,
      status: { lastBackupAt: auto.lastBackupAt || undefined, autoWeekly: auto.enabled, destination },
      isOwner: true,
    });
  }
  // Client: own rows only (actor is the session sub, e.g. client:layali).
  // Legacy rows ('owner'/'local'/...) belong to the master — invisible here.
  let sub = '';
  try {
    const secret = getSessionSecret(env);
    const token = getSessionCookie(request);
    if (secret && token) {
      const payload = await verifySessionToken(secret, token);
      if (payload && typeof payload.sub === 'string') sub = payload.sub;
    }
  } catch {}
  if (!sub) return jsonNoStore({ error: 'forbidden' }, 403);
  return jsonNoStore({
    versions: all.filter((v) => v && v.actor === sub),
    status: { autoWeekly: false },
    isOwner: false,
  });
}
