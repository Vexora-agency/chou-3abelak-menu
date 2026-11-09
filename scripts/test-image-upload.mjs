/**
 * Image upload / serving / GC test suite.
 *
 * Runs the real Pages Functions with a fake R2 + fake KV. Covers the
 * security-relevant paths: CSRF gate, auth middleware, magic-byte sniffing,
 * dimension bombs, size cap, metadata stripping, response headers, ETag,
 * rate limiting, delete-in-use refusal and orphan GC.
 */

import { createAsserts, makeKV, makeReq, readJson } from './_helpers/shared.mjs';
import { onRequest as uploadRoute } from '../functions/api/admin/images.js';
import { onRequest as imageRoute } from '../functions/api/images/[[path]].js';
import { onRequest as adminMiddleware } from '../functions/api/admin/_middleware.js';
import { createSessionToken } from '../functions/_shared/session.js';
import { maybeGcOrphanImages, menuImageKeys } from '../functions/_shared/image-gc.js';
import { MAX_UPLOAD_BYTES } from '../functions/_shared/image-meta.js';

const BASE = 'https://x';
const SECRET = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const OWNER_COOKIE = `__Host-admin-session=${await createSessionToken(SECRET, 'admin', 3600)}`;
const CLIENT_COOKIE = `__Host-admin-session=${await createSessionToken(SECRET, 'client:layali', 3600)}`;

const { ok, summary } = createAsserts();

function makeR2() {
  const store = new Map(); // key -> { bytes, httpMetadata, uploaded }
  return {
    __store: store,
    async put(key, value, opts) {
      const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
      store.set(key, {
        bytes,
        httpMetadata: (opts && opts.httpMetadata) || {},
        uploaded: new Date(),
      });
    },
    async get(key) {
      const obj = store.get(key);
      if (!obj) return null;
      return {
        body: new Blob([obj.bytes]).stream(),
        size: obj.bytes.length,
        httpEtag: `"${key.slice(-12)}"`,
        httpMetadata: obj.httpMetadata,
      };
    },
    async head(key) {
      const obj = store.get(key);
      return obj ? { size: obj.bytes.length } : null;
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + limit);
      return {
        objects: page.map((key) => ({ key, uploaded: store.get(key).uploaded })),
        truncated: start + limit < keys.length,
        cursor: String(start + limit),
      };
    },
  };
}

