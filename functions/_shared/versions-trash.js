/**
 * Trash domain (soft-delete, 30-day auto-purge).
 * Split from versions.js — no dependencies, works in Cloudflare Workers and Node.
 * Re-exported from ./versions.js so existing importers keep working.
 */

export const TRASH_KEY = 'menu:trash';

const TRASH_MAX = 200;
const TRASH_TTL_MS = 30 * 86400000;

function randHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function readTrashRaw(env) {
  try {
    const raw = await env.MENU_KV.get(TRASH_KEY, { type: 'json' });
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Read + auto-purge entries older than 30 days (writes back when changed). */
export async function readTrash(env) {
  const all = await readTrashRaw(env);
  const now = Date.now();
  const kept = all.filter((e) => e && typeof e === 'object' && now - Date.parse(e.deletedAt || '') < TRASH_TTL_MS);
  if (kept.length !== all.length) {
    try {
      await env.MENU_KV.put(TRASH_KEY, JSON.stringify(kept));
    } catch {}
  }
  return kept;
}

export function purgeInDays(deletedAt, nowMs = Date.now()) {
  const t = Date.parse(deletedAt || '');
  if (!Number.isFinite(t)) return 30;
  return Math.max(0, Math.ceil((t + TRASH_TTL_MS - nowMs) / 86400000));
}

export function toTrashList(entries, nowMs = Date.now()) {
  return entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    name: e.kind === 'category'
      ? { en: (e.data && e.data.name && e.data.name.en) || '', ar: (e.data && e.data.name && e.data.name.ar) || '' }
      : { en: (e.data && e.data.name && e.data.name.en) || '', ar: (e.data && e.data.name && e.data.name.ar) || '' },
    deletedAt: e.deletedAt,
    purgeInDays: purgeInDays(e.deletedAt, nowMs),
  }));
}

export async function pushTrash(env, entry) {
  const all = await readTrash(env);
  all.unshift({ ...entry, id: `t_${Date.now().toString(36)}${randHex(3)}`, deletedAt: new Date().toISOString() });
  const capped = all.slice(0, TRASH_MAX);
  try {
    await env.MENU_KV.put(TRASH_KEY, JSON.stringify(capped));
  } catch {}
  return capped[0];
}

export async function removeTrashEntry(env, id) {
  const all = await readTrash(env);
  const kept = all.filter((e) => e.id !== id);
  if (kept.length !== all.length) {
    try {
      await env.MENU_KV.put(TRASH_KEY, JSON.stringify(kept));
    } catch {}
    return true;
  }
  return false;
}

/** Purge pass for the daily job. Returns purged count. */
export async function purgeTrash(env) {
  const before = await readTrashRaw(env);
  const after = await readTrash(env);
  return Math.max(0, before.length - after.length);
}
