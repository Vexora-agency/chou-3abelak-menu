// Invite/access security primitives: format + policy unit tests (no infra).
// Usage: node scripts/test-access.mjs
import {
  INVITE_MAX_ATTEMPTS,
  INVITE_TTL_SEC,
  REVOKE_TTL_SEC,
  clearRevocation,
  inviteLinkFor,
  inviteUsable,
  isInviteUsername,
  isPasswordOk,
  isRateLimited,
  isSessionRevoked,
  isTokenFormat,
  newInviteToken,
  normalizeUsername,
  noteRateLimitHit,
  revokeSessions,
  sha256Hex,
  siteBaseUrl,
} from '../functions/_shared/access.js';
import { createSessionToken } from '../functions/_shared/session.js';
import { onRequest as revokeReq } from '../functions/api/admin/sessions/revoke.js';

let fails = 0;
const check = (name, cond) => {
  if (!cond) {
    fails++;
    console.error(`  FAIL ${name}`);
  } else {
    console.log(`  ok ${name}`);
  }
};

// Tokens: shape, entropy source size, uniqueness.
const seen = new Set();
for (let i = 0; i < 2000; i++) {
  const t = newInviteToken();
  if (!isTokenFormat(t) || seen.has(t)) {
    check(`token #${i} (shape+unique)`, false);
    break;
  }
  seen.add(t);
}
check('2000 unique 43-char tokens', seen.size === 2000);
check('rejects short', !isTokenFormat('abc'));
check('rejects 44 chars', !isTokenFormat(`${[...seen][0]}x`));
check('rejects non-string', !isTokenFormat({ $gt: '' }));
check('rejects spaces', !isTokenFormat(`${[...seen][0].slice(0, 42)} `));

// Hashing: stable, 64-hex, does not contain the token.
{
  const h1 = await sha256Hex('hello');
  const h2 = await sha256Hex('hello');
  check('sha256 vector', h1 === '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  check('sha256 stable', h1 === h2);
  check('sha256 64-hex', /^[0-9a-f]{64}$/.test(h1));
}

// Usernames.
check('username ok', isInviteUsername('layali'));
check('username min 2', isInviteUsername('ab') && !isInviteUsername('a'));
check('username rejects uppercase', !isInviteUsername('Layali'));
check('username rejects spaces/dots', !isInviteUsername('a b') && !isInviteUsername('a.b'));
check('normalize lowercases+trims', normalizeUsername('  Layali-1 ') === 'layali-1');

// Passwords: 12..128, no composition rules.
check('password 12 ok', isPasswordOk('abcdefgh1234'));
check('password 11 weak', !isPasswordOk('abcdefgh123'));
check('password 128 ok', isPasswordOk('x'.repeat(128)));
check('password 129 weak', !isPasswordOk('x'.repeat(129)));

// Link building: configured origin only, never Host-derived.
check('site https', siteBaseUrl({ SITE_URL: 'https://shop.example.com/' }) === 'https://shop.example.com');
check('site loopback http', siteBaseUrl({ SITE_URL: 'http://127.0.0.1:8788' }) === 'http://127.0.0.1:8788');
check('site rejects lan http', siteBaseUrl({ SITE_URL: 'http://192.168.1.5/' }) === null);
check('site rejects empty', siteBaseUrl({}) === null);
check(
  'link shape',
  inviteLinkFor({ SITE_URL: 'https://shop.example.com' }, 't'.repeat(43)) ===
    `https://shop.example.com/invite/${'t'.repeat(43)}`
);
check('link null without site', inviteLinkFor({}, 't'.repeat(43)) === null);

// Usability gate.
{
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 3600e3).toISOString();
  const past = new Date(Date.now() - 3600e3).toISOString();
  check('usable pending', inviteUsable({ usedAt: null, expiresAt: future }, now));
  check('used rejected', !inviteUsable({ usedAt: now, expiresAt: future }, now));
  check('expired rejected', !inviteUsable({ usedAt: null, expiresAt: past }, now));
  check('missing rejected', !inviteUsable(null, now));
}

check('TTL is 72h', INVITE_TTL_SEC === 72 * 3600);
check('attempt cap sane', INVITE_MAX_ATTEMPTS >= 10 && INVITE_MAX_ATTEMPTS <= 50);

