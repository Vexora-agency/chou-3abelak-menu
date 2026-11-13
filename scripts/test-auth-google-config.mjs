// Google OAuth capability: hidden unless BOTH credentials are present.
// Usage: node scripts/test-auth-google-config.mjs

import { randomBytes } from 'node:crypto';
import { createAuth, isGoogleConfigured } from '../functions/_shared/auth.js';
import { onRequest as publicConfig } from '../functions/api/auth/public-config.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

check('missing both = off', isGoogleConfigured({}) === false);
check('id only = off', isGoogleConfigured({ GOOGLE_CLIENT_ID: 'id' }) === false);
check('secret only = off', isGoogleConfigured({ GOOGLE_CLIENT_SECRET: 'secret' }) === false);
check('blank values = off', isGoogleConfigured({ GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: ' ' }) === false);
check('both present = on', isGoogleConfigured({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }) === true);

const auth = createAuth({
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  BETTER_AUTH_URL: 'https://chou3abelak.site',
  TRUSTED_ORIGINS: 'https://chou3abelak.site',
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
});
const google = auth.options.socialProviders?.google;
check('provider carries client id', google?.clientId === 'client-id.apps.googleusercontent.com');
check('provider carries secret', google?.clientSecret === 'client-secret');
check('uses provider default minimal scopes', !google?.scope || google.scope.join(' ') === 'openid email profile');
check('account picker prompt', google?.prompt === 'select_account');

const noGoogle = createAuth({
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  BETTER_AUTH_URL: 'https://chou3abelak.site',
  TRUSTED_ORIGINS: 'https://chou3abelak.site',
});
check('no provider without credentials', !noGoogle.options.socialProviders?.google);

const request = new Request('https://chou3abelak.site/api/auth/public-config');
const offRes = await publicConfig({ request, env: {} });
const offBody = await offRes.json();
check('public config off', offBody.google === false);
check('public config defaults verification on', offBody.requireEmailVerification === true);
const onRes = await publicConfig({
  request,
  env: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', AUTH_REQUIRE_EMAIL_VERIFICATION: '0' },
});
const onBody = await onRes.json();
check('public config on', onBody.google === true);
check('public config local verification override', onBody.requireEmailVerification === false);

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
