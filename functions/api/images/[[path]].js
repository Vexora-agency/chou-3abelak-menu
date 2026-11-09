/**
 * GET/HEAD /api/images/menu/<YYYY>/<MM>/<uuid>.<ext>
 *
 * Public read path for admin-uploaded menu photos. Served from the same
 * origin so the storefront CSP (`img-src 'self'`) keeps working and the R2
 * bucket never needs to be exposed publicly.
 *
 * Hardening on every response:
 *  - Content-Type from the stored extension allowlist (never the upload's)
 *  - X-Content-Type-Options: nosniff
 *  - Content-Disposition: inline with a generated filename
 *  - Content-Security-Policy: default-src 'none'; sandbox
 *  - Cross-Origin-Resource-Policy: same-origin (no hotlinking)
 *  - immutable caching + ETag / If-None-Match -> 304
 */

import { contentTypeFor, keyFromPath } from '../../_shared/image-meta.js';

const EXT_TYPE = { jpg: 'jpeg', png: 'png', webp: 'webp' };
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

function plain(status, error, extraHeaders = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function matchesEtag(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((part) => part.trim())
    .some((part) => part === etag || part === `W/${etag}`);
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return plain(405, 'method_not_allowed', { Allow: 'GET, HEAD' });
  }

  const key = keyFromPath(new URL(request.url).pathname);
  if (!key) return plain(404, 'not_found');

  if (!env.MENU_IMAGES || typeof env.MENU_IMAGES.get !== 'function') {
    return plain(503, 'unavailable');
  }

  let object;
  try {
    object = await env.MENU_IMAGES.get(key);
  } catch {
    return plain(503, 'unavailable');
  }
  if (!object) return plain(404, 'not_found');

  const ext = key.slice(key.lastIndexOf('.') + 1);
  const contentType = contentTypeFor(EXT_TYPE[ext]) || 'application/octet-stream';
  const etag = object.httpEtag || (object.etag ? `"${object.etag}"` : '');
  const filename = key.slice(key.lastIndexOf('/') + 1);

  const headers = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': CACHE_CONTROL,
    'X-Robots-Tag': 'noindex',
  };
  if (etag) headers.ETag = etag;
  if (typeof object.size === 'number') headers['Content-Length'] = String(object.size);

  if (etag && matchesEtag(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers });
  }

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  return new Response(object.body, { status: 200, headers });
}