function makeEnv() {
  return {
    MENU_KV: makeKV(),
    MENU_IMAGES: makeR2(),
    SESSION_SECRET: Buffer.from(SECRET).toString('base64'),
  };
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function writeU32BE(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeU32LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function makePngHeader(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  writeU32BE(bytes, 8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  writeU32BE(bytes, 16, width);
  writeU32BE(bytes, 20, height);
  bytes[24] = 8; // bit depth
  bytes[25] = 6; // colour type
  return bytes;
}

function makeJpeg() {
  const parts = [];
  const push = (...values) => parts.push(...values);
  push(0xff, 0xd8); // SOI
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53]; // "Exif\0\0GPS"
  push(0xff, 0xe1, 0x00, exif.length + 2, ...exif); // APP1
  push(0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x04, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00); // SOF0 4x3
  push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00); // SOS
  push(0x12, 0x34, 0xff, 0x00, 0x56); // entropy (stuffed FF)
  push(0xff, 0xd9); // EOI
  push(...Buffer.from('MALICIOUS-TRAILER'));
  return Uint8Array.from(parts);
}

function makeWebp({ animated = false, withExif = true } = {}) {
  const chunks = [];
  const vp8x = new Uint8Array(8 + 10);
  vp8x.set([0x56, 0x50, 0x38, 0x58], 0); // VP8X
  writeU32LE(vp8x, 4, 10);
  vp8x[8] = (withExif ? 0x08 : 0) | (animated ? 0x02 : 0);
  vp8x[12] = 1; // canvas width - 1 = 1 -> 2px
  vp8x[15] = 1; // canvas height - 1 = 1 -> 2px
  chunks.push(vp8x);
  if (withExif) {
    const exif = new Uint8Array(8 + 6);
    exif.set([0x45, 0x58, 0x49, 0x46], 0); // EXIF
    writeU32LE(exif, 4, 6);
    exif.set(Buffer.from('GPSGPS'), 8);
    chunks.push(exif);
  }
  const bodySize = 4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(8 + bodySize);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  writeU32LE(out, 4, bodySize);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  let offset = 12;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function postBody(bytes, headers = {}) {
  return makeReq('POST', `${BASE}/api/admin/images`, {
    headers: { 'Content-Type': 'application/octet-stream', ...headers },
    body: bytes,
  });
}

async function runUpload(env, bytes, headers) {
  const request = postBody(bytes, headers);
  const response = await uploadRoute({ request, env });
  return { response, body: await readJson(response) };
}

// ---------------------------------------------------------------- auth/CSRF

{
  const env = makeEnv();
  const request = postBody(PNG_1X1);
  const response = await adminMiddleware({ request, env, next: async () => new Response('leaked') });
  ok(response.status === 403, 'middleware: anonymous upload is 403');
  ok((await response.text()).includes('forbidden'), 'middleware: anonymous body is forbidden');
}

{
  const env = makeEnv();
  let reached = false;
  const request = postBody(PNG_1X1, { Cookie: OWNER_COOKIE });
  const response = await adminMiddleware({
    request,
    env,
    next: async () => {
      reached = true;
      return uploadRoute({ request, env });
    },
  });
  ok(reached, 'middleware: owner session reaches the route');
  ok(response.status === 200, 'middleware: owner upload succeeds');
}

{
  const env = makeEnv();
  const request = postBody(PNG_1X1, { Cookie: CLIENT_COOKIE });
  const response = await adminMiddleware({ request, env, next: async () => uploadRoute({ request, env }) });
  ok(response.status === 200, 'middleware: client session can upload like menu edits');
}

{
  const env = makeEnv();
  const request = postBody(PNG_1X1, { 'X-Requested-With': 'nope' });
  const response = await uploadRoute({ request, env });
  ok(response.status === 400, 'csrf: wrong custom header is rejected');
}

{
  const env = makeEnv();
  const request = new Request(`${BASE}/api/admin/images`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'menu-admin', Origin: 'https://evil.test', 'Content-Type': 'image/png' },
    body: PNG_1X1,
  });
  const response = await uploadRoute({ request, env });
  ok(response.status === 403, 'csrf: cross-origin upload is rejected');
}

// ---------------------------------------------------------------- upload

{
  const env = makeEnv();
  const { response, body } = await runUpload(env, PNG_1X1, { 'Content-Type': 'image/png' });
  ok(response.status === 200, 'upload: valid PNG is accepted');
  ok(body && body.ok === true, 'upload: response ok=true');
  ok(body && /^menu\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/.test(body.key), 'upload: key is server-generated UUID path');
  ok(body && body.url === `/api/images/${body.key}`, 'upload: url is same-origin /api/images path');
  ok(body && body.width === 1 && body.height === 1, 'upload: dimensions are reported');
  ok(body && body.type === 'png', 'upload: detected type is png');
  const stored = env.MENU_IMAGES.__store.get(body.key);
  ok(Boolean(stored), 'upload: object exists in R2');
  ok(stored && stored.httpMetadata.contentType === 'image/png', 'upload: R2 content-type is allowlisted');
  ok(stored && stored.httpMetadata.cacheControl.includes('immutable'), 'upload: R2 cache-control is immutable');
  ok((await env.MENU_KV.get('img:gc')) === '1', 'upload: marks the GC flag');
}

{
  const env = makeEnv();
  const { response, body } = await runUpload(env, makeJpeg(), { 'Content-Type': 'image/jpeg' });
  ok(response.status === 200 && body && body.ok, 'upload: JPEG with EXIF is accepted');
  const stored = env.MENU_IMAGES.__store.get(body.key).bytes;
  const text = Buffer.from(stored).toString('latin1');
  ok(body && body.width === 4 && body.height === 3, 'upload: JPEG dimensions parsed from SOF0');
  ok(!text.includes('GPS'), 'upload: EXIF/GPS block is stripped');
  ok(!text.includes('MALICIOUS'), 'upload: bytes appended after EOI are stripped');
  ok(stored[stored.length - 2] === 0xff && stored[stored.length - 1] === 0xd9, 'upload: sanitized JPEG ends at EOI');
}

{
  const env = makeEnv();
  const webp = makeWebp();
  const { response, body } = await runUpload(env, webp, { 'Content-Type': 'image/webp' });
  ok(response.status === 200 && body && body.ok, 'upload: WebP is accepted');
  ok(body && body.width === 2 && body.height === 2, 'upload: WebP VP8X canvas dimensions parsed');
  const stored = env.MENU_IMAGES.__store.get(body.key).bytes;
  ok(!Buffer.from(stored).toString('latin1').includes('EXIF'), 'upload: WebP EXIF chunk is stripped');
  ok(stored.length < webp.length, 'upload: WebP sanitizer removes the EXIF chunk');
}

