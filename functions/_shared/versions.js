/**
 * Backup & history domain (no logging, business data only).
 * Split: snapshots in ./versions-history.js, trash in ./versions-trash.js,
 * signing in ./versions-signing.js, CSV in ./versions-csv.js,
 * print HTML in ./versions-print.js. This file re-exports them so existing
 * importers keep working with identical export names.
 *
 * - Version snapshots in KV (`menu:ver:<ISO>-<rand>`, metadata-only listing).
 * - Soft-delete trash (`menu:trash`, 30-day auto-purge).
 * - Signed export envelopes (HMAC-SHA256, BACKUP_SECRET, constant-time).
 * - CSV parse/build (BOM, quotes, Arabic) + CSV merge-apply (never deletes).
 * - Weekly auto-backup KV state.
 *
 * Privacy: values stored are menu documents (business data, never secrets).
 * Trash holds deleted menu objects only. No logging here at all.
 */

import {
  getSessionCookie,
  getSessionSecret,
  jsonNoStore,
  verifySessionToken,
} from './session.js';
import { validateMenu } from './validate.js';
import { snapshotMenu } from './versions-history.js';

export const IMPORT_KEY = (token) => `import:${token}`;
export const AUTO_KEY = 'backup:auto';

export {
  VER_KEY,
  VER_PREFIX,
  LAST_AUTOSAVE_KEY,
  MIGRATED_KEY,
  newVersionId,
  snapshotMenu,
  listVersions,
  pruneVersions,
  getVersionDoc,
  migrateLegacyBackup,
} from './versions-history.js';
export {
  TRASH_KEY,
  readTrash,
  purgeInDays,
  toTrashList,
  pushTrash,
  removeTrashEntry,
  purgeTrash,
} from './versions-trash.js';
export {
  SITEID_KEY,
  canonicalize,
  signPayload,
  verifyPayload,
  getSiteId,
  backupEnvelope,
} from './versions-signing.js';
export { buildMenuCSV, parseCSV, applyCSVToMenu } from './versions-csv.js';
export { buildPrintHTML } from './versions-print.js';

/** Actor always comes from the server session, never from the client. */
export async function getActor(request, env) {
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
  return 'owner';
}

/* ---------------- JSON safety ---------------- */

/** Reject __proto__/constructor/prototype keys and depth beyond 10. */
export function assertSafeJSON(value) {
  const BAD = new Set(['__proto__', 'constructor', 'prototype']);
  const walk = (v, depth) => {
    if (depth > 10) throw new Error('too_deep');
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (BAD.has(k)) throw new Error('unsafe_key');
        walk(v[k], depth + 1);
      }
    }
  };
  walk(value, 0);
}

/* ---------------- misc ---------------- */

/**
 * Write a menu doc with version+1 and fresh updatedAt.
 * Pass expectedVersion for optimistic concurrency (409-style conflict).
 */
export async function writeMenuVersioned(env, doc, expectedVersion) {
  const kv = env.MENU_KV;
  if (!kv) throw new Error('unavailable');
  const current = await kv.get('menu', { type: 'json' });
  if (expectedVersion !== undefined && current && current.version !== expectedVersion) {
    return { ok: false, conflict: true, current };
  }
  const next = {
    ...doc,
    version: (current && typeof current.version === 'number' ? current.version : 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  await kv.put('menu', JSON.stringify(next));
  return { ok: true, doc: next };
}

export function weekdayInTZ(timeZone, nowMs = Date.now()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(nowMs));
    return days.indexOf(s);
  } catch {
    return new Date(nowMs).getUTCDay();
  }
}

export async function getAutoBackup(env) {
  try {
    const raw = await env.MENU_KV.get(AUTO_KEY, { type: 'json' });
    if (raw && typeof raw === 'object') {
      return { enabled: !!raw.enabled, lastBackupAt: typeof raw.lastBackupAt === 'string' ? raw.lastBackupAt : null };
    }
  } catch {}
  return { enabled: false, lastBackupAt: null };
}

export async function setAutoBackup(env, state) {
  try {
    await env.MENU_KV.put(AUTO_KEY, JSON.stringify({ enabled: !!state.enabled, lastBackupAt: state.lastBackupAt || null }));
    return true;
  } catch {
    return false;
  }
}

/** Small bilingual body for the weekly backup email (attachment carries it). */
export function weeklyBackupEmail(dateStr, siteName) {
  const nm = String(siteName || 'your restaurant');
  const safe = nm.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    subject: `Weekly backup ${dateStr} / نسخة أسبوعية ${dateStr}`,
    html: `<div style="font-family:Arial,Tahoma,sans-serif;max-width:560px;margin:0 auto;padding:24px;">`
      + `<p>The signed weekly backup of ${safe} (${dateStr}) is attached to this email.</p>`
      + `<p dir="rtl">ملف النسخة الأسبوعية الموقّع لـ ${safe} (${dateStr}) مرفق بهذه الرسالة.</p></div>`,
    text: `Weekly backup of ${nm} (${dateStr}) is attached.\nملف النسخة الأسبوعية لـ ${nm} (${dateStr}) مرفق.`,
  };
}

/* ---- Shared restore tail (versions/[id]/restore, trash/[id]/restore) ---- */

/**
 * Validate -> snapshot (safety copy) -> versioned write.
 * Returns { doc } on success or { res } (a ready error Response) on failure.
 * `invalidError` preserves each endpoint's historical error code.
 */
export async function restoreValidatedMenu(env, request, { doc, prevDoc, source, expectedVersion, invalidError }) {
  const validation = validateMenu(doc);
  if (!validation.ok) return { res: jsonNoStore({ ok: false, error: invalidError || 'invalid_menu' }, 400) };
  const actor = await getActor(request, env);
  try {
    await snapshotMenu(env, { prevDoc, incomingDoc: validation.value, source, actor });
  } catch {}
  let written;
  try {
    written = await writeMenuVersioned(env, validation.value, expectedVersion);
  } catch {
    return { res: jsonNoStore({ ok: false, error: 'unavailable' }, 503) };
  }
  if (!written.ok) return { res: jsonNoStore({ ok: false, error: 'conflict', version: written.current ? written.current.version : null }, 409) };
  return { doc: written.doc };
}
