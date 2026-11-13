// Auth config: exact origins, fail-fast env validation, secure-cookie switch.
// Usage: node scripts/test-auth-config.mjs

import { randomBytes } from 'node:crypto';
import {
  AuthConfigError,
  createAuth,
  parseTrustedOrigins,
  resolveAuthConfig,
} from '../functions/_shared/auth.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) {
    console.log(`  ok ${name}`);
  } else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

const secret = 'x'.repeat(48);

function throwsVariable(fn, variable) {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof AuthConfigError && error.variable === variable;
  }
}

check('valid http local config', (() => {
  const cfg = resolveAuthConfig({
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: 'http://localhost:3000',
    TRUSTED_ORIGINS: 'http://localhost:3000',
  });
  return cfg.baseURL === 'http://localhost:3000' && cfg.secureCookies === false;
})());

check('valid https config is secure', (() => {
  const cfg = resolveAuthConfig({
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: 'https://menu.example.com',
    TRUSTED_ORIGINS: 'https://preview.example.com',
  });
  return cfg.secureCookies === true && cfg.trustedOrigins.includes('https://menu.example.com');
})());

check('baseURL is always trusted', (() => {
  const cfg = resolveAuthConfig({
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: 'https://menu.example.com',
  });
  return cfg.trustedOrigins.length === 1 && cfg.trustedOrigins[0] === 'https://menu.example.com';
})());

check('duplicate origins are removed', (() => {
  const origins = parseTrustedOrigins('https://a.example.com, https://a.example.com/, https://b.example.com');
  return origins.length === 2;
})());

check('short secret rejected', throwsVariable(() => resolveAuthConfig({
  BETTER_AUTH_SECRET: 'short',
  BETTER_AUTH_URL: 'https://menu.example.com',
}), 'BETTER_AUTH_SECRET'));

check('missing URL rejected', throwsVariable(() => resolveAuthConfig({
  BETTER_AUTH_SECRET: secret,
}), 'BETTER_AUTH_URL'));

check('URL with path rejected', throwsVariable(() => resolveAuthConfig({
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'https://menu.example.com/app',
}), 'BETTER_AUTH_URL'));

check('URL with query rejected', throwsVariable(() => resolveAuthConfig({
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'https://menu.example.com?x=1',
}), 'BETTER_AUTH_URL'));

check('wildcard origin rejected', throwsVariable(() => resolveAuthConfig({
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'https://menu.example.com',
  TRUSTED_ORIGINS: 'https://*.example.com',
}), 'TRUSTED_ORIGINS'));

check('origin with path rejected', throwsVariable(() => resolveAuthConfig({
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'https://menu.example.com',
  TRUSTED_ORIGINS: 'https://preview.example.com/app',
}), 'TRUSTED_ORIGINS'));

check('plain http production origin rejected', throwsVariable(() => resolveAuthConfig({
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'https://menu.example.com',
  TRUSTED_ORIGINS: 'http://preview.example.com',
}), 'TRUSTED_ORIGINS'));

check('http localhost allowed with https base', (() => {
  const cfg = resolveAuthConfig({
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: 'https://menu.example.com',
    TRUSTED_ORIGINS: 'http://localhost:3000',
  });
  return cfg.trustedOrigins.includes('http://localhost:3000');
})());

check('wildcard in any position rejected', throwsVariable(() => resolveAuthConfig({
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'https://menu.example.com',
  TRUSTED_ORIGINS: 'https://preview.example.com,https://*',
}), 'TRUSTED_ORIGINS'));

check('https build forces secure cookies + chou prefix', (() => {
  const auth = createAuth({
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    BETTER_AUTH_URL: 'https://menu.example.com',
    TRUSTED_ORIGINS: 'https://menu.example.com',
  });
  return auth.options.advanced.useSecureCookies === true
    && auth.options.advanced.cookiePrefix === 'chou'
    && auth.options.advanced.defaultCookieAttributes.sameSite === 'lax'
    && auth.options.advanced.defaultCookieAttributes.httpOnly === true;
})());

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
