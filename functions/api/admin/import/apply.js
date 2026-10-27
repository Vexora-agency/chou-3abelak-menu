/**
 * POST /api/admin/import/apply { token, includeSettings } — two-step
 * import, step 2. Single-use token (deleted first), session-bound, rate
 * limited (5/hour). Snapshots the live menu first (source 'import').
 *
 * Unsigned files change items/categories/addonGroups ONLY — settings,
 * ordering and contact data are never touched. includeSettings is honored
 * for signed files (the panel additionally requires typing APPLY).
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import { getSessionCookie, getSessionSecret, verifySessionToken } from '../../../_shared/session.js';
import { validateMenu } from '../../../_shared/validate.js';
import { IMPORT_KEY, applyCSVToMenu, getActor, snapshotMenu, writeMenuVersioned } from '../../../_shared/versions.js';
import { hitRateLimit } from '../../../_shared/ratelimit.js';

async function sessionSub(request, env) {
  try {
    const secret = getSessionSecret(env);
    if (secret) {
      const token = getSessionCookie(request);
      if (token) {
        const payload = await verifySessionToken(secret, token);
        if (payload && typeof payload.sub === 'string' && payload.sub) return payload.sub;
      }
    }
  } catch {}
  try {
    const url = new URL(request.url);
    if (env.ALLOW_LOCAL_DEV === '1' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return 'local';
  } catch {}
  return 'access';
}

export async function onRequest(context) {
  const { request, env } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  if (!(await hitRateLimit(env.MENU_KV, 'rl:import-apply', 5, 3600))) {
    return jsonNoStore({ ok: false, error: 'rate_limited' }, 429);
  }

  let body;
  try {
    body = await readJsonBody(request, 1024);
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }
  const token = typeof body.token === 'string' && /^[0-9a-f]{32}$/.test(body.token) ? body.token : '';
  const includeSettings = body.includeSettings === true;
  if (!token) return jsonNoStore({ ok: false, error: 'bad_request' }, 400);

  let staged = null;
  try {
    staged = await env.MENU_KV.get(IMPORT_KEY(token), { type: 'json' });
  } catch {}
  if (!staged || typeof staged !== 'object') return jsonNoStore({ ok: false, error: 'invalid_token' }, 400);
  const sub = await sessionSub(request, env);
  if (!staged.session || staged.session !== sub) return jsonNoStore({ ok: false, error: 'invalid_token' }, 403);
  // Single use: burn the token before doing anything else.
  try {
    await env.MENU_KV.delete(IMPORT_KEY(token));
  } catch {}

  let current = null;
  try {
    current = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (!current) return jsonNoStore({ ok: false, error: 'unavailable' }, 503);

  let merged;
  try {
    if (staged.kind === 'csv') {
      const applied = applyCSVToMenu(current, staged.csvText || '');
      merged = applied.menu;
    } else if (staged.kind === 'json' && staged.doc) {
      if (staged.signed && includeSettings) {
        merged = staged.doc;
      } else {
        merged = {
          ...current,
          categories: Array.isArray(staged.doc.categories) ? staged.doc.categories : current.categories,
          items: Array.isArray(staged.doc.items) ? staged.doc.items : current.items,
          addonGroups: Array.isArray(staged.doc.addonGroups) ? staged.doc.addonGroups : current.addonGroups,
        };
      }
    } else {
      return jsonNoStore({ ok: false, error: 'invalid_token' }, 400);
    }
    const v = validateMenu(merged);
    if (!v.ok) return jsonNoStore({ ok: false, error: 'validation_error', message: v.errors.join('; ') }, 400);
    merged = v.value;
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }

  const actor = await getActor(request, env);
  try {
    await snapshotMenu(env, { prevDoc: current, incomingDoc: merged, source: 'import', actor });
  } catch {}
  let written;
  try {
    written = await writeMenuVersioned(env, merged);
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  if (!written.ok) return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  return jsonNoStore({ ok: true, version: written.doc.version });
}
