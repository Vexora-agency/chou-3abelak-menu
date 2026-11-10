/**
 * Admin API Authentication Middleware
 * Runs for all /api/admin/* requests.
 *
 * Two accepted mechanisms (in order):
 *  1. Cookie session from the /api/auth/login screen (HMAC-signed token).
 *  2. Cloudflare Access JWT assertion (existing behavior).
 * Fails closed with 403 when neither mechanism is configured or valid.
 */

import { getSessionCookie, getSessionSecret, jsonNoStore, verifySessionToken } from '../../_shared/session.js';
import { isSessionRevoked } from '../../_shared/access.js';
import { getRequestRole, isKitchenAllowed } from '../../_shared/kitchen-gate.js';

let cachedJwks = null;
let jwksCachedAt = 0;

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Local development bypass
  if (env.ALLOW_LOCAL_DEV === '1' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    const res = await next();
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  // 1) Cookie session from the login screen (preferred when configured)
  const sessionSecret = getSessionSecret(env);
  if (sessionSecret) {
    const token = getSessionCookie(request);
    if (token) {
      try {
        const payload = await verifySessionToken(sessionSecret, token);
        if (payload) {
          // Disabled/deleted client accounts die here even mid-session
          // (owner sessions are never revoked — see isSessionRevoked).
          if (await isSessionRevoked(env.MENU_KV || null, payload.sub, payload.iat)) {
            return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);
          }
          // Kitchen gate (central policy, see _shared/kitchen-gate.js): the
          // kitchen role may only read the order feed and update order
          // status. Owner/admin and client traffic passes through exactly
          // as before — this branch never changes their behavior.
          try {
            const role = await getRequestRole(request, env, payload);
            if (role === 'kitchen' && !isKitchenAllowed(url.pathname, request.method)) {
              return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);
            }
          } catch {
            // Role resolution never fails closed here: an unresolvable role
            // falls back to the pre-existing session behavior below.
          }
          const res = await next();
          res.headers.set('Cache-Control', 'no-store');
          return res;
        }
      } catch {}
      // Invalid/expired token: fall through to Access check, then 403.
    }
  }

  // Check required environment configuration
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const expectedAud = env.ACCESS_AUD;

  if (!teamDomain || !expectedAud) {
    return jsonNoStore({ error: 'forbidden', message: 'Access credentials unconfigured' }, 403);
  }

  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) {
    return jsonNoStore({ error: 'forbidden', message: 'Missing Access assertion' }, 403);
  }

  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');

    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));

    if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported algorithm');

    // Fetch and cache JWKS for 1 hour
    const now = Date.now();
    if (!cachedJwks || now - jwksCachedAt > 3600 * 1000) {
      const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
      const jwksRes = await fetch(certsUrl);
      if (!jwksRes.ok) throw new Error('JWKS fetch failed');
      const jwksData = await jwksRes.json();
      cachedJwks = jwksData.keys || [];
      jwksCachedAt = now;
    }

    const keyData = cachedJwks.find((k) => k.kid === header.kid);
    if (!keyData) throw new Error('Signing key not found');

    // Import public key into WebCrypto
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Verify signature
    const signatureBytes = base64UrlDecode(parts[2]);
    const dataBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const validSig = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signatureBytes, dataBytes);
    if (!validSig) throw new Error('Signature verification failed');

    // Verify audience and issuer
    const expectedIss = `https://${teamDomain}`;
    if (payload.iss !== expectedIss) throw new Error('Invalid issuer');

    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(expectedAud)) throw new Error('Audience mismatch');

    // Verify timestamps
    const curTime = Math.floor(now / 1000);
    if (payload.exp && curTime > payload.exp) throw new Error('Token expired');
    if (payload.nbf && curTime < payload.nbf) throw new Error('Token not yet valid');

    // Authentication passed
    // Kitchen gate for Access-asserted identities too (today these carry no
    // kitchen marker, so this resolves to null and passes through unchanged;
    // it only activates if the shared role system ever maps an Access
    // identity to the kitchen role).
    try {
      const role = await getRequestRole(request, env, null);
      if (role === 'kitchen' && !isKitchenAllowed(url.pathname, request.method)) {
        return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);
      }
    } catch {}
    const res = await next();
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch {
    return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);
  }
}
