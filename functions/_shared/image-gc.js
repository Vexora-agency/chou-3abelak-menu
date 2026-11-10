/**
 * Photo store helpers.
 *
 * Uploads set a small KV flag, and the next successful menu save runs one
 * best-effort pass over R2 to delete objects that are no longer referenced
 * by any item. The 15-minute age floor keeps a just-uploaded photo safe even
 * if an autosave lands while the admin is still editing the item.
 */

import { IMAGE_KEY_RE } from './image-meta.js';

const GC_FLAG = 'img:gc';
const PENDING_TTL = 86400;
const MIN_AGE_MS = 15 * 60 * 1000;
const MAX_PAGES = 5;

export async function markImageGcPending(env) {
  try {
    if (env && env.MENU_KV) await env.MENU_KV.put(GC_FLAG, '1', { expirationTtl: PENDING_TTL });
  } catch {}
}

/** Keys under menu/ referenced by the menu document's item photos (imageUrl + imageVariants.s/m). */
export function menuImageKeys(menu) {
  const keys = new Set();
  const items = menu && Array.isArray(menu.items) ? menu.items : [];
  const marker = '/api/images/';
  const addUrl = (raw) => {
    if (typeof raw !== 'string' || !raw) return;
    const idx = raw.indexOf(marker);
    if (idx === -1) return;
    let key = raw.slice(idx + marker.length);
    const cut = key.search(/[?#]/);
    if (cut !== -1) key = key.slice(0, cut);
    if (IMAGE_KEY_RE.test(key)) keys.add(key);
  };
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    addUrl(item.imageUrl);
    const variants = item.imageVariants;
    if (variants && typeof variants === 'object' && !Array.isArray(variants)) {
      addUrl(variants.s);
      addUrl(variants.m);
    }
  }
  return keys;
}

/** Delete R2 objects under menu/ that no saved item references. */
export async function maybeGcOrphanImages(env, menuDoc) {
  try {
    if (!env || !env.MENU_IMAGES || !env.MENU_KV) return 0;
    if (typeof env.MENU_IMAGES.list !== 'function' || typeof env.MENU_IMAGES.delete !== 'function') return 0;
    const flag = await env.MENU_KV.get(GC_FLAG);
    if (flag !== '1') return 0;

    // Claim this pass. A new upload during the scan sets the flag back to '1'.
    await env.MENU_KV.put(GC_FLAG, '0', { expirationTtl: 60 });

    let menu = menuDoc;
    if (!menu) menu = await env.MENU_KV.get('menu', { type: 'json' });
    const referenced = menuImageKeys(menu);
    const cutoff = Date.now() - MIN_AGE_MS;
    let cursor;
    let deleted = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const listed = await env.MENU_IMAGES.list({ prefix: 'menu/', cursor, limit: 1000 });
      const objects = (listed && listed.objects) || [];
      for (const obj of objects) {
        if (!obj || typeof obj.key !== 'string' || !IMAGE_KEY_RE.test(obj.key)) continue;
        if (referenced.has(obj.key)) continue;
        const uploaded = obj.uploaded instanceof Date ? obj.uploaded.getTime() : new Date(obj.uploaded || 0).getTime();
        if (!Number.isFinite(uploaded) || uploaded > cutoff) continue;
        try {
          await env.MENU_IMAGES.delete(obj.key);
          deleted += 1;
        } catch {}
      }
      cursor = listed && listed.truncated ? listed.cursor : undefined;
      if (!cursor) break;
    }

    if (deleted > 0) console.log(JSON.stringify({ evt: 'image_gc', deleted }));
    return deleted;
  } catch {
    return 0;
  }
}
