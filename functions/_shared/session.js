/**
 * Shared session helpers for cookie-based admin auth.
 * WebCrypto only — no dependencies, works in Cloudflare Workers.
 */

export const COOKIE_NAME = '__Host-admin-session';
export const MIN_PBKDF2_ITERATIONS = 210000;
export const MAX_BODY_BYTES = 4 * 1024;

/* ---------- base64 helpers (standard base64, matching the hash format) ---------- */

function b64encode(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function b64decode(str) {
  const binary = atob(String(str));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64urlEncodeText(text) {
  return b64encode(new TextEncoder().encode(text))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecodeToBytes(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return b64decode(s);
}

/* ---------- constant-time comparison ---------- */

export function timingSafeEqual(a, b) {
  const ab = a instanceof Uint8Array ? a : new Uint8Array(a || []);
  const bb = b instanceof Uint8Array ? b : new Uint8Array(b || []);
  // Always walk the longer buffer so length alone reveals nothing about content.
  const n = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < n; i++) {
    diff |= (ab[i % Math.max(ab.length, 1)] || 0) ^ (bb[i % Math.max(bb.length, 1)] || 0);
  }
  return diff === 0;
}

export function safeCompareStrings(a, b) {
  return timingSafeEqual(new TextEncoder().encode(String(a ?? '')), new TextEncoder().encode(String(b ?? '')));
}

/* ---------- password hash ---------- */

export function parsePasswordHash(stored) {
  // Format: pbkdf2$<iterations>$<saltB64>$<hashB64>
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS) return null;
  let salt;
  let hash;
  try {
    salt = b64decode(parts[2]);
    hash = b64decode(parts[3]);
  } catch {
    return null;
  }
  if (!salt || salt.length < 16 || !hash || hash.length < 32) return null;
  return { iterations, salt, hash };
}

async function derivePasswordKey(password, salt, iterations, hashLen) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password ?? '')), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    hashLen * 8
  );
  return new Uint8Array(bits);
}

/**
 * Verify a username + password pair. Unknown users cost roughly the same
 * amount of work (a dummy PBKDF2) so wrong-user and wrong-password look
 * identical from the outside. Never throws for bad input.
 */
export async function verifyLogin(username, password, expectedUsername, storedHash) {
  const userOk = safeCompareStrings(username, expectedUsername);
  const parsed = parsePasswordHash(storedHash);
  let passOk;
  try {
    if (parsed) {
      const derived = await derivePasswordKey(password, parsed.salt, parsed.iterations, parsed.hash.length);
      passOk = timingSafeEqual(derived, parsed.hash);
    } else {
      // Unknown/misconfigured hash: still burn comparable CPU so timing leaks nothing.
      await derivePasswordKey(password, new Uint8Array(16), 260000, 32);
      passOk = false;
    }
  } catch {
    passOk = false;
  }
  return userOk && passOk;
}

/* ---------- HMAC session tokens ---------- */

async function hmacSha256(secretBytes, text) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

export function getSessionSecret(env) {
  let s = ((env && env.SESSION_SECRET) || '').trim();
  if (!s) return null;
  // Tolerate quoted or base64url-encoded secrets (dashboard pastes) —
  // without this, one stray quote locks every admin out with a bare 503.
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  let bytes;
  try {
    bytes = b64decode(s);
  } catch {
    return null;
  }
  if (!bytes || bytes.length < 32) return null;
  return bytes;
}

export async function createSessionToken(secretBytes, sub, maxAgeSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlEncodeText(JSON.stringify({ sub, iat: now, exp: now + maxAgeSec }));
  const sigBytes = await hmacSha256(secretBytes, body);
  let sig;
  {
    let binary = '';
    for (let i = 0; i < sigBytes.length; i++) binary += String.fromCharCode(sigBytes[i]);
    sig = btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  return `${body}.${sig}`;
}

export async function verifySessionToken(secretBytes, token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  let sigBytes;
  let expected;
  try {
    sigBytes = b64urlDecodeToBytes(sig);
    expected = await hmacSha256(secretBytes, body);
  } catch {
    return null;
  }
  if (!timingSafeEqual(sigBytes, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(body)));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  if (typeof payload.iat === 'number' && payload.iat > now + 60) return null;
  return payload;
}

/* ---------- cookie ---------- */

export function getSessionCookie(request) {
  const header = request.headers.get('Cookie') || '';
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

export function sessionCookieHeader(token, maxAgeSec) {
  const parts = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict'];
  if (maxAgeSec > 0) parts.push(`Max-Age=${maxAgeSec}`);
  else parts.push('Max-Age=0');
  return parts.join('; ');
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=deleted; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/* ---------- shared request guards + JSON helpers ---------- */

export function jsonNoStore(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

/**
 * Same-origin + anti-CSRF gate shared by all admin/auth endpoints:
 * requires the custom header, plus a matching Origin on state-changing
 * requests. Browsers never send Origin on same-origin GET/HEAD, so those
 * only need the custom header (they are read-only; CSRF cannot exfiltrate
 * or mutate through them).
 */
export function checkApiHeaders(request) {
  if (request.headers.get('X-Requested-With') !== 'menu-admin') {
    return { ok: false, status: 400, error: 'bad_request', message: 'Missing custom request header' };
  }
  const method = (request.method || 'GET').toUpperCase();
  const origin = request.headers.get('Origin');
  let reqOrigin;
  let originHost = '';
  let reqHost;
  try {
    reqOrigin = new URL(request.url).origin;
    reqHost = new URL(request.url).hostname;
    if (origin) originHost = new URL(origin).hostname;
  } catch {
    return { ok: false, status: 400, error: 'bad_request', message: 'Bad request URL' };
  }
  if (!origin) {
    if (method === 'GET' || method === 'HEAD') return { ok: true };
    return { ok: false, status: 400, error: 'bad_request', message: 'Missing Origin header' };
  }
  const sameHost = (h) => h === 'localhost' || h === '127.0.0.1';
  const localhost = sameHost(originHost) && sameHost(reqHost);
  if (origin !== reqOrigin && !localhost) {
    return { ok: false, status: 403, error: 'forbidden', message: 'Cross-origin request rejected' };
  }
  return { ok: true };
}

export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  let raw;
  try {
    raw = await request.text();
  } catch {
    throw new Error('unreadable');
  }
  if (raw.length === 0 || raw.length > maxBytes) throw new Error('badsize');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('badjson');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('badjson');
  return parsed;
}
