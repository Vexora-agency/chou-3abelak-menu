/**
 * GET /api/admin/versions/<id>/changes — the version's OWN changes.
 * OWNER-ONLY (same reason as the listing): review content belongs to the
 * owner's eyes only.
 *
 * Each version row stores the menu as it was BEFORE its save, so the row's
 * truthful content is the step to its next-newer neighbor (exactly what its
 * badges were counted from at save time). Comparing against live instead
 * repeats every later save's changes inside EVERY older review — the same
 * cumulative list everywhere ("duplicated versions"). Only the newest row
 * has no neighbor and still compares against live.
 */

import { checkApiHeaders, getSessionCookie, getSessionSecret, jsonNoStore, verifySessionToken } from '../../../../_shared/session.js';
import { requireOwner } from '../../../../_shared/access.js';
import { featureOffResponse, hasFeature } from '../../../../_shared/plan.js';
import { diffMenus } from '../../../../_shared/diff.js';
import { getVersionDoc, listVersions, getVersionDoc as getV } from '../../../../_shared/versions.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!hasFeature(env, 'backups')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  const rawId = typeof params?.id === 'string' ? params.id : '';
  let id = rawId;
  try {
    id = decodeURIComponent(id);
  } catch {
    return jsonNoStore({ error: 'not_found' }, 404);
  }
  const stored = await getVersionDoc(env, id);
  if (!stored) return jsonNoStore({ error: 'not_found' }, 404);
  // Clients review only their own snapshots; anything else is 404
  // (indistinguishable from missing — no enumeration oracle).
  if (!(await requireOwner(request, env))) {
    let sub = '';
    try {
      const secret = getSessionSecret(env);
      const token = getSessionCookie(request);
      if (secret && token) {
        const payload = await verifySessionToken(secret, token);
        if (payload && typeof payload.sub === 'string') sub = payload.sub;
      }
    } catch {}
    if (!sub || stored.actor !== sub) return jsonNoStore({ error: 'not_found' }, 404);
  }

  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';

  // Next-newer surviving snapshot (list is newest-first, so index-1).
  // Pruning may have eaten intermediates — the step then aggregates the
  // gap, still truthful about what this row's span contains.
  let compareTo = null;
  let comparedTo = 'live';
  try {
    const all = await listVersions(env);
    const idx = all.findIndex((e) => e && e.id === id);
    const next = idx >= 0 ? all[idx - 1] : null;
    if (next && next.id) {
      const nd = await getV(env, next.id);
      if (nd && nd.menu && typeof nd.menu === 'object') {
        compareTo = nd.menu;
        comparedTo = 'version';
      }
    }
  } catch {}
  if (!compareTo) {
    try {
      compareTo = await env.MENU_KV.get('menu', { type: 'json' });
    } catch {}
    if (!compareTo) return jsonNoStore({ error: 'unavailable' }, 503);
  }

  let changes;
  try {
    changes = diffMenus(stored.menu, compareTo, lang);
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  return jsonNoStore({ changes, comparedTo });
}
