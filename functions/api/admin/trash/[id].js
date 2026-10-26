/**
 * DELETE /api/admin/trash/<id> — delete a trash entry forever.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { removeTrashEntry } from '../../../_shared/versions.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'DELETE') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'DELETE' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  const id = typeof params?.id === 'string' ? params.id : '';
  const removed = await removeTrashEntry(env, id);
  if (!removed) return jsonNoStore({ ok: false, error: 'not_found' }, 404);
  return jsonNoStore({ ok: true });
}
