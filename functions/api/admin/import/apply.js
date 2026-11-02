/**
 * POST /api/admin/import/apply { token, includeSettings } — two-step
 * import, step 2. Single-use token (deleted first), session-bound, rate
 * limited (10/hour shared — 5 proved too tight while troubleshooting).
 * Snapshots the live menu first (source 'import').
 *
 * Unsigned files change items/categories/addonGroups ONLY — settings,
 * ordering and contact data are never touched. includeSettings is honored
 * for signed files (the panel additionally requires typing APPLY).
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import { getSessionCookie, getSessionSecret, verifySessionToken } from '../../../_shared/session.js';
import { validateMenu } from '../../../_shared/validate.js';
import { IMPORT_KEY, applyCSVToMenu, getActor, purgeMenuCaches, snapshotMenu, writeMenuVersioned } from '../../../_shared/versions.js';
import { hitRateLimit } from '../../../_shared/ratelimit.js';
import { logActivity } from '../../../_shared/activity.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';

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
  if (!hasFeature(env, 'backups')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  // 10 applies/hour: each apply is a full-menu write by an authenticated
  // admin, version-guarded and restorable — the cap exists to stop
  // runaway loops, not to punish legit retry cycles (5 proved too tight
  // while troubleshooting an upload: every click counts, pass or fail).
  if (!(await hitRateLimit(env.MENU_KV, 'rl:import-apply', 10, 3600))) {
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
  const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : undefined;

  let staged = null;
  try {
    staged = await env.MENU_KV.get(IMPORT_KEY(token), { type: 'json' });
  } catch {}
  if (!staged || typeof staged !== 'object') return jsonNoStore({ ok: false, error: 'invalid_token' }, 400);
  const sub = await sessionSub(request, env);
  if (!staged.session || staged.session !== sub) return jsonNoStore({ ok: false, error: 'invalid_token' }, 403);
  // Concurrency BEFORE the burn: a stale apply 409s with its token intact,
  // so the owner simply presses Apply again (nothing is lost, no dup row).
  let current = null;
  try {
    current = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (!current) return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  if (baseVersion !== undefined && current.version !== baseVersion) {
    return jsonNoStore({ ok: false, error: 'conflict', version: current.version }, 409);
  }
  // Single use: burn the token before doing anything else.
  try {
    await env.MENU_KV.delete(IMPORT_KEY(token));
  } catch {}

  // Unsigned files must NEVER grow the feature library: validation
  // auto-creates defs for unknown ids, so strip them (and legacy
  // addonGroups, which also mint defs) BEFORE validate. Known = the live
  // library only. Empty live library = cannot judge → skip stripping.
  const liveDefs = current && current.settings && Array.isArray(current.settings.featureDefs)
    ? current.settings.featureDefs : [];
  const knownIds = new Set(liveDefs.map((d) => d && d.id).filter((x) => typeof x === 'string' && x));
  const stripUnknownFeatures = (items) => (Array.isArray(items) ? items : []).map((it) => {
    if (!it || typeof it !== 'object') return it;
    const out = { ...it };
    if (Array.isArray(out.variants)) {
      out.variants = out.variants.filter((v) => v && knownIds.has(v.featureId || v.id));
      if (out.defaultVariant && !out.variants.some((v) => v && (v.featureId || v.id) === out.defaultVariant)) {
        delete out.defaultVariant;
      }
    }
    if (Array.isArray(out.addons)) {
      out.addons = out.addons.filter((a) => a && knownIds.has(a.featureId));
    }
    return out;
  });

  let merged;
  try {
    if (staged.kind === 'csv') {
      const applied = applyCSVToMenu(current, staged.csvText || '');
      merged = applied.menu;
    } else if (staged.kind === 'json' && staged.doc) {
      if (staged.signed && includeSettings) {
        merged = staged.doc;
      } else {
        const rawItems = Array.isArray(staged.doc.items) ? staged.doc.items : current.items;
        merged = {
          ...current,
          categories: Array.isArray(staged.doc.categories) ? staged.doc.categories : current.categories,
          items: knownIds.size > 0 ? stripUnknownFeatures(rawItems) : rawItems,
          // Legacy addonGroups mint library defs on validate — unsigned
          // files keep the live groups, never the file's.
          addonGroups: current.addonGroups,
        };
      }
    } else {
      return jsonNoStore({ ok: false, error: 'invalid_token' }, 400);
    }
    const v = validateMenu(merged);
    if (!v.ok) return jsonNoStore({ ok: false, error: 'validation_error', message: v.errors.join('; ') }, 400);
    merged = v.value;
    if (!(staged.signed && includeSettings) && staged.kind === 'json') {
      // Belt and suspenders: the library stays exactly live for unsigned
      // files even if validation invented anything on the way through.
      try {
        merged.settings.featureDefs = liveDefs;
        if (current && current.settings && Array.isArray(current.settings.featureGroups)) {
          merged.settings.featureGroups = current.settings.featureGroups;
        }
      } catch {}
    }
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }

  const actor = await getActor(request, env);
  try {
    await snapshotMenu(env, { prevDoc: current, incomingDoc: merged, source: 'import', actor });
  } catch {}
  // Expected-version guard AFTER the burn: a concurrent save in the tiny
  // window 409s instead of being silently overwritten (token is spent, so
  // the owner re-analyzes and presses Apply again).
  let written;
  try {
    written = await writeMenuVersioned(env, merged, baseVersion);
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  if (!written.ok) {
    if (written.conflict) {
      return jsonNoStore({ ok: false, error: 'conflict', version: written.current ? written.current.version : undefined }, 409);
    }
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  await purgeMenuCaches(request);
  try {
    const ni = Array.isArray(merged.items) ? merged.items.length : 0;
    const nc = Array.isArray(merged.categories) ? merged.categories.length : 0;
    await logActivity(env, {
      actor,
      action: 'import.apply',
      label: {
        en: `Applied import (${ni} items, ${nc} categories)`,
        ar: `تم تطبيق الاستيراد (${ni} صنف، ${nc} قسم)`,
      },
    });
  } catch {}
  return jsonNoStore({ ok: true, version: written.doc.version });
}
