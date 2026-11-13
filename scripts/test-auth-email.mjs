// Transactional auth emails: bilingual templates, Resend payload, safe logs.
// Usage: node scripts/test-auth-email.mjs

import { randomBytes } from 'node:crypto';
import { buildAuthEmail, queueAuthEmail, sendAuthEmail } from '../functions/_shared/auth-email.js';
import { createAuth } from '../functions/_shared/auth.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

const resetUrl = 'https://chou3abelak.site/api/auth/reset-password/abc?token=secret-token';
const reset = buildAuthEmail({ kind: 'reset', url: resetUrl, name: 'Mina <script>' });
check('reset subject', reset.subject.includes('Reset your password'));
check('reset html contains URL', reset.html.includes('secret-token'));
check('reset html escapes name', reset.html.includes('Mina &lt;script&gt;') && !reset.html.includes('Mina <script>'));
check('reset html is bilingual', reset.html.includes('إعادة تعيين كلمة المرور'));
check('reset text contains both languages', reset.text.includes('Reset your password') && reset.text.includes('إعادة تعيين'));

const verify = buildAuthEmail({ kind: 'verify', url: 'https://chou3abelak.site/api/auth/verify-email?token=v', name: 'Mina' });
check('verify subject', verify.subject.includes('Verify your email'));
check('verify has CTA', verify.html.includes('Verify email'));

const calls = [];
const okFetch = async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200 };
};
const sent = await sendAuthEmail(
  { RESEND_API_KEY: 're_test', MAIL_FROM_DOMAIN_EMAIL: 'orders@example.test', REPLY_TO: 'reply@example.test' },
  { to: 'customer@example.test', ...reset },
  okFetch
);
check('send ok', sent.ok === true);
check('Resend endpoint', calls[0]?.url === 'https://api.resend.com/emails');
check('bearer auth', calls[0]?.init?.headers?.Authorization === 'Bearer re_test');
const payload = JSON.parse(calls[0]?.init?.body);
check('from identity', payload.from === 'Chou 3abelak <orders@example.test>');
check('recipient', Array.isArray(payload.to) && payload.to[0] === 'customer@example.test');
check('reply-to', payload.reply_to === 'reply@example.test');

const missing = await sendAuthEmail({}, { to: 'x@example.test', ...reset }, okFetch);
check('missing config skips send', missing.ok === false && missing.reason === 'not_configured');

const failed = await sendAuthEmail(
  { RESEND_API_KEY: 're_test', MAIL_FROM_DOMAIN_EMAIL: 'orders@example.test' },
  { to: 'x@example.test', ...reset },
  async () => ({ ok: false, status: 422 })
);
check('provider failure reported', failed.ok === false && failed.status === 422);

let queuedPromise = null;
queueAuthEmail(
  { RESEND_API_KEY: 're_test', MAIL_FROM_DOMAIN_EMAIL: 'orders@example.test' },
  { to: 'x@example.test', ...reset },
  (p) => { queuedPromise = p; },
  okFetch
);
check('waitUntil receives a promise', queuedPromise instanceof Promise);
check('queued send resolves', (await queuedPromise).ok === true);

const auth = createAuth({
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  BETTER_AUTH_URL: 'https://chou3abelak.site',
  TRUSTED_ORIGINS: 'https://chou3abelak.site',
  RESEND_API_KEY: 're_test',
  MAIL_FROM_DOMAIN_EMAIL: 'orders@example.test',
});
check('verification required by default', auth.options.emailAndPassword.requireEmailVerification === true);
check('verification email on signup', auth.options.emailVerification.sendOnSignUp === true);
check('auto sign-in after verification', auth.options.emailVerification.autoSignInAfterVerification === true);
check('reset token one hour', auth.options.emailAndPassword.resetPasswordTokenExpiresIn === 3600);
check('reset revokes sessions', auth.options.emailAndPassword.revokeSessionsOnPasswordReset === true);
check('reset sender wired', typeof auth.options.emailAndPassword.sendResetPassword === 'function');
check('verify sender wired', typeof auth.options.emailVerification.sendVerificationEmail === 'function');

const localAuth = createAuth({
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  BETTER_AUTH_URL: 'http://localhost:3000',
  TRUSTED_ORIGINS: 'http://localhost:3000',
  AUTH_REQUIRE_EMAIL_VERIFICATION: '0',
});
check('local verification override', localAuth.options.emailAndPassword.requireEmailVerification === false);

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
