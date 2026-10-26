/**
 * GET /api/admin/backup/export — full signed backup envelope:
 * { format:'chou-backup', schemaVersion, exportedAt, siteId, menu, sig }
 * sig = HMAC-SHA256(BACKUP_SECRET) over the canonical JSON of the rest.
 * Never contains secrets (the menu holds business data only).
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { backupEnvelope, getSiteId, signPayload } from '../../../_shared/versions.js';
import { loadMenuBasics } from '../../../_shared/reports.js';

function fileDate(timezone) {
  // YYYY-MM-DD in the business timezone.
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return parts;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  let menu = null;
  try {
    menu = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (!menu) return jsonNoStore({ error: 'unavailable' }, 503);

  let timezone = 'Asia/Beirut';
  try {
    const basics = await loadMenuBasics(env);
    if (basics && basics.timezone) timezone = basics.timezone;
  } catch {}
  const envelope = backupEnvelope({ menu, siteId: await getSiteId(env), exportedAt: new Date().toISOString() });
  let sig;
  try {
    sig = await signPayload(env, envelope);
  } catch {
    return jsonNoStore({ error: 'backup_unconfigured', message: 'BACKUP_SECRET is not configured' }, 503);
  }
  return new Response(JSON.stringify({ ...envelope, sig }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="chou3abelak-backup-${fileDate(timezone)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
