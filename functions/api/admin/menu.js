/**
 * Admin Menu Endpoint: /api/admin/menu
 * GET: returns current menu document
 * PUT: validates, backs up, and saves with optimistic concurrency
 */

import { validateMenu } from '../../_shared/validate.js';
import { getActor, migrateLegacyBackup, purgePublicMenu, snapshotMenu } from '../../_shared/versions.js';
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
    return new Response(JSON.stringify(current || DEFAULT_EMPTY_MENU), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }

  // PUT Handler
  if (request.method === 'PUT') {
    // 1. Require header "X-Requested-With: menu-admin"
    if (request.headers.get('X-Requested-With') !== 'menu-admin') {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'Missing custom request header' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    // 2. Require Origin check
    const origin = request.headers.get('Origin');
    const reqUrl = new URL(request.url);
    if (origin && origin !== reqUrl.origin && !origin.includes('localhost')) {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'Cross-origin request rejected' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    // 3. Content-Type & Size limits
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'Content-Type must be application/json' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    let rawBody;
    try {
      rawBody = await request.text();
    } catch {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'Failed to read request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    if (rawBody.length > 256 * 1024) {
      return new Response(JSON.stringify({ error: 'payload_too_large', message: 'Payload exceeds 256 KB limit' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: 'bad_json', message: 'Malformed JSON payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    // 4. Strict validation
    const validation = validateMenu(parsed);
    if (!validation.ok) {
      return new Response(JSON.stringify({
        error: 'validation_error',
        message: validation.errors.join('; ')
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
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
      return new Response(JSON.stringify({
        error: 'conflict',
        message: 'Conflict: Document version mismatch. Please reload the latest menu.',
        latest: currentStored
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

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

    // Increment version & update timestamp
    validatedDoc.version = (currentStored ? currentStored.version : 0) + 1;
    validatedDoc.updatedAt = new Date().toISOString();

    if (env.MENU_KV) {
      await env.MENU_KV.put('menu', JSON.stringify(validatedDoc));
    }

    // 7. Invalidate caches.default for public menu (shared helper — every
    // menu write must do this or the storefront serves stale data).
    await purgePublicMenu(request);

    // 8. Activity log (best-effort; never fails the save).
    try {
      const s = summarizeChanges(diffMenus(currentStored || {}, validatedDoc));
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

    return new Response(JSON.stringify(validatedDoc), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }

  return new Response(JSON.stringify({ error: 'method_not_allowed', message: 'Method Not Allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Allow: 'GET, PUT' }
  });
}