// ---------------------------------------------------------------- rejections

{
  const env = makeEnv();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const { response, body } = await runUpload(env, svg, { 'Content-Type': 'image/svg+xml' });
  ok(response.status === 415 && body.error === 'unsupported_media_type', 'reject: SVG content-type is refused');
}

{
  const env = makeEnv();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const { response, body } = await runUpload(env, svg, { 'Content-Type': 'application/octet-stream' });
  ok(response.status === 415 && body.error === 'unsupported_type', 'reject: SVG magic bytes are refused');
}

{
  const env = makeEnv();
  const { response, body } = await runUpload(env, makePngHeader(9000, 9000), { 'Content-Type': 'image/png' });
  ok(response.status === 400 && body.error === 'image_too_large', 'reject: 9000px PNG header bomb is refused');
}

{
  const env = makeEnv();
  const { response, body } = await runUpload(env, makePngHeader(7000, 7000), { 'Content-Type': 'image/png' });
  ok(response.status === 400 && body.error === 'image_too_large', 'reject: 49 MP PNG is refused');
}

{
  const env = makeEnv();
  const { response, body } = await runUpload(env, makePngHeader(9000, 100), { 'Content-Type': 'image/png' });
  ok(response.status === 400 && body.error === 'image_too_large', 'reject: 90:1 panorama is refused');
}

{
  const env = makeEnv();
  const { response, body } = await runUpload(env, makeWebp({ animated: true }), { 'Content-Type': 'image/webp' });
  ok(response.status === 400 && body.error === 'animated_unsupported', 'reject: animated WebP is refused');
}

{
  const env = makeEnv();
  const { response, body } = await runUpload(env, new Uint8Array(MAX_UPLOAD_BYTES + 1), { 'Content-Type': 'image/png' });
  ok(response.status === 413 && body.error === 'too_large', 'reject: body over 8 MB is refused');
}

// ---------------------------------------------------------------- rate limit

{
  const env = makeEnv();
  let lastStatus = 0;
  let lastBody = null;
  for (let i = 0; i < 21; i += 1) {
    const result = await runUpload(env, PNG_1X1, { 'Content-Type': 'image/png' });
    lastStatus = result.response.status;
    lastBody = result.body;
  }
  ok(lastStatus === 429 && lastBody && lastBody.error === 'rate_limited', 'rate: 21st upload in 10 minutes is 429');
  ok(env.MENU_IMAGES.__store.size === 20, 'rate: only the allowed uploads were stored');
}

// ---------------------------------------------------------------- serving

{
  const env = makeEnv();
  const { body } = await runUpload(env, PNG_1X1, { 'Content-Type': 'image/png' });
  const served = await imageRoute({
    request: new Request(`${BASE}/api/images/${body.key}`),
    env,
    params: { path: body.key.split('/') },
  });
  ok(served.status === 200, 'serve: uploaded image is readable');
  ok(served.headers.get('Content-Type') === 'image/png', 'serve: content-type is image/png');
  ok(served.headers.get('X-Content-Type-Options') === 'nosniff', 'serve: nosniff header');
  ok(served.headers.get('Content-Security-Policy') === "default-src 'none'; sandbox", 'serve: CSP sandbox header');
  ok(served.headers.get('Cross-Origin-Resource-Policy') === 'same-origin', 'serve: CORP same-origin');
  ok((served.headers.get('Cache-Control') || '').includes('immutable'), 'serve: immutable caching');
  ok(Boolean(served.headers.get('ETag')), 'serve: ETag present');
  ok(Boolean(served.headers.get('Content-Length')), 'serve: Content-Length present');
  const bytes = new Uint8Array(await served.arrayBuffer());
  ok(bytes.length === PNG_1X1.length, 'serve: body matches the stored bytes');

  const etag = served.headers.get('ETag');
  const cached = await imageRoute({
    request: new Request(`${BASE}/api/images/${body.key}`, { headers: { 'If-None-Match': etag } }),
    env,
  });
  ok(cached.status === 304, 'serve: If-None-Match returns 304');

  const head = await imageRoute({
    request: new Request(`${BASE}/api/images/${body.key}`, { method: 'HEAD' }),
    env,
  });
  ok(head.status === 200 && head.body === null, 'serve: HEAD has headers and no body');

  const missing = await imageRoute({
    request: new Request(`${BASE}/api/images/menu/2026/01/11111111-1111-4111-8111-111111111111.png`),
    env,
  });
  ok(missing.status === 404, 'serve: unknown key is 404');

  const traversal = await imageRoute({
    request: new Request(`${BASE}/api/images/..%2Fmenu%2F2026%2F01%2F11111111-1111-4111-8111-111111111111.png`),
    env,
  });
  ok(traversal.status === 404, 'serve: encoded traversal is 404');

  const post = await imageRoute({
    request: new Request(`${BASE}/api/images/${body.key}`, { method: 'POST', body: 'x' }),
    env,
  });
  ok(post.status === 405, 'serve: POST is 405');
}

