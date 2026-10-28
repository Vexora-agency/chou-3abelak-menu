/**
 * Public Menu Endpoint: GET /api/menu
 * Cloudflare Pages Function
 *
 * Raw Response stays ONLY for the cache-designed paths below (public 200
 * with ETag + Cache API, 304s). The JSON 405 uses jsonNoStore like the rest.
 */

import { jsonNoStore } from '../_shared/session.js';

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

  // Only allow GET / HEAD
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  // Attempt to serve from Cache API first if present
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const cacheKey = new Request(request.url, { method: 'GET' });

  if (cache) {
    try {
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        // Handle If-None-Match
        const etag = cachedResponse.headers.get('ETag');
        if (etag && request.headers.get('If-None-Match') === etag) {
          return new Response(null, { status: 304, headers: cachedResponse.headers });
        }
        return cachedResponse;
      }
    } catch {}
  }

  // Fetch from KV
  let menu = null;
  if (env.MENU_KV) {
    try {
      menu = await env.MENU_KV.get('menu', { type: 'json', cacheTtl: 60 });
    } catch {}
  }

  const responseData = menu || DEFAULT_EMPTY_MENU;
  const jsonBody = JSON.stringify(responseData);

  // Compute ETag
  let hashStr = `W/"${responseData.version || 1}-${responseData.updatedAt || '0'}"`;

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
    'X-Content-Type-Options': 'nosniff',
    'ETag': hashStr
  };

  // Check 304
  if (request.headers.get('If-None-Match') === hashStr) {
    return new Response(null, { status: 304, headers });
  }

  const response = new Response(jsonBody, { status: 200, headers });

  if (cache) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}
