/**
 * POST /api/admin/versions/<id>/restore — snapshot the live menu first
 * (source 'restore', the undo safety copy), then write the version's
 * document with version+1. Optional { expectedVersion } for concurrency.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../../_shared/session.js';
import { validateMenu } from '../../../../_shared/validate.js';
import { getActor, getVersionDoc, snapshotMenu, writeMenuVersioned } from '../../../../_shared/versions.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  const id = typeof params?.id === 'string' ? params.id : '';
  const stored = await getVersionDoc(env, id);
  if (!stored || !stored.menu) return jsonNoStore({ ok: false, error: 'not_found' }, 404);

  let body = {};
  try {
    const raw = await request.text();
    if (raw && raw.length) {
      if (raw.length > 1024) return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
      body = JSON.parse(raw) || {};
    }
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }
  const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined;

  const validation = validateMenu(stored.menu);
  if (!validation.ok) return jsonNoStore({ ok: false, error: 'invalid_version' }, 400);

  let current = null;
  try {
    current = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (!current) return jsonNoStore({ ok: false, error: 'unavailable' }, 503);

  const actor = await getActor(request, env);
  try {
    await snapshotMenu(env, { prevDoc: current, incomingDoc: validation.value, source: 'restore', actor });
  } catch {}
  let written;
  try {
    written = await writeMenuVersioned(env, validation.value, expectedVersion);
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  if (!written.ok) return jsonNoStore({ ok: false, error: 'conflict', version: written.current ? written.current.version : null }, 409);
  return jsonNoStore({ ok: true, version: written.doc.version });
}
