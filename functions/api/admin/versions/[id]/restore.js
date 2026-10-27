/**
 * POST /api/admin/versions/<id>/restore — snapshot the live menu first
 * (source 'restore', the undo safety copy), then write the version's
 * document with version+1. Optional { expectedVersion } for concurrency.
 */

import { checkApiHeaders, jsonNoStore } from '../../../../_shared/session.js';
import { getVersionDoc, getActor, restoreValidatedMenu } from '../../../../_shared/versions.js';
import { logActivity } from '../../../../_shared/activity.js';

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

  let current = null;
  try {
    current = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (!current) return jsonNoStore({ ok: false, error: 'unavailable' }, 503);

  const restored = await restoreValidatedMenu(env, request, {
    doc: stored.menu, prevDoc: current, source: 'restore', expectedVersion, invalidError: 'invalid_version',
  });
  if (restored.res) return restored.res;
  try {
    const actor = await getActor(request, env);
    await logActivity(env, {
      actor,
      action: 'version.restore',
      label: {
        en: `Restored backup version (now v${restored.doc.version})`,
        ar: `استرجاع نسخة احتياطية (الآن الإصدار ${restored.doc.version})`,
      },
    });
  } catch {}
  return jsonNoStore({ ok: true, version: restored.doc.version });
}