// Revocation: fake KV store, no infra.
{
  const store = new Map();
  const kv = {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  };
  const now = Math.floor(Date.now() / 1000);
  check('owner passes with no stamp', (await isSessionRevoked(kv, 'admin', now - 100)) === false);
  check('other subs pass', (await isSessionRevoked(kv, 'x', now)) === false);
  check('fresh client passes', (await isSessionRevoked(kv, 'client:layali', now)) === false);
  check('empty sub passes', (await isSessionRevoked(kv, '', now)) === false);
  await revokeSessions(kv, 'layali');
  check('old session dies', (await isSessionRevoked(kv, 'client:layali', now - 5)) === true);
  check('boundary dies', (await isSessionRevoked(kv, 'client:layali', now)) === true);
  check('newer account lives', (await isSessionRevoked(kv, 'client:layali', now + 3600)) === false);
  check('other users unaffected', (await isSessionRevoked(kv, 'client:other', now - 5)) === false);
  await clearRevocation(kv, 'layali');
  check('enable clears', (await isSessionRevoked(kv, 'client:layali', now - 5)) === false);
  check('no store fails closed', (await isSessionRevoked(null, 'client:layali', now)) === true);
  // Owner kill switch: stamping `admin` kills master sessions too (F1 fix —
  // this line asserted the old never-revoked policy and must stay flipped).
  await revokeSessions(kv, 'admin');
  check('owner old session dies', (await isSessionRevoked(kv, 'admin', now - 5)) === true);
  check('owner boundary dies', (await isSessionRevoked(kv, 'admin', now)) === true);
  check('owner newer session lives', (await isSessionRevoked(kv, 'admin', now + 3600)) === false);
  check('owner stamp spares clients', (await isSessionRevoked(kv, 'client:layali', now - 5)) === false);
  check('owner no store fails closed', (await isSessionRevoked(null, 'admin', now)) === true);
  await clearRevocation(kv, 'admin');
  check('owner enable clears', (await isSessionRevoked(kv, 'admin', now - 5)) === false);
  check('revoke TTL covers longest session', REVOKE_TTL_SEC >= 30 * 24 * 3600);
}

// POST /api/admin/sessions/revoke: owner-only kill switch (route-level).
{
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (let i = 0; i < secretBytes.length; i++) s += String.fromCharCode(secretBytes[i]);
  const b64 = btoa(s);
  const store = new Map();
  const kv = {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  };
  const env = { SESSION_SECRET: b64, MENU_KV: kv };
  const call = (method, cookie) =>
    revokeReq({
      request: new Request('https://x/api/admin/sessions/revoke', {
        method,
        headers: {
          'X-Requested-With': 'menu-admin',
          Origin: 'https://x',
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: method === 'POST' ? '{}' : undefined,
      }),
      env,
    });
  const ownerTok = await createSessionToken(secretBytes, 'admin', 3600);
  const clientTok = await createSessionToken(secretBytes, 'client:layali', 3600);
  const ownerCookie = `__Host-admin-session=${ownerTok}`;
  const clientCookie = `__Host-admin-session=${clientTok}`;

  check('revoke rejects GET', (await call('GET')).status === 405);
  check('revoke rejects anonymous', (await call('POST')).status === 403);
  check('revoke rejects client login', (await call('POST', clientCookie)).status === 403);
  const r = await call('POST', ownerCookie);
  check('owner revokes ok', r.status === 200 && (await r.json().catch(() => ({}))).ok === true);
  check('caller session dies at once', (await isSessionRevoked(kv, 'admin', Math.floor(Date.now() / 1000) - 5)) === true);
  check('revoked caller gets 403', (await call('POST', ownerCookie)).status === 403);
}

// Fail-only limiter (powers GET /api/track): reads are free, only failed
// attempts cost a KV write. Fake KV with op counters, no infra.
{
  const mkKv = () => {
    const store = new Map();
    return {
      reads: 0,
      writes: 0,
      get: async function (k) { this.reads += 1; return store.has(k) ? store.get(k) : null; },
      put: async function (k, v) { this.writes += 1; store.set(k, v); },
    };
  };
  const kv = mkKv();
  check('fresh key not limited', (await isRateLimited(kv, 'track:1.2.3.4', 3)) === false);
  check('probe costs one read, zero writes', kv.reads === 1 && kv.writes === 0);
  // Successes never write, no matter how many.
  for (let i = 0; i < 10; i++) await isRateLimited(kv, 'track:1.2.3.4', 3);
  check('ten success probes still zero writes', kv.writes === 0);
  // Failures count; the 3rd trips the limit.
  await noteRateLimitHit(kv, 'track:1.2.3.4', 3, 300);
  await noteRateLimitHit(kv, 'track:1.2.3.4', 3, 300);
  check('two failures not limited yet', (await isRateLimited(kv, 'track:1.2.3.4', 3)) === false);
  await noteRateLimitHit(kv, 'track:1.2.3.4', 3, 300);
  check('third failure trips the limit', (await isRateLimited(kv, 'track:1.2.3.4', 3)) === true);
  check('only failures wrote', kv.writes === 3);
  // Null KV fails open both ways.
  check('no store never limits', (await isRateLimited(null, 'x', 1)) === false);
  check('no store hit is a silent no-op', (await noteRateLimitHit(null, 'x', 1, 60)).ok === true);
}

if (fails) {
  console.error(`test-access: ${fails} FAILURES`);
  process.exit(1);
}
console.log('test-access: all green');
