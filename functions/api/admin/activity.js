/**
 * GET /api/admin/activity — newest-first admin activity feed (who did what).
 */

import { checkApiHeaders, jsonNoStore } from '../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import { listActivity } from '../../_shared/activity.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'backups')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  let limit = 100;
  try {
    const url = new URL(request.url);
    const l = Number(url.searchParams.get('limit'));
    if (Number.isFinite(l) && l > 0) limit = Math.min(Math.floor(l), 200);
  } catch {}
  return jsonNoStore({ activity: await listActivity(env, limit) });
}
