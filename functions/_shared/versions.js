/**
 * Backup & history domain (no dependencies except sibling shared modules).
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

import { diffMenus, summarizeChanges } from './diff.js';
import {
  getSessionCookie,
  getSessionSecret,
  safeCompareStrings,
  verifySessionToken,
} from './session.js';
import { sha256Hex } from './reports.js';

export const VER_KEY = (id) => `menu:ver:${id}`;
export const VER_PREFIX = 'menu:ver:';
export const TRASH_KEY = 'menu:trash';
export const IMPORT_KEY = (token) => `import:${token}`;
export const LAST_AUTOSAVE_KEY = 'backup:last-autosave';
export const AUTO_KEY = 'backup:auto';
export const SITEID_KEY = 'backup:siteid';
export const MIGRATED_KEY = 'backup:migrated';
const LEGACY_BACKUP_KEY = 'menu:backup';

const AUTOSAVE_COALESCE_MS = 5 * 60 * 1000;
const TRASH_MAX = 200;
const TRASH_TTL_MS = 30 * 86400000;
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

/* ---------------- versions ---------------- */

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
  let keys = [];
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
  if (typeof id !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/.test(id)) return null;
  try {
    const raw = await env.MENU_KV.get(VER_KEY(id));
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

/* ---------------- trash ---------------- */

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

/* ---------------- signing (export envelopes) ---------------- */

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return typeof s === 'string' ? s : 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
    .join(',')}}`;
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(text)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signPayload(env, payload) {
  const secret = typeof env?.BACKUP_SECRET === 'string' ? env.BACKUP_SECRET : '';
  if (!secret) throw new Error('backup_unconfigured');
  return hmacHex(secret, canonicalize(payload));
}

/** False when unsigned, misconfigured, or tampered (constant-time). */
export async function verifyPayload(env, payload, sig) {
  try {
    if (typeof sig !== 'string' || !sig) return false;
    const secret = typeof env?.BACKUP_SECRET === 'string' ? env.BACKUP_SECRET : '';
    if (!secret) return false;
    const expected = await hmacHex(secret, canonicalize(payload));
    return safeCompareStrings(expected, sig);
  } catch {
    return false;
  }
}

export async function getSiteId(env) {
  try {
    const existing = await env.MENU_KV.get(SITEID_KEY);
    if (existing) return existing;
  } catch {}
  let id = '';
  try {
    id = crypto.randomUUID();
  } catch {
    id = `site-${Date.now().toString(36)}${randHex(4)}`;
  }
  try {
    await env.MENU_KV.put(SITEID_KEY, id);
  } catch {}
  return id;
}

export function backupEnvelope({ menu, siteId, exportedAt }) {
  const schemaVersion = menu && typeof menu.schemaVersion === 'number' ? menu.schemaVersion : 2;
  return { format: 'chou-backup', schemaVersion, exportedAt, siteId, menu };
}

/* ---------------- CSV ---------------- */

const MENU_CSV_HEADER = 'category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available';

function csvCell(v) {
  const s = String(v ?? '');
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function featureNameOf(menu, fid, lang) {
  try {
    const defs = (menu && menu.settings && menu.settings.featureDefs) || [];
    const d = defs.find((x) => x && x.id === fid);
    if (!d) return '';
    return (d.name && (d.name[lang] || d.name.en)) || '';
  } catch {
    return '';
  }
}

function bothNames(en, ar) {
  const e = typeof en === 'string' ? en : '';
  const a = typeof ar === 'string' ? ar : '';
  if (e && a && e !== a) return `${e} / ${a}`;
  return e || a;
}

/** One row per item × variant. UTF-8 with BOM. No customer data exists here. */
export function buildMenuCSV(menu) {
  const m = menu || {};
  const cats = new Map((Array.isArray(m.categories) ? m.categories : []).map((c) => [c && c.id, c]));
  const lines = [MENU_CSV_HEADER];
  for (const it of Array.isArray(m.items) ? m.items : []) {
    if (!it || !it.id) continue;
    const cat = cats.get(it.categoryId);
    const category = cat ? bothNames(cat.name && cat.name.en, cat.name && cat.name.ar) : '';
    const unit = (it.pricing && it.pricing.unit) || '';
    const available = it.available === false ? 'false' : 'true';
    const nameEn = (it.name && it.name.en) || '';
    const nameAr = (it.name && it.name.ar) || '';
    const vs = Array.isArray(it.variants) ? it.variants : [];
    if (vs.length === 0) {
      const price = it.pricing && typeof it.pricing.price === 'number' ? it.pricing.price : '';
      lines.push([category, it.id, nameEn, nameAr, '', '', '', price, unit, available].map(csvCell).join(','));
    } else {
      for (const v of vs) {
        if (!v) continue;
        const ven = featureNameOf(m, v.featureId, 'en');
        const varr = featureNameOf(m, v.featureId, 'ar');
        lines.push([category, it.id, nameEn, nameAr, v.featureId || '', ven, varr, typeof v.price === 'number' ? v.price : '', unit, available].map(csvCell).join(','));
      }
    }
  }
  return '﻿' + lines.join('\n') + '\n';
}

/** Minimal RFC-4180 reader: quotes, doubled quotes, CRLF, BOM, Arabic-safe. */
export function parseCSV(text) {
  let s = String(text || '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else if (ch === '\r') {
      // skip (paired with \n)
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error('bad_csv');
  row.push(cell);
  const tailEmpty = row.length === 1 && row[0] === '' && rows.length > 0;
  if (!tailEmpty) rows.push(row);
  if (rows.length === 0) throw new Error('bad_csv');
  return { headers: rows[0].map((h) => h.trim()), rows: rows.slice(1) };
}

/**
 * Merge CSV rows into the current menu (updates + careful adds, NEVER
 * deletes). Returns { menu, updated, added, skipped }.
 */
export function applyCSVToMenu(current, csvText) {
  const { headers, rows } = parseCSV(csvText);
  const col = (name) => headers.findIndex((h) => h.toLowerCase() === name);
  const cItem = col('item_id');
  const cNameEn = col('name_en');
  const cNameAr = col('name_ar');
  const cVar = col('variant_id');
  const cPrice = col('price');
  const cAvail = col('available');
  const cCat = col('category');
  const cUnit = col('unit');
  if (cItem < 0) throw new Error('bad_csv');
  const menu = JSON.parse(JSON.stringify(current || {}));
  if (!Array.isArray(menu.items)) menu.items = [];
  if (!Array.isArray(menu.categories)) menu.categories = [];
  const byId = new Map(menu.items.map((it) => [it && it.id, it]));
  const catByName = new Map();
  for (const c of menu.categories) {
    if (!c) continue;
    if (c.name && c.name.en) catByName.set(c.name.en.trim().toLowerCase(), c.id);
    if (c.name && c.name.ar) catByName.set(c.name.ar.trim().toLowerCase(), c.id);
  }
  const parseAvail = (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
    return null;
  };
  let updated = 0;
  let added = 0;
  let skipped = 0;
  const fileCats = new Set();
  let fileRows = 0;
  for (const r of rows) {
    const id = (r[cItem] || '').trim();
    if (!id) {
      skipped += 1;
      continue;
    }
    fileRows += 1;
    const catCell = cCat >= 0 ? (r[cCat] || '').trim() : '';
    if (catCell) fileCats.add(catCell.toLowerCase());
    const priceRaw = cPrice >= 0 ? (r[cPrice] || '').trim() : '';
    const price = priceRaw === '' ? null : Number(priceRaw);
    if (priceRaw !== '' && (!Number.isFinite(price) || price < 0 || price > 100000000)) {
      skipped += 1;
      continue;
    }
    const avail = cAvail >= 0 ? parseAvail(r[cAvail]) : null;
    const ne = cNameEn >= 0 ? (r[cNameEn] || '').trim() : '';
    const na = cNameAr >= 0 ? (r[cNameAr] || '').trim() : '';
    const varId = cVar >= 0 ? (r[cVar] || '').trim() : '';
    const existing = byId.get(id);
    if (existing) {
      if (ne) existing.name.en = ne.slice(0, 120);
      if (na) existing.name.ar = na.slice(0, 120);
      if (varId) {
        const vs = Array.isArray(existing.variants) ? existing.variants : [];
        const v = vs.find((x) => x && x.featureId === varId);
        if (v && price !== null) {
          v.price = price;
          updated += 1;
        } else {
          skipped += 1;
        }
      } else if (price !== null) {
        if (!existing.pricing || typeof existing.pricing !== 'object') existing.pricing = {};
        existing.pricing.price = price;
        updated += 1;
      }
      if (avail !== null) {
        existing.available = avail;
        updated += 1;
      }
      continue;
    }
    // New item: only when its category exists (matched by name).
    const catNameRaw = cCat >= 0 ? (r[cCat] || '').trim().toLowerCase() : '';
    const catId = catNameRaw ? catByName.get(catNameRaw) : null;
    if (!catId) {
      skipped += 1;
      continue;
    }
    if (varId) {
      skipped += 1;
      continue;
    }
    const unitRaw = cUnit >= 0 ? (r[cUnit] || '').trim() : '';
    const unit = ['pc', 'dozen', 'kg', 'g', 'box', 'pack'].includes(unitRaw) ? unitRaw : 'pc';
    const item = {
      id,
      categoryId: catId,
      name: { en: ne.slice(0, 120) || na.slice(0, 120) || id, ar: na.slice(0, 120) || ne.slice(0, 120) || id },
      description: { en: '', ar: '' },
      pricing: { unit, minQty: 1, step: 1, maxQty: 50, showUnit: false, price: price !== null ? price : 0 },
      addons: [],
      badges: [],
      featured: false,
      available: avail !== null ? avail : true,
    };
    menu.items.push(item);
    byId.set(id, item);
    added += 1;
  }
  return { menu, updated, added, skipped, fileRows, fileCategories: fileCats.size };
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

/* ---------------- print page ---------------- */

const escHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtPrice = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '';

/**
 * Print-optimized menu page (A4, brand header, no admin controls).
 * Every dynamic string is escaped. Only visible categories and available
 * items are listed; variant lines show their own prices.
 */
export function buildPrintHTML(menu, lang = 'ar') {
  const l = lang === 'ar' ? 'ar' : 'en';
  const m = menu || {};
  const s = (m.settings && typeof m.settings === 'object' ? m.settings : {});
  const name = (s.name && (s.name[l] || s.name.en)) || 'Menu';
  const tagline = (s.tagline && (s.tagline[l] || s.tagline.en)) || '';
  const phone = s.phone || '';
  const cur = (s.currency && (s.currency[l] || s.currency.en)) || '';
  const cats = (Array.isArray(m.categories) ? m.categories : []).filter((c) => c && c.visible !== false);
  const items = Array.isArray(m.items) ? m.items : [];
  const sections = cats
    .map((c) => {
      const list = items.filter((it) => it && it.categoryId === c.id && it.available !== false);
      if (list.length === 0) return '';
      const rows = list
        .map((it) => {
          const nm = (it.name && (it.name[l] || it.name.en)) || '';
          const vs = Array.isArray(it.variants) ? it.variants : [];
          let priceLine = '';
          if (vs.length === 0) {
            const p = it.pricing && typeof it.pricing.price === 'number' ? it.pricing.price : null;
            priceLine = `<span class="price">${escHtml(fmtPrice(p))} ${escHtml(cur)}</span>`;
          } else {
            const vrows = vs
              .map((v) => {
                let vn = '';
                try {
                  const defs = (m.settings && m.settings.featureDefs) || [];
                  const d = defs.find((x) => x && x.id === v.featureId);
                  vn = (d && d.name && (d.name[l] || d.name.en)) || '';
                } catch {}
                return `<div class="variant"><span>${escHtml(vn)}</span><span class="price">${escHtml(fmtPrice(v.price))} ${escHtml(cur)}</span></div>`;
              })
              .join('');
            priceLine = `<div class="variants">${vrows}</div>`;
          }
          return `<div class="item"><span class="iname">${escHtml(nm)}</span>${priceLine}</div>`;
        })
        .join('');
      return `<section class="cat"><h2>${escHtml((c.name && (c.name[l] || c.name.en)) || '')}</h2>${rows}</section>`;
    })
    .join('');
  return `<!doctype html>
<html lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${escHtml(name)}</title>
<style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Tahoma, 'Segoe UI', Arial, sans-serif; color: #111; }
header.brand { text-align: center; border-bottom: 3px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
header.brand h1 { margin: 0; font-size: 28px; }
header.brand p { margin: 4px 0 0; font-size: 13px; color: #444; }
.cat { margin-bottom: 14px; break-inside: avoid; }
.cat h2 { margin: 0 0 6px; font-size: 18px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
.item { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 4px 0; font-size: 14px; }
.iname { font-weight: bold; }
.price { white-space: nowrap; font-weight: bold; }
.variants { display: flex; flex-direction: column; gap: 2px; }
.variant { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #333; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<header class="brand"><h1>${escHtml(name)}</h1>${tagline ? `<p>${escHtml(tagline)}</p>` : ''}${phone ? `<p>${escHtml(phone)}</p>` : ''}</header>
${sections}
</body></html>`;
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
