/**
 * GET /api/admin/activity — newest-first admin activity feed (who did what).
 * Same visibility rule as versions: owner sees all (marked), a client sees
 * only entries authored by itself. Master invisibility holds end to end.
 */

import { checkApiHeaders, getSessionCookie, getSessionSecret, jsonNoStore, verifySessionToken } from '../../_shared/session.js';
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

  const owner = await requireOwner(request, env);
  const all = await listActivity(env, limitOf(request));
  if (owner) return jsonNoStore({ activity: all, isOwner: true });
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
  return jsonNoStore({ activity: all.filter((e) => e && e.actor === sub), isOwner: false });
}

function limitOf(request) {
  let limit = 100;
  try {
    const url = new URL(request.url);
    const l = Number(url.searchParams.get('limit'));
    if (Number.isFinite(l) && l > 0) limit = Math.min(Math.floor(l), 200);
  } catch {}
  return limit;
}
