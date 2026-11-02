/**
 * Client-account + invite-link security primitives (WebCrypto only, no deps).
 *
 * Threat model (OWASP forgot-password / reset checklist, adapted to invites):
 *  - Token guessing ....... 256-bit CSPRNG, base64url, single-use, 72 h TTL
 *  - DB dump ............... only SHA-256(token) stored, never the raw token
 *  - Replay / double use ... atomic consume (UPDATE ... WHERE used_at IS NULL)
 *  - Enumeration ........... generic responses everywhere public
 *  - Brute force ........... KV IP rate limits + per-token attempt burn
 *  - Host-header poisoning . links built from configured SITE_URL, never Host
 *  - Referer leakage ....... /invite/* serves Referrer-Policy: no-referrer
 *  - CSRF .................. shared checkApiHeaders (custom header + Origin)
 *  - Type confusion ........ strict token/username/password shape checks
 *  - Session fixation ...... redeem mints a FRESH session, never reuses one
 */
import { getSessionCookie, getSessionSecret, verifySessionToken } from './session.js';

export const INVITE_TTL_SEC = 72 * 3600;
export const INVITE_MAX_ATTEMPTS = 20;
export const TOKEN_BYTES = 32;
export const MIN_CLIENT_PASSWORD = 12;
export const MAX_CLIENT_PASSWORD = 128;
// Revocation stamps must outlive the longest session they can kill.
export const REVOKE_TTL_SEC = 30 * 24 * 3600;
// PBKDF2-SHA256 cost identical to scripts/hash-password.mjs (edge CPU budget).
export const CLIENT_PBKDF2_ITERATIONS = 50000;

/** 256-bit cryptographically random token, 43-char base64url (URL-safe). */
export function newInviteToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict shape: exactly what newInviteToken() emits — nothing else accepted. */
export function isTokenFormat(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
}

/** Login names: lowercase slug, 2–31 chars (predictable, URL-safe, no lookalikes). */
export function isInviteUsername(u) {
  return typeof u === 'string' && /^[a-z0-9][a-z0-9_-]{1,30}$/.test(u.trim());
}

export function normalizeUsername(u) {
  return typeof u === 'string' ? u.trim().toLowerCase() : '';
}

/** NIST 800-63B style: length floor, generous ceiling, no composition rules. */
export function isPasswordOk(p) {
  return typeof p === 'string' && p.length >= MIN_CLIENT_PASSWORD && p.length <= MAX_CLIENT_PASSWORD;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text ?? '')));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Password hash in the exact repo format (pbkdf2$iter$salt$hash) so the
 *  login path verifies it with the existing timing-safe verifier. */
