/**
 * POST /api/admin/ordering/enabled — master online-ordering switch.
 * Body { enabled: boolean }. Read-modify-write of the menu with retry on
 * version conflict (3 attempts); changes ONLY settings.ordering.enabled,
 * goes through strict validation (which requires a WhatsApp number when
 * enabling — the write is rejected otherwise), and snapshots the previous
 * version (source 'manual').
 * Admin session + X-Requested-With + same Origin required.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import { validateMenu } from '../../../_shared/validate.js';
import { getActor, purgeOrderingState, purgePublicMenu, snapshotMenu } from '../../../_shared/versions.js';

export async function onRequest(context) {
  const { request, env } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  let body;
  try {
    body = await readJsonBody(request, 1024);
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }
  if (!body || typeof body.enabled !== 'boolean') {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }

  const actor = await getActor(request, env);
  for (let attempt = 0; attempt < 3; attempt++) {
    let current = null;
    try {
      current = await env.MENU_KV.get('menu', { type: 'json' });
    } catch {}
    if (!current) return jsonNoStore({ ok: false, error: 'unavailable' }, 503);

    const next = JSON.parse(JSON.stringify(current));
    if (!next.settings || typeof next.settings !== 'object') next.settings = {};
    if (!next.settings.ordering || typeof next.settings.ordering !== 'object') next.settings.ordering = {};
    next.settings.ordering.enabled = body.enabled;
    const validation = validateMenu(next);
    if (!validation.ok) return jsonNoStore({ ok: false, error: 'validation_error' }, 400);

    // Optimistic write: re-read inside the attempt would race; instead write
    // only when the version still matches what we read (read-modify-write).
    try {
      const latest = await env.MENU_KV.get('menu', { type: 'json' });
      const latestVersion = latest && typeof latest.version === 'number' ? latest.version : 0;
      const readVersion = current && typeof current.version === 'number' ? current.version : 0;
      if (latestVersion !== readVersion) continue; // conflict -> retry
      const doc = {
        ...validation.value,
        version: readVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      await snapshotMenu(env, { prevDoc: current, incomingDoc: doc, source: 'manual', actor });
      await env.MENU_KV.put('menu', JSON.stringify(doc));
      await purgePublicMenu(request);
      await purgeOrderingState(request);
      return jsonNoStore({ ok: true, enabled: doc.settings.ordering.enabled, version: doc.version });
    } catch {
      return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
    }
  }
  return jsonNoStore({ ok: false, error: 'conflict' }, 409);
}
