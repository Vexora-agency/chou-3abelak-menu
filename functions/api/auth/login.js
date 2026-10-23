/**
 * Admin Login Endpoint: POST /api/auth/login
 * Cookie-based session login with PBKDF2 password check + IP rate limiting.
 */

import {
  checkApiHeaders,
  createSessionToken,
  getSessionSecret,
  jsonNoStore,
  readJsonBody,
  sessionCookieHeader,
  verifyLogin,
} from '../../_shared/session.js';

const FAIL_PREFIX = 'login:fail:';
const FAIL_TTL_SEC = 15 * 60;
const MAX_FAILURES = 5;
const SESSION_SHORT_SEC = 12 * 3600;
const SESSION_LONG_SEC = 30 * 24 * 3600;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function readFailState(kv, ip) {
  if (!kv) return { count: 0, resetAt: 0 };
  try {
    const raw = await kv.get(FAIL_PREFIX + ip);
    if (!raw) return { count: 0, resetAt: 0 };
    const parsed = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    if (!parsed || typeof parsed.n !== 'number' || typeof parsed.reset !== 'number' || now >= parsed.reset) {
      return { count: 0, resetAt: 0 };
    }
    return { count: parsed.n, resetAt: parsed.reset };
  } catch {
    return { count: 0, resetAt: 0 };
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'POST' });
  }

  // Shared anti-CSRF gates (custom header + matching Origin)
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  // JSON only
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_request', message: 'Content-Type must be application/json' }, 400);
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonNoStore({ error: 'bad_request', message: 'Invalid JSON body' }, 400);
  }

  const username = typeof body.username === 'string' ? body.username.trim().slice(0, 320) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 1024) : '';
  const remember = body.remember === true;
  if (!username || !password) {
    // Same generic shape as a failed login; no detail leaked.
    return jsonNoStore({ error: 'invalid', message: 'Invalid credentials' }, 401);
  }

  // Server configuration must exist; fail closed otherwise.
  const expectedUser = (env.ADMIN_USERNAME || '').trim();
  const storedHash = (env.ADMIN_PASSWORD_HASH || '').trim();
  const secret = getSessionSecret(env);
  const kv = env.MENU_KV || null;
  if (!expectedUser || !storedHash || !secret || !kv) {
    return jsonNoStore({ error: 'unavailable', message: 'Login is not configured' }, 503);
  }

  // Rate limit by client IP
  const ip = clientIp(request);
  const fail = await readFailState(kv, ip);
  if (fail.count >= MAX_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil((fail.resetAt - Math.floor(Date.now() / 1000)) / 60));
    return jsonNoStore({ error: 'locked', retryAfter, message: 'Too many attempts' }, 429);
  }

  const ok = await verifyLogin(username, password, expectedUser, storedHash);
  if (ok) {
    try {
      await kv.delete(FAIL_PREFIX + ip);
    } catch {}
    const maxAge = remember ? SESSION_LONG_SEC : SESSION_SHORT_SEC;
    const token = await createSessionToken(secret, 'admin', maxAge);
    return jsonNoStore({ ok: true }, 200, {
      'Set-Cookie': sessionCookieHeader(token, maxAge),
    });
  }

  // Record the failure (generic response either way)
  const nowSec = Math.floor(Date.now() / 1000);
  const next = fail.count + 1;
  const resetAt = fail.resetAt > nowSec ? fail.resetAt : nowSec + FAIL_TTL_SEC;
  try {
    await kv.put(FAIL_PREFIX + ip, JSON.stringify({ n: next, reset: resetAt }), { expirationTtl: FAIL_TTL_SEC });
  } catch {}
  if (next >= MAX_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - nowSec) / 60));
    return jsonNoStore({ error: 'locked', retryAfter, message: 'Too many attempts' }, 429);
  }
  return jsonNoStore({ error: 'invalid', message: 'Invalid credentials' }, 401);
}
