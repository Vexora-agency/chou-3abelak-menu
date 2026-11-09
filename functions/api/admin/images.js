/**
 * /api/admin/images — admin photo upload / delete.
 *
 * POST   raw image bytes  -> { ok, url, key, width, height, bytes, type }
 * DELETE ?key=menu/...    -> { ok }  (refused while the menu still references it)
 *
 * Security layers, in order:
 *  1. /api/admin/_middleware.js session gate (owner or client session).
 *  2. checkApiHeaders: X-Requested-With + same-origin Origin (CSRF).
 *  3. Per-IP rate limit (KV, fail-open like the rest of the admin routes).
 *  4. Streaming body read with a hard 8 MB cap — Content-Length alone is
 *     advisory, so the byte count is enforced while reading.
 *  5. Magic-byte sniffing (JPEG/PNG/WebP only), animation rejection,
 *     header-only dimension limits, metadata/trailing-byte stripping.
 *  6. Random UUID key under menu/<year>/<month>/; the client filename is
 *     never used or stored.
 */

import { checkApiHeaders, jsonNoStore } from '../../_shared/session.js';
import { rateKey } from '../../_shared/access.js';
import { hitRateLimit } from '../../_shared/ratelimit.js';
import { analyzeImage, IMAGE_KEY_RE, MAX_UPLOAD_BYTES } from '../../_shared/image-meta.js';
import { markImageGcPending } from '../../_shared/image-gc.js';

const UPLOAD_RATE_MAX = 20;
const UPLOAD_RATE_WINDOW = 10 * 60;
const DELETE_RATE_MAX = 30;
const DELETE_RATE_WINDOW = 10 * 60;

const ALLOWED_REQUEST_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/octet-stream',
]);

const ERROR_STATUS = {
  empty: 400,
  malformed: 400,
  animated_unsupported: 400,
  unsupported_type: 415,
  image_too_large: 400,
  too_large: 413,
};

const ERROR_MESSAGE = {
  empty: 'Empty image body',
  malformed: 'Malformed or truncated image',
  animated_unsupported: 'Animated images are not supported',
  unsupported_type: 'Only JPEG, PNG or WebP images are accepted',
  image_too_large: 'Image dimensions are too large',
  too_large: 'Image exceeds the 8 MB limit',
};

/** Read at most `max` bytes; cancel as soon as the cap is crossed. */
async function readBodyCapped(request, max) {
  const declared = Number(request.headers.get('Content-Length') || '');
  if (Number.isFinite(declared) && declared > max) return { tooLarge: true };
  if (!request.body) return { bytes: null };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > max) {
      try {
        await reader.cancel();
      } catch {}
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  if (total === 0) return { bytes: null };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

function audit(event, details) {
  try {
    console.log(JSON.stringify({ evt: event, ...details }));
  } catch {}
}

async function handleUpload(request, env) {
  if (!env.MENU_IMAGES || typeof env.MENU_IMAGES.put !== 'function') {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  if (!env.MENU_KV) return jsonNoStore({ ok: false, error: 'unavailable' }, 503);

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (contentType && !ALLOWED_REQUEST_TYPES.has(contentType)) {
    return jsonNoStore({ ok: false, error: 'unsupported_media_type' }, 415);
  }

  if (!(await hitRateLimit(env.MENU_KV, rateKey('rl:image-upload', request), UPLOAD_RATE_MAX, UPLOAD_RATE_WINDOW))) {
    return jsonNoStore({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': String(UPLOAD_RATE_WINDOW) });
  }

  let body;
  try {
    body = await readBodyCapped(request, MAX_UPLOAD_BYTES);
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }
  if (body.tooLarge) {
    return jsonNoStore({ ok: false, error: 'too_large', message: ERROR_MESSAGE.too_large }, 413);
  }
  if (!body.bytes) {
    return jsonNoStore({ ok: false, error: 'empty', message: ERROR_MESSAGE.empty }, 400);
  }

  const image = analyzeImage(body.bytes);
  if (!image.ok) {
    const status = ERROR_STATUS[image.error] || 400;
    audit('image_upload_rejected', { error: image.error, bytes: body.bytes.length });
    return jsonNoStore(
      { ok: false, error: image.error, message: ERROR_MESSAGE[image.error] || 'Invalid image' },
      status,
    );
  }

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = `menu/${year}/${month}/${crypto.randomUUID()}.${image.ext}`;

  try {
    await env.MENU_IMAGES.put(key, image.bytes, {
      httpMetadata: {
        contentType: image.contentType,
        contentDisposition: `inline; filename="${key.slice(key.lastIndexOf('/') + 1)}"`,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        uploadedAt: now.toISOString(),
        source: 'admin-upload',
      },
    });
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }

  await markImageGcPending(env);
  audit('image_upload', { key, type: image.type, bytes: image.bytes.length, width: image.width, height: image.height });

  return jsonNoStore({
    ok: true,
    url: `/api/images/${key}`,
    key,
    width: image.width,
    height: image.height,
    bytes: image.bytes.length,
    type: image.type,
  });
}

async function handleDelete(request, env, url) {
  if (!env.MENU_IMAGES || typeof env.MENU_IMAGES.delete !== 'function') {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  if (!env.MENU_KV) return jsonNoStore({ ok: false, error: 'unavailable' }, 503);

  if (!(await hitRateLimit(env.MENU_KV, rateKey('rl:image-delete', request), DELETE_RATE_MAX, DELETE_RATE_WINDOW))) {
    return jsonNoStore({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': String(DELETE_RATE_WINDOW) });
  }

  const key = url.searchParams.get('key') || '';
  if (!IMAGE_KEY_RE.test(key)) return jsonNoStore({ ok: false, error: 'bad_request' }, 400);

  let menu = null;
  try {
    menu = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (menu && JSON.stringify(menu).includes(`/api/images/${key}`)) {
    return jsonNoStore({ ok: false, error: 'in_use' }, 409);
  }

  try {
    const head = typeof env.MENU_IMAGES.head === 'function' ? await env.MENU_IMAGES.head(key) : null;
    if (!head) return jsonNoStore({ ok: false, error: 'not_found' }, 404);
    await env.MENU_IMAGES.delete(key);
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }

  audit('image_delete', { key });
  return jsonNoStore({ ok: true });
}

export async function onRequest(context) {
  const { request, env } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ ok: false, error: gate.error }, gate.status);

  const url = new URL(request.url);
  if (request.method === 'POST') return handleUpload(request, env);
  if (request.method === 'DELETE') return handleDelete(request, env, url);

  return jsonNoStore({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'POST, DELETE' });
}
