/**
 * POST /api/admin/import/analyze — two-step import, step 1.
 * Raw body (max 2 MB, Content-Type must be JSON or CSV). Parses strictly,
 * rejects __proto__/constructor/prototype keys and depth beyond 10, runs
 * strict validateMenu, verifies the HMAC signature for envelopes
 * (constant-time; null for CSV), diffs vs the live menu, and stages the
 * document in KV (import:<token>, 15-minute TTL, single use, bound to the
 * admin session). Analysis NEVER writes to the menu.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { getSessionCookie, getSessionSecret, verifySessionToken } from '../../../_shared/session.js';
import { validateMenu } from '../../../_shared/validate.js';
import { diffMenus } from '../../../_shared/diff.js';
import {
  IMPORT_KEY,
  applyCSVToMenu,
  assertSafeJSON,
  verifyPayload,
} from '../../../_shared/versions.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';

const MAX_BYTES = 2 * 1024 * 1024;

function randToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

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

const WARN = {
  en: {
    unsigned: 'This file is not signed by this site: business settings (phone, WhatsApp, ordering) will be ignored.',
    csvSkipped: (n) => `${n} spreadsheet row(s) were skipped (unknown item, bad price, or missing category).`,
    csvAdded: (n) => `${n} new item(s) will be added (their categories already exist).`,
    settingsOnlySigned: 'Business settings in this file will be ignored unless it is signed.',
  },
  ar: {
    unsigned: 'هذا الملف غير موقّع من هذا الموقع: سيتم تجاهل إعدادات العمل (الهاتف وواتساب والطلب).',
    csvSkipped: (n) => `تم تخطي ${n} من صفوف الجدول (صنف غير معروف أو سعر خاطئ أو قسم مفقود).`,
    csvAdded: (n) => `ستُضاف ${n} أصناف جديدة (أقسامها موجودة بالفعل).`,
    settingsOnlySigned: 'سيتم تجاهل إعدادات العمل في هذا الملف ما لم يكن موقّعاً.',
  },
};

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'backups')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);

  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const w = WARN[lang];
  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  const wantJson = contentType.includes('application/json');
  const wantCsv = contentType.includes('text/csv');
  if (!wantJson && !wantCsv) return jsonNoStore({ error: 'bad_request', message: 'Content-Type must be application/json or text/csv' }, 400);

  let raw;
  try {
    raw = await request.text();
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }
  if (!raw) return jsonNoStore({ error: 'bad_request' }, 400);
  // Byte-accurate limit (the UI promises 2 MB): UTF-16 length understates
  // Arabic-heavy files by ~2x.
  let byteLen;
  try {
    byteLen = new TextEncoder().encode(raw).length;
  } catch {
    byteLen = raw.length;
  }
  if (byteLen > MAX_BYTES) return jsonNoStore({ error: 'payload_too_large' }, 400);

  let current = null;
  try {
    current = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (!current) return jsonNoStore({ error: 'unavailable' }, 503);

  let kind;
  let doc;
  let csvText = null;
  let csvStats = null;
  let signed;
  let fileName = url.searchParams.get('name') || (wantJson ? 'backup.json' : 'menu.csv');
  fileName = fileName.slice(0, 120);
  const warnings = [];

  try {
    if (wantJson) {
      kind = 'json';
      let text = raw;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const parsed = JSON.parse(text);
      assertSafeJSON(parsed);
      if (parsed && typeof parsed === 'object' && parsed.format === 'chou-backup' && parsed.menu && typeof parsed.menu === 'object') {
        const { sig, ...payload } = parsed;
        signed = await verifyPayload(env, payload, sig);
        doc = parsed.menu;
      } else {
        doc = parsed;
        signed = false;
      }
      assertSafeJSON(doc);
      const v = validateMenu(doc);
      if (!v.ok) return jsonNoStore({ error: 'validation_error', message: v.errors.join('; ') }, 400);
      doc = v.value;
      if (!signed) warnings.push(w.unsigned);
    } else {
      kind = 'csv';
      signed = null;
      csvText = raw;
      const merged = applyCSVToMenu(current, raw);
      csvStats = { items: merged.fileRows, categories: merged.fileCategories };
      if (merged.skipped > 0) warnings.push(w.csvSkipped(merged.skipped));
      if (merged.added > 0) warnings.push(w.csvAdded(merged.added));
      const v = validateMenu(merged.menu);
      if (!v.ok) return jsonNoStore({ error: 'validation_error', message: v.errors.join('; ') }, 400);
      doc = v.value;
    }
  } catch (e) {
    const code = e && typeof e.message === 'string' ? e.message : '';
    if (code === 'unsafe_key' || code === 'too_deep') return jsonNoStore({ error: 'unsafe_json' }, 400);
    if (code === 'bad_csv') return jsonNoStore({ error: 'bad_csv' }, 400);
    return jsonNoStore({ error: 'bad_json' }, 400);
  }

  // What the apply step would write (unsigned JSON keeps live settings).
  const previewDoc = kind === 'csv' || !signed
    ? { ...doc, settings: current.settings }
    : doc;
  let changes = [];
  try {
    changes = diffMenus(current, previewDoc, lang);
  } catch {}
  const hasSettingsChanges = changes.some((c) => c.scope === 'settings');
  if (!signed && kind === 'json' && hasSettingsChanges) warnings.push(w.settingsOnlySigned);

  const counts = kind === 'csv' && csvStats
    ? { items: csvStats.items, categories: csvStats.categories }
    : { items: Array.isArray(doc.items) ? doc.items.length : 0, categories: Array.isArray(doc.categories) ? doc.categories.length : 0 };

  const token = randToken();
  const staged = kind === 'csv'
    ? { kind, csvText, session: await sessionSub(request, env), fileName }
    : { kind, doc, signed, session: await sessionSub(request, env), fileName };
  try {
    await env.MENU_KV.put(IMPORT_KEY(token), JSON.stringify(staged), { expirationTtl: 900 });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  return jsonNoStore({ fileName, format: kind, signed, counts, changes, hasSettingsChanges, warnings, token });
}
