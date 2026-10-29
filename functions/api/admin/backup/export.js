/**
 * GET /api/admin/backup/export — full signed backup envelope:
 * { format:'chou-backup', schemaVersion, exportedAt, siteId, menu, sig }
 * sig = HMAC-SHA256(BACKUP_SECRET) over the canonical JSON of the rest.
 * Never contains secrets (the menu holds business data only).
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';
import { backupEnvelope, getSiteId, signPayload } from '../../../_shared/versions.js';
import { businessTimezone, fileDate, readLiveMenu } from '../../../_shared/reports.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'backups')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  const menu = await readLiveMenu(env);
  if (!menu) return jsonNoStore({ error: 'unavailable' }, 503);

  const timezone = await businessTimezone(env);
  const envelope = backupEnvelope({ menu, siteId: await getSiteId(env), exportedAt: new Date().toISOString() });
  let sig;
  try {
    sig = await signPayload(env, envelope);
  } catch {
    return jsonNoStore({ error: 'backup_unconfigured', message: 'BACKUP_SECRET is not configured' }, 503);
  }
  // JSON download: unified helper + attachment disposition via extraHeaders.
  return jsonNoStore({ ...envelope, sig }, 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="chou3abelak-backup-${fileDate(timezone)}.json"`,
  });
}