// ---------------------------------------------------------------- delete

{
  const env = makeEnv();
  const { body } = await runUpload(env, PNG_1X1, { 'Content-Type': 'image/png' });

  const bad = await uploadRoute({
    request: makeReq('DELETE', `${BASE}/api/admin/images?key=../../menu/x.png`),
    env,
  });
  ok(bad.status === 400, 'delete: malformed key is 400');

  await env.MENU_KV.put('menu', JSON.stringify({ version: 1, items: [{ imageUrl: `/api/images/${body.key}` }] }));
  const used = await uploadRoute({
    request: makeReq('DELETE', `${BASE}/api/admin/images?key=${encodeURIComponent(body.key)}`),
    env,
  });
  ok(used.status === 409, 'delete: referenced image is refused');

  await env.MENU_KV.put('menu', JSON.stringify({ version: 1, items: [] }));
  const removed = await uploadRoute({
    request: makeReq('DELETE', `${BASE}/api/admin/images?key=${encodeURIComponent(body.key)}`),
    env,
  });
  ok(removed.status === 200, 'delete: unreferenced image is removed');
  ok(!env.MENU_IMAGES.__store.has(body.key), 'delete: object is gone from R2');

  const again = await uploadRoute({
    request: makeReq('DELETE', `${BASE}/api/admin/images?key=${encodeURIComponent(body.key)}`),
    env,
  });
  ok(again.status === 404, 'delete: missing object is 404');
}

// ---------------------------------------------------------------- GC

{
  const env = makeEnv();
  const { body } = await runUpload(env, PNG_1X1, { 'Content-Type': 'image/png' });
  const referencedKey = body.key;
  const oldOrphan = 'menu/2026/01/22222222-2222-4222-8222-222222222222.png';
  const freshOrphan = 'menu/2026/01/33333333-3333-4333-8333-333333333333.png';
  await env.MENU_IMAGES.put(oldOrphan, PNG_1X1, { httpMetadata: { contentType: 'image/png' } });
  await env.MENU_IMAGES.put(freshOrphan, PNG_1X1, { httpMetadata: { contentType: 'image/png' } });
  env.MENU_IMAGES.__store.get(oldOrphan).uploaded = new Date(Date.now() - 60 * 60 * 1000);
  const menu = { version: 2, items: [{ imageUrl: `/api/images/${referencedKey}` }, { imageUrl: 'https://cdn.test/x.jpg' }] };

  const deleted = await maybeGcOrphanImages(env, menu);
  ok(deleted === 1, 'gc: deletes exactly the old unreferenced object');
  ok(env.MENU_IMAGES.__store.has(referencedKey), 'gc: keeps a referenced upload');
  ok(env.MENU_IMAGES.__store.has(freshOrphan), 'gc: keeps a fresh upload inside the 15-minute floor');
  ok(!env.MENU_IMAGES.__store.has(oldOrphan), 'gc: old orphan is gone');
  ok((await env.MENU_KV.get('img:gc')) === '0', 'gc: flag is claimed so autosaves do not rescan');

  const keys = menuImageKeys({
    items: [
      { imageUrl: `/api/images/${referencedKey}?v=2` },
      { imageUrl: 'https://cdn.test/x.jpg' },
      { imageUrl: '/api/images/menu/2026/01/not-a-uuid.png' },
      { imageUrl: '/api/images/../../etc/passwd' },
      {},
    ],
  });
  ok(keys.size === 1 && keys.has(referencedKey), 'gc: reference extraction ignores external/traversal URLs');
}

console.log('\nimage upload suite');
summary();
