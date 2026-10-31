/**
 * POST /api/admin/trash/<id>/restore { baseVersion } — put a trashed item
 * or category back (recreating its category when missing).
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../../_shared/session.js';
import { logActivity } from '../../../../_shared/activity.js';
import {
  getActor,
  readTrash,
  removeTrashEntry,
  restoreValidatedMenu,
} from '../../../../_shared/versions.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  let id = typeof params?.id === 'string' ? params.id : '';
  try {
    id = decodeURIComponent(id);
  } catch { /* keep raw; the lookup below simply misses */ }
  let body;
  try {
    body = await readJsonBody(request, 1024);
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }
  const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : undefined;

  const entries = await readTrash(env);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return jsonNoStore({ ok: false, error: 'not_found' }, 404);

  let menu = null;
  try {
    menu = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (!menu || !Array.isArray(menu.items) || !Array.isArray(menu.categories)) {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  if (baseVersion !== undefined && menu.version !== baseVersion) {
    return jsonNoStore({ ok: false, error: 'conflict', version: menu.version }, 409);
  }

  const next = JSON.parse(JSON.stringify(menu));
  const hasId = (arr, x) => Array.isArray(arr) && arr.some((y) => y && y.id === x);
  if (entry.kind === 'item' && entry.data && entry.data.id) {
    let catId = entry.categoryId || (entry.data && entry.data.categoryId) || '';
    if (!hasId(next.categories, catId)) {
      const snap = entry.category && entry.category.id ? entry.category : null;
      const recreated = snap && snap.id === catId
        ? snap
        : { id: catId || `c_${Date.now().toString(36)}`, name: { en: 'Recovered', ar: 'مستعاد' }, visible: true };
      next.categories.push(recreated);
      catId = recreated.id;
    }
    if (!hasId(next.items, entry.data.id)) {
      const item = { ...entry.data, categoryId: catId };
      const siblings = next.items.filter((it) => it && it.categoryId === catId);
      const at = Math.min(Math.max(0, typeof entry.position === 'number' ? entry.position : siblings.length), siblings.length);
      // Insert at the position within this category's items.
      let seen = -1;
      let insertAt = next.items.length;
      for (let i = 0; i < next.items.length; i++) {
        if (next.items[i] && next.items[i].categoryId === catId) {
          seen += 1;
          if (seen === at) {
            insertAt = i;
            break;
          }
        }
      }
      next.items.splice(insertAt, 0, item);
    }
  } else if (entry.kind === 'category' && entry.data && entry.data.id) {
    if (!hasId(next.categories, entry.data.id)) {
      const at = Math.min(Math.max(0, typeof entry.position === 'number' ? entry.position : next.categories.length), next.categories.length);
      next.categories.splice(at, 0, entry.data);
    }
    for (const it of Array.isArray(entry.items) ? entry.items : []) {
      if (it && it.id && !hasId(next.items, it.id)) next.items.push({ ...it, categoryId: entry.data.id });
    }
  } else {
    return jsonNoStore({ ok: false, error: 'invalid_entry' }, 400);
  }

  const restored = await restoreValidatedMenu(env, request, {
    doc: next, prevDoc: menu, source: 'restore', expectedVersion: baseVersion,
  });
  if (restored.res) return restored.res;
  try {
    const nm = (entry.data && entry.data.name) || {};
    const name = nm.en || nm.ar || id;
    const nameAr = nm.ar || nm.en || id;
    const actor = await getActor(request, env);
    await logActivity(env, {
      actor,
      action: 'trash.restore',
      label: {
        en: `Restored ${entry.kind} "${name}" from trash`,
        ar: `استرجاع ${entry.kind === 'item' ? 'الصنف' : 'القسم'} "${nameAr}" من المحذوفات`,
      },
    });
  } catch {}
  await removeTrashEntry(env, id);
  return jsonNoStore({ ok: true, version: restored.doc.version });
}
