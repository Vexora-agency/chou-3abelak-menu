/**
 * GET /api/admin/versions/<id>/changes — diff that version vs the live menu.
 */

import { checkApiHeaders, jsonNoStore } from '../../../../_shared/session.js';
import { diffMenus } from '../../../../_shared/diff.js';
import { getVersionDoc } from '../../../../_shared/versions.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  const id = typeof params?.id === 'string' ? params.id : '';
  const stored = await getVersionDoc(env, id);
  if (!stored) return jsonNoStore({ error: 'not_found' }, 404);

  let current = null;
  try {
    current = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (!current) return jsonNoStore({ error: 'unavailable' }, 503);

  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  let changes = [];
  try {
    changes = diffMenus(stored.menu, current, lang);
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  return jsonNoStore({ changes });
}
