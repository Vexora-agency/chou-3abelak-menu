/**
 * PUT /api/admin/backup/auto { enabled } — weekly email backup switch.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import { requireOwner } from '../../../_shared/access.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';
import { getAutoBackup, setAutoBackup } from '../../../_shared/versions.js';
import { getReportSettings } from '../../../_shared/reports.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'backups')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'PUT') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'PUT' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);
  let body;
  try {
    body = await readJsonBody(request, 1024);
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }
  if (typeof body.enabled !== 'boolean') return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  // Account-level switch: owner-only (a client must never arm/disarm it).
  if (!(await requireOwner(request, env))) return jsonNoStore({ error: 'forbidden' }, 403);
  // Enabling without a verified destination email is refused outright —
  // the switch must never read ON while there is nowhere to send to
  // (stale enabled:true + wiped email produced exactly that ghost state).
  // Disabling always succeeds (fail-safe direction needs no email).
  if (body.enabled === true) {
    let dest = null;
    try {
      const rs = env.ORDERS_DB ? await getReportSettings(env.ORDERS_DB) : null;
      if (rs && rs.enabled && rs.verified && rs.email) dest = rs.email;
    } catch {}
    if (!dest) {
      return jsonNoStore({ ok: false, error: 'no_destination', message: 'Set a verified report email first' }, 400);
    }
  }
  const prev = await getAutoBackup(env);
  const ok = await setAutoBackup(env, { enabled: body.enabled, lastBackupAt: prev.lastBackupAt });
  if (!ok) return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  return jsonNoStore({ ok: true, autoWeekly: body.enabled });
}
