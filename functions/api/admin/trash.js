/**
 * Trash: GET /api/admin/trash (auto-purges entries older than 30 days),
 * POST /api/admin/trash { kind: 'item'|'category', id, baseVersion } —
 * moves the object into the trash (server-side menu edit + version
 * snapshot + version bump). Works on every plan.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { validateMenu } from '../../_shared/validate.js';
import { logActivity } from '../../_shared/activity.js';
import {
  getActor,
  pushTrash,
  readTrash,
  snapshotMenu,
  toTrashList,
  writeMenuVersioned,
} from '../../_shared/versions.js';

export async function onRequest(context) {
  const { request, env } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  if (request.method === 'GET') {
    const entries = await readTrash(env);
    return jsonNoStore({ trash: toTrashList(entries) });
  }

  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });

  let body;
  try {
    body = await readJsonBody(request, 4 * 1024);
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }
  const kind = body.kind === 'item' || body.kind === 'category' ? body.kind : null;
  const id = typeof body.id === 'string' && body.id ? body.id.slice(0, 128) : '';
  const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : undefined;
  if (!kind || !id) return jsonNoStore({ ok: false, error: 'bad_request' }, 400);

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
  let entry;
  if (kind === 'item') {
    const idx = next.items.findIndex((it) => it && it.id === id);
    if (idx < 0) return jsonNoStore({ ok: false, error: 'not_found' }, 404);
    const [removed] = next.items.splice(idx, 1);
    const position = menu.items.filter((it) => it && it.categoryId === removed.categoryId).findIndex((it) => it.id === id);
    const category = menu.categories.find((c) => c && c.id === removed.categoryId) || null;
    entry = { kind: 'item', data: removed, categoryId: removed.categoryId || '', category, position: position < 0 ? 0 : position };
  } else {
    const idx = next.categories.findIndex((c) => c && c.id === id);
    if (idx < 0) return jsonNoStore({ ok: false, error: 'not_found' }, 404);
    const [removedCat] = next.categories.splice(idx, 1);
    const removedItems = next.items.filter((it) => it && it.categoryId === id);
    next.items = next.items.filter((it) => !(it && it.categoryId === id));
    entry = { kind: 'category', data: removedCat, items: removedItems, position: idx };
  }

  const validation = validateMenu(next);
  if (!validation.ok) return jsonNoStore({ ok: false, error: 'invalid_menu' }, 400);

  const actor = await getActor(request, env);
  try {
    await snapshotMenu(env, { prevDoc: menu, incomingDoc: validation.value, source: 'manual', actor });
  } catch {}
  let written;
  try {
    written = await writeMenuVersioned(env, validation.value, baseVersion);
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  if (!written.ok) return jsonNoStore({ ok: false, error: 'conflict', version: written.current ? written.current.version : null }, 409);
  const saved = await pushTrash(env, entry);
  try {
    const nm = (entry.data && entry.data.name) || {};
    const name = nm.en || nm.ar || id;
    const nameAr = nm.ar || nm.en || id;
    await logActivity(env, {
      actor,
      action: kind === 'item' ? 'item.delete' : 'category.delete',
      label: {
        en: `Deleted ${kind} "${name}" (restorable from trash)`,
        ar: `حذف ${kind === 'item' ? 'الصنف' : 'القسم'} "${nameAr}" (يمكن استرجاعه من المحذوفات)`,
      },
      ref: { kind: 'trash', id: saved.id },
    });
  } catch {}
  return jsonNoStore({ ok: true, trashId: saved.id, version: written.doc.version });
}