export async function hashClientPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: CLIENT_PBKDF2_ITERATIONS },
      key,
      256
    )
  );
  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  };
  return `pbkdf2$${CLIENT_PBKDF2_ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

/** Generic KV counter: { ok:true } or { ok:false, retryMin }. Counts every
 *  hit (not just failures) — invite endpoints are single-shot by design. */
export async function checkRateLimit(kv, key, max, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const st = await readLimitState(kv, key, now);
  if (st.n >= max) {
    return { ok: false, retryMin: Math.max(1, Math.ceil((st.reset - now) / 60)) };
  }
  const reset = st.reset > now ? st.reset : now + ttlSec;
  try {
    if (kv) await kv.put(key, JSON.stringify({ n: st.n + 1, reset }), { expirationTtl: ttlSec });
  } catch {}
  return { ok: true };
}

/** Shared counter read: current window count or a zeroed state. Fails open
 *  (zeroed) when KV is unreachable — same posture as checkRateLimit. */
async function readLimitState(kv, key, nowSec) {
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  try {
    const raw = kv ? await kv.get(key) : null;
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.n === 'number' && typeof p.reset === 'number' && now < p.reset) return p;
    }
  } catch {}
  return { n: 0, reset: 0 };
}

/** Read-only limit probe: 1 KV read, zero writes. Use before cheap work on
 *  hot polled routes — legitimate successes must not cost a write. */
export async function isRateLimited(kv, key, max) {
  const st = await readLimitState(kv, key);
  return st.n >= max;
}

/** Count one abusive hit: read + write. Call ONLY on failure paths (bad
 *  token, rejected attempt) — successes stay write-free. Fails silently
 *  when KV is unreachable. */
export async function noteRateLimitHit(kv, key, max, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const st = await readLimitState(kv, key, now);
  if (st.n >= max) return { ok: false };
  const reset = st.reset > now ? st.reset : now + ttlSec;
  try {
    if (kv) await kv.put(key, JSON.stringify({ n: st.n + 1, reset }), { expirationTtl: ttlSec });
  } catch {}
  return { ok: true };
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export function rateKey(prefix, request) {
  return `${prefix}:${clientIp(request)}`;
}

/**
 * Owner-only gate: a valid cookie session whose sub is exactly 'admin'
 * (the master env login). Client sessions (sub `client:*`) fail closed —
 * clients can use the admin, but only the owner mints/revokes invites.
 */
export async function requireOwner(request, env) {
  try {
    const secret = getSessionSecret(env);
    if (!secret) return null;
    const token = getSessionCookie(request);
    if (!token) return null;
    const payload = await verifySessionToken(secret, token);
    if (!payload || payload.sub !== 'admin') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Canonical site origin for invite links — configured, never Host-derived
 *  (Host-header poisoning, OWASP). https only, except loopback for local dev. */
export function siteBaseUrl(env) {
  const raw = ((env && env.SITE_URL) || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') return u.origin;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin;
    return null;
  } catch {
    return null;
  }
}

export function inviteLinkFor(env, token) {
  const base = siteBaseUrl(env);
  return base ? `${base}/invite/${token}` : null;
}

/* ---------- invite rows ---------- */

export async function findInviteByHash(db, tokenHash) {
  return db
    .prepare(
      'SELECT id, username, token_hash AS tokenHash, created_at AS createdAt, expires_at AS expiresAt, used_at AS usedAt, attempts FROM invites WHERE token_hash = ?'
    )
    .bind(tokenHash)
    .first();
}

export function inviteUsable(row, nowIso) {
  return !!row && !row.usedAt && row.expiresAt > nowIso;
}

/**
 * Atomic single-use consume: exactly one caller can flip an unused,
 * unexpired row (conditional UPDATE). Returns the row, or null when the
 * token is unknown, used, or expired — deliberately indistinguishable.
 */
export async function consumeInvite(db, tokenHash, nowIso) {
  const res = await db
    .prepare('UPDATE invites SET used_at = ?, attempts = attempts + 1 WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
    .bind(nowIso, tokenHash, nowIso)
    .run();
  if (!res.meta || res.meta.changes !== 1) return null;
  return findInviteByHash(db, tokenHash);
}

/** Failed redeem against a known row: count it, burn past the cap. */
export async function bumpInviteAttempts(db, row) {
  try {
    const attempts = (row.attempts || 0) + 1;
    if (attempts >= INVITE_MAX_ATTEMPTS) {
      await db
        .prepare('UPDATE invites SET attempts = ?, used_at = COALESCE(used_at, ?) WHERE token_hash = ?')
        .bind(attempts, new Date().toISOString(), row.tokenHash)
        .run();
    } else {
      await db.prepare('UPDATE invites SET attempts = ? WHERE token_hash = ?').bind(attempts, row.tokenHash).run();
    }
  } catch {}
}

/* ---------- live-session revocation (disable/delete kills NOW) ---------- */

export function revokeKey(username) {
  return `access:revoked:${username}`;
}

/**
 * Stamp a revocation: every session of this user minted at or before now
 * dies on its next check. The stamp carries its own timestamp so a LATER
 * account under the same name (fresh sessions, newer iat) keeps working.
 */
export async function revokeSessions(kv, username) {
  try {
    if (kv) await kv.put(revokeKey(username), String(Math.floor(Date.now() / 1000)), { expirationTtl: REVOKE_TTL_SEC });
  } catch {}
}

export async function clearRevocation(kv, username) {
  try {
    if (kv) await kv.delete(revokeKey(username));
  } catch {}
}

/**
 * True when this session must die: a client session older than (or equal
 * to) its user's revocation stamp. Owner sessions ('admin') are never
 * revoked. Fails CLOSED when the store is unreachable — a revoked user
 * must not slip through on a blip (the owner is unaffected either way).
 */
export async function isSessionRevoked(kv, sub, iat) {
  if (typeof sub !== 'string' || !sub.startsWith('client:')) return false;
  const username = sub.slice('client:'.length);
  if (!username || !kv) return true;
  try {
    const raw = await kv.get(revokeKey(username));
    if (!raw) return false;
    const revokedAt = Number(raw);
    if (!Number.isFinite(revokedAt)) return false;
    return !(typeof iat === 'number' && iat > revokedAt);
  } catch {
    return true;
  }
}
