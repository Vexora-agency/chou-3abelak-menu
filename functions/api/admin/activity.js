/**
 * GET /api/admin/activity — newest-first admin activity feed (who did what).
 * OWNER-ONLY: this is the movement log — client logins must never see it
 * (their own actions stay invisible to them; only the owner watches).
 */

import { checkApiHeaders, jsonNoStore } from '../../_shared/session.js';
import { requireOwner } from '../../_shared/access.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import { listActivity } from '../../_shared/activity.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'backups')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);
  if (!(await requireOwner(request, env))) return jsonNoStore({ error: 'forbidden' }, 403);

  let limit = 100;
  try {
    const url = new URL(request.url);
    const l = Number(url.searchParams.get('limit'));
    if (Number.isFinite(l) && l > 0) limit = Math.min(Math.floor(l), 200);
  } catch {}
  return jsonNoStore({ activity: await listActivity(env, limit) });
}
