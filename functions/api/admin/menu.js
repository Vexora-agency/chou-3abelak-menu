/**
 * Admin Menu Endpoint: /api/admin/menu
 * GET: returns current menu document
 * PUT: validates, backs up, and saves with optimistic concurrency
 */

import { validateMenu } from '../../_shared/validate.js';
import { jsonNoStore } from '../../_shared/session.js';
import { applyPlanToSettings } from '../../_shared/plan.js';
import { getActor, migrateLegacyBackup, purgePublicMenu, snapshotMenu, writeMenuVersioned } from '../../_shared/versions.js';
import { diffMenus, summarizeChanges } from '../../_shared/diff.js';
import { logActivity } from '../../_shared/activity.js';

const DEFAULT_EMPTY_MENU = {
  version: 1,
  updatedAt: new Date().toISOString(),
  settings: {
    name: { en: 'Chou 3abelak', ar: 'شو عبالك' },
    tagline: { en: 'Fresh · Fast · Delicious', ar: 'طازج · سريع · شهي' },
    logoText: 'R',
    phone: '',
    whatsapp: '',
    mapUrl: '',
    address: { en: '', ar: '' },
    hoursText: { en: 'Daily · 12:00 PM – 12:00 AM', ar: 'يومياً · 12:00 ظهراً – 12:00 منتصف الليل' },
    statusMode: 'auto',
    openTime: '12:00',
    closeTime: '00:00',
    workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'],
    timezone: 'Asia/Beirut',
    social: { instagram: '', facebook: '', whatsapp: '' },
    socialEnabled: { instagram: true, facebook: true, whatsapp: true },
    socialOrder: ['instagram', 'facebook', 'whatsapp'],
    about: { en: '', ar: '' },
    currency: { en: 'LBP', ar: 'ل.ل' },
    defaultTheme: 'dark',
    defaultLang: 'en',
    featuredAutoplay: true,
    featuredAutoplayInterval: 4,
    badges: { newDays: 14, topDays: 30, topCount: 6 },
    ordering: {
      enabled: false,
      types: ['delivery'],
      minOrder: 0,
      minOrderEnabled: false,
      deliveryFee: 0,
      deliveryFeeEnabled: false,
      note: { en: '', ar: '' }
    }
  },
  categories: [],
  items: [],
  addonGroups: []
};

export async function onRequest(context) {
  const { request, env } = context;

  // GET Handler
  if (request.method === 'GET') {
    let current = null;
    if (env.MENU_KV) {
      try {
        current = await env.MENU_KV.get('menu', { type: 'json' });
      } catch {}
    }
    return jsonNoStore(current || DEFAULT_EMPTY_MENU);
  }

  // PUT Handler
  if (request.method === 'PUT') {
    // 1. Require header "X-Requested-With: menu-admin"
    if (request.headers.get('X-Requested-With') !== 'menu-admin') {
      return jsonNoStore({ error: 'bad_request', message: 'Missing custom request header' }, 400);
    }

    // 2. Require Origin check
    const origin = request.headers.get('Origin');
    const reqUrl = new URL(request.url);
    if (origin && origin !== reqUrl.origin && !origin.includes('localhost')) {
      return jsonNoStore({ error: 'bad_request', message: 'Cross-origin request rejected' }, 400);
    }

    // 3. Content-Type & Size limits
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      return jsonNoStore({ error: 'bad_request', message: 'Content-Type must be application/json' }, 400);
    }

    let rawBody;
    try {
      rawBody = await request.text();
    } catch {
      return jsonNoStore({ error: 'bad_request', message: 'Failed to read request body' }, 400);
    }

    if (rawBody.length > 256 * 1024) {
      return jsonNoStore({ error: 'payload_too_large', message: 'Payload exceeds 256 KB limit' }, 400);
    }

    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonNoStore({ error: 'bad_json', message: 'Malformed JSON payload' }, 400);
    }

    // 4. Strict validation
    const validation = validateMenu(parsed);
    if (!validation.ok) {
      return jsonNoStore({
        error: 'validation_error',
        message: validation.errors.join('; ')
      }, 400);
    }

    const validatedDoc = validation.value;

    // 5. Optimistic concurrency check with KV
    let currentStored = null;
    if (env.MENU_KV) {
      try {
        currentStored = await env.MENU_KV.get('menu', { type: 'json' });
      } catch {}
    }

    const storedVersion = currentStored ? currentStored.version : 1;
    if (currentStored && parsed.version !== storedVersion) {
      return jsonNoStore({
        error: 'conflict',
        message: 'Conflict: Document version mismatch. Please reload the latest menu.',
        latest: currentStored
      }, 409);
    }

    // Plan scrub (starter): freeze — never wipe — the stored announcement.
    // A downgraded client keeps its Pro-era announcement byte-identical: the
    // admin UI is hidden so it can neither be edited nor re-enabled, and each
    // save re-freezes the stored value. It reappears on upgrade.
    // Runs before the snapshot so history stays consistent.
    const storedAnn = currentStored && currentStored.settings && typeof currentStored.settings === 'object'
      ? currentStored.settings.announcement
      : null;
    validatedDoc.settings = applyPlanToSettings(env, validatedDoc.settings, storedAnn);

    // 6. Version history: snapshot the PREVIOUS document before overwrite.
    // source comes from ?source= (autosave coalesces to one per 5 minutes;
    // manual/import/restore always snapshot). The old single menu:backup key
    // is migrated once as an oldest version and then never used again.
    if (env.MENU_KV && currentStored) {
      try {
        const url = new URL(request.url);
        const source = url.searchParams.get('source') === 'autosave' ? 'autosave' : 'manual';
        const actor = await getActor(request, env);
        await migrateLegacyBackup(env, currentStored);
        await snapshotMenu(env, { prevDoc: currentStored, incomingDoc: validatedDoc, source, actor });
      } catch {}
    }

    // Atomic write with a second version check: two tabs saving within
    // milliseconds re-read here, so the loser gets a 409 instead of
    // silently overwriting (the pre-check above alone left that race).
    let savedDoc = null;
    if (env.MENU_KV) {
      const written = await writeMenuVersioned(env, validatedDoc, parsed.version);
      if (!written.ok) {
        const latest = written.current || null;
        return jsonNoStore({
          error: 'conflict',
          message: 'Conflict: Document version mismatch. Please reload the latest menu.',
          latest,
        }, 409);
      }
      savedDoc = written.doc;
    } else {
      validatedDoc.version = (currentStored ? currentStored.version : 0) + 1;
      validatedDoc.updatedAt = new Date().toISOString();
      savedDoc = validatedDoc;
    }

    // 7. Invalidate caches.default for public menu (shared helper — every
    // menu write must do this or the storefront serves stale data).
    await purgePublicMenu(request);

    // 8. Activity log (best-effort; never fails the save).
    try {
      const s = summarizeChanges(diffMenus(currentStored || {}, savedDoc || validatedDoc));
      const bits = [];
      if (s.added) bits.push(`${s.added} added`);
      if (s.removed) bits.push(`${s.removed} removed`);
      if (s.changed) bits.push(`${s.changed} changed`);
      const tail = bits.length ? ` (${bits.join(', ')})` : '';
      const actor = await getActor(request, env);
      await logActivity(env, {
        actor,
        action: 'save',
        label: { en: `Saved menu${tail}`, ar: `حفظ القائمة${tail ? ` (${bits.join('، ')})` : ''}` },
      });
    } catch {}

    return jsonNoStore(savedDoc || validatedDoc);
  }

  return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'GET, PUT' });
}
