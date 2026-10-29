/**
 * DELETE /api/admin/trash/<id> — delete a trash entry forever.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';
import { logActivity } from '../../../_shared/activity.js';
import { getActor, readTrash, removeTrashEntry } from '../../../_shared/versions.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!hasFeature(env, 'backups')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'DELETE') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'DELETE' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  let id = typeof params?.id === 'string' ? params.id : '';
  try {
    id = decodeURIComponent(id);
  } catch { /* keep raw; the lookup below simply misses */ }
  let goneName = { en: '', ar: '' };
  let goneKind = '';
  try {
    const entries = await readTrash(env);
    const found = entries.find((e) => e && e.id === id);
    if (found) {
      goneKind = found.kind === 'item' ? 'item' : 'category';
      if (found.data && found.data.name) goneName = found.data.name;
    }
  } catch {}
  const removed = await removeTrashEntry(env, id);
  if (!removed) return jsonNoStore({ ok: false, error: 'not_found' }, 404);
  try {
    const name = goneName.en || goneName.ar || id;
    const nameAr = goneName.ar || goneName.en || id;
    const actor = await getActor(request, env);
    await logActivity(env, {
      actor,
      action: 'trash.delete',
      label: {
        en: `Permanently deleted ${goneKind || 'entry'} "${name}"`,
        ar: `حذف نهائي ${goneKind === 'category' ? 'للقسم' : 'للصنف'} "${nameAr}"`,
      },
    });
  } catch {}
  return jsonNoStore({ ok: true });
}
