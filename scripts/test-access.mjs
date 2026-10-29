// Invite/access security primitives: format + policy unit tests (no infra).
// Usage: node scripts/test-access.mjs
import {
  INVITE_MAX_ATTEMPTS,
  INVITE_TTL_SEC,
  inviteLinkFor,
  inviteUsable,
  isInviteUsername,
  isPasswordOk,
  isTokenFormat,
  newInviteToken,
  normalizeUsername,
  sha256Hex,
  siteBaseUrl,
} from '../functions/_shared/access.js';

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

if (fails) {
  console.error(`test-access: ${fails} FAILURES`);
  process.exit(1);
}
console.log('test-access: all green');
