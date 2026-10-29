/**
 * Version snapshots in KV (metadata-only listing, 50-latest + daily keep).
 * Split from versions.js — only dependency is ./diff.js for summaries.
 * Works in Cloudflare Workers and Node.
 * Re-exported from ./versions.js so existing importers keep working.
 */

import { diffMenus, summarizeChanges } from './diff.js';

export const VER_KEY = (id) => `menu:ver:${id}`;
export const VER_PREFIX = 'menu:ver:';
export const LAST_AUTOSAVE_KEY = 'backup:last-autosave';
export const MIGRATED_KEY = 'backup:migrated';

const LEGACY_BACKUP_KEY = 'menu:backup';

const AUTOSAVE_COALESCE_MS = 5 * 60 * 1000;
const VERSION_KEEP_LATEST = 50;
const VERSION_KEEP_DAYS = 60;

function randHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function newVersionId(when = new Date()) {
  return `${when.toISOString()}-${randHex(3)}`;
}

function validSource(s) {
  return s === 'autosave' || s === 'manual' || s === 'import' || s === 'restore' ? s : 'manual';
}

/**
 * Snapshot `prevDoc` (the document being replaced) with a summary of what
 * `incomingDoc` changes. Autosave snapshots coalesce to one per 5 minutes.
 * Prunes old versions in the same call. Returns { id|null, coalesced }.
 */
export async function snapshotMenu(env, { prevDoc, incomingDoc, source, actor }) {
  const kv = env.MENU_KV;
  if (!kv || !prevDoc) return { id: null, coalesced: false };
  const src = validSource(source);
  const now = Date.now();
  if (src === 'autosave') {
    try {
      const last = await kv.get(LAST_AUTOSAVE_KEY);
      if (last && now - Number(last) < AUTOSAVE_COALESCE_MS) return { id: null, coalesced: true };
    } catch {}
    try {
      await kv.put(LAST_AUTOSAVE_KEY, String(now));
    } catch {}
  }
  let summary = { added: 0, removed: 0, changed: 0, prices: 0 };
  try {
    summary = summarizeChanges(diffMenus(prevDoc, incomingDoc || {}, 'en'));
  } catch {}
  // A save that changed nothing must not mint an empty history row — it
  // would review as "no changes" forever and bloat the timeline with noise.
  // (Safety copies for restore/import are unaffected: identical docs have
  // nothing to undo, so skipping loses nothing.)
  if (!summary.added && !summary.removed && !summary.changed && !summary.prices) {
    return { id: null, coalesced: false, skipped: true };
  }
  const id = newVersionId(new Date(now));
  const value = { menu: prevDoc, actor: actor || 'owner', source: src, summary };
  const metadata = { createdAt: new Date(now).toISOString(), source: src, actor: actor || 'owner', summary };
  try {
    await kv.put(VER_KEY(id), JSON.stringify(value), { metadata });
  } catch {
    return { id: null, coalesced: false };
  }
  let pruned = 0;
  try {
    pruned = await pruneVersions(env);
  } catch {}
  return { id, coalesced: false, pruned };
}

/** Newest-first entries from KV metadata only (no value reads). */
export async function listVersions(env) {
  const kv = env.MENU_KV;
  if (!kv) return [];
  let keys;
  try {
    const res = await kv.list({ prefix: VER_PREFIX, limit: 1000 });
    keys = (res && res.keys) || [];
  } catch {
    return [];
  }
  keys.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return keys.map((k) => {
    const md = (k && k.metadata) || {};
    return {
      id: String(k.name).slice(VER_PREFIX.length),
      createdAt: typeof md.createdAt === 'string' ? md.createdAt : '',
      source: validSource(md.source),
      actor: typeof md.actor === 'string' ? md.actor : 'owner',
      summary: md.summary && typeof md.summary === 'object'
        ? {
          added: Number(md.summary.added) || 0,
          removed: Number(md.summary.removed) || 0,
          changed: Number(md.summary.changed) || 0,
          prices: Number(md.summary.prices) || 0,
        }
        : { added: 0, removed: 0, changed: 0, prices: 0 },
    };
  });
}

/** Keep latest 50 + one per day for 60 days. Returns deleted count. */
export async function pruneVersions(env) {
  const kv = env.MENU_KV;
  if (!kv) return 0;
  const entries = await listVersions(env);
  const keep = new Set();
  for (const e of entries.slice(0, VERSION_KEEP_LATEST)) keep.add(e.id);
  const cutoff = Date.now() - VERSION_KEEP_DAYS * 86400000;
  const seenDays = new Set();
  for (const e of entries.slice(VERSION_KEEP_LATEST)) {
    const t = Date.parse(e.createdAt);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    if (seenDays.has(day)) continue;
    seenDays.add(day);
    keep.add(e.id);
  }
  let deleted = 0;
  for (const e of entries) {
    if (keep.has(e.id)) continue;
    try {
      await kv.delete(VER_KEY(e.id));
      deleted += 1;
    } catch {}
  }
  return deleted;
}

export async function getVersionDoc(env, id) {
  if (typeof id !== 'string' || !id) return null;
  // Route params may arrive percent-encoded (IDs contain ':' from ISO dates).
  // Decode first so encoded and raw forms resolve to the same document.
  let key = id;
  try {
    key = decodeURIComponent(key);
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9:._-]{1,128}$/.test(key)) return null;
  try {
    const raw = await env.MENU_KV.get(VER_KEY(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.menu) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** One-time migration of the legacy single menu:backup key. */
export async function migrateLegacyBackup(env, currentMenu) {
  const kv = env.MENU_KV;
  if (!kv) return false;
  try {
    if (await kv.get(MIGRATED_KEY)) return false;
  } catch {}
  let old = null;
  try {
    old = await kv.get(LEGACY_BACKUP_KEY, { type: 'json' });
  } catch {}
  try {
    await kv.put(MIGRATED_KEY, '1');
  } catch {}
  if (!old || typeof old !== 'object' || !Array.isArray(old.items)) return false;
  let summary = { added: 0, removed: 0, changed: 0, prices: 0 };
  try {
    summary = summarizeChanges(diffMenus(old, currentMenu || {}, 'en'));
  } catch {}
  const id = `2000-01-01T00:00:00.000Z-legacy`;
  try {
    await kv.put(
      VER_KEY(id),
      JSON.stringify({ menu: old, actor: 'owner', source: 'manual', summary }),
      { metadata: { createdAt: new Date().toISOString(), source: 'manual', actor: 'owner', summary } }
    );
    return true;
  } catch {
    return false;
  }
}
