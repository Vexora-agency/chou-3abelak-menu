/**
 * Reverse WhatsApp phone verification — runnable assertions.
 * Run: node scripts/test-phone-verification.mjs
 *
 * Proves the pure crypto/message contract and the server/client wiring that
 * matters for safety:
 *  - codes are 6 digits, hashed with a key, never stored in plaintext;
 *  - references are short, stable and unique per row;
 *  - approvals last 365 days; pending/rejected/expired never count;
 *  - the order route refuses EVERY unverified number (first number included);
 *  - the profile route refuses an unverified NEW number;
 *  - the customer route is session + CSRF gated and rate-limited;
 *  - the owner can approve/reject without ever seeing the code.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_VALIDITY_MS,
  buildVerificationMessage,
  buildVerificationWhatsAppUrl,
  codeExpiresAt,
  generateVerificationCode,
  getVerificationSecret,
  hashVerificationCode,
  isApprovedVerification,
  isVerificationCodeFormat,
  normalizeVerificationPhone,
  verificationCodeMatches,
  verificationReference,
  verificationValidUntil,
} from '../functions/_shared/phone-verification.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

const secret = new TextEncoder().encode('test-secret-with-enough-entropy');
const phone = '96170123456';

/* ---------- code + hash ---------- */

const code = generateVerificationCode();
check('code is exactly 6 digits', isVerificationCodeFormat(code) && code.length === 6);
check('code rejects non-six-digit shapes', !isVerificationCodeFormat('12345') && !isVerificationCodeFormat('12a456'));
check('100 generated codes all have the right shape', Array.from({ length: 100 }, generateVerificationCode).every(isVerificationCodeFormat));
check('codes are not a constant', new Set(Array.from({ length: 50 }, generateVerificationCode)).size > 1);

const ref = await verificationReference('11111111-2222-3333-4444-555555555555');
check('reference is 8 uppercase hex chars', /^[0-9A-F]{8}$/.test(ref));
check('reference is stable for the same row', ref === await verificationReference('11111111-2222-3333-4444-555555555555'));
check('reference differs for another row', ref !== await verificationReference('99999999-2222-3333-4444-555555555555'));

const hash1 = await hashVerificationCode(secret, { id: 'v1', phone, code });
check('hash is hex sha-256', /^[0-9a-f]{64}$/.test(hash1));
check('hash is deterministic', hash1 === await hashVerificationCode(secret, { id: 'v1', phone, code }));
check('hash changes with the code', hash1 !== await hashVerificationCode(secret, { id: 'v1', phone, code: code === '000000' ? '111111' : '000000' }));
check('hash changes with the number', hash1 !== await hashVerificationCode(secret, { id: 'v1', phone: '96170999999', code }));
check('hash changes with the row id', hash1 !== await hashVerificationCode(secret, { id: 'v2', phone, code }));
let threw = false;
try {
  await hashVerificationCode(new Uint8Array(0), { id: 'v1', phone, code });
} catch {
  threw = true;
}
check('hash refuses an empty secret', threw);
check('match helper accepts the right code', await verificationCodeMatches(secret, { id: 'v1', phone, code_hash: hash1 }, code));
check('match helper rejects another code', !(await verificationCodeMatches(secret, { id: 'v1', phone, code_hash: hash1 }, code === '000000' ? '111111' : '000000')));

/* ---------- validity windows ---------- */

const now = Date.now();
const approved = { status: 'approved', decided_at: new Date(now - 1000).toISOString() };
check('fresh approval is valid', isApprovedVerification(approved, now));
check('approval expires after 365 days', !isApprovedVerification(approved, now + VERIFICATION_VALIDITY_MS + 1000));
check('pending is never valid', !isApprovedVerification({ status: 'pending', decided_at: approved.decided_at }, now));
check('rejected is never valid', !isApprovedVerification({ status: 'rejected', decided_at: approved.decided_at }, now));
check('missing approval date is invalid', !isApprovedVerification({ status: 'approved' }, now));
const until = verificationValidUntil(approved);
check(
  'valid-until is approved_at + 365 days',
  typeof until === 'string' &&
    Math.abs(Date.parse(until) - (Date.parse(approved.decided_at) + VERIFICATION_VALIDITY_MS)) < 5
);

/* ---------- phone + message + link ---------- */

check('phone normalizes Arabic digits', normalizeVerificationPhone('٩٦١ ٧٠ ١٢٣ ٤٥٦') === '96170123456');
check('phone rejects a short number', normalizeVerificationPhone('12345') === null);
check('phone rejects a 16-digit number', normalizeVerificationPhone('1234567890123456') === null);
check('non-string phone normalizes to null', normalizeVerificationPhone(null) === null);

const messageEn = buildVerificationMessage({ code: '123456', reference: 'ABC123', lang: 'en' });
check('English message carries code + reference', messageEn.includes('123456') && messageEn.includes('ABC123'));
const messageAr = buildVerificationMessage({ code: '123456', reference: 'ABC123', lang: 'ar' });
check('Arabic message carries code + reference', messageAr.includes('123456') && messageAr.includes('ABC123'));

const url = buildVerificationWhatsAppUrl('+961 70 123 456', 'Code: 123456\nRef: ABC123');
check('whatsapp url uses digits only', url.startsWith('https://wa.me/96170123456?text='));
check('whatsapp url encodes the message', url === `https://wa.me/96170123456?text=${encodeURIComponent('Code: 123456\nRef: ABC123')}`);
check('whatsapp url is null without a store number', buildVerificationWhatsAppUrl('', 'x') === null);
check('code TTL is five minutes', VERIFICATION_CODE_TTL_MS === 5 * 60 * 1000);
check(
  'code expiry is created_at + 5 minutes',
  Date.parse(codeExpiresAt(0)) === VERIFICATION_CODE_TTL_MS
);

/* ---------- secret selection ---------- */

const base64Secret = Buffer.from('a'.repeat(32)).toString('base64');
const fromSession = getVerificationSecret({ SESSION_SECRET: base64Secret });
check('falls back to the session secret', fromSession instanceof Uint8Array && fromSession.length >= 32);
const dedicated = getVerificationSecret({ PHONE_VERIFICATION_SECRET: 'dedicated-secret', SESSION_SECRET: base64Secret });
check(
  'dedicated secret wins',
  dedicated instanceof Uint8Array && new TextDecoder().decode(dedicated) === 'dedicated-secret'
);
check('no secret means no verification', getVerificationSecret({}) === null);

/* ---------- migration ---------- */

const migration = read('migrations/0037_phone_verifications.sql');
check('migration creates the table', migration.includes('CREATE TABLE IF NOT EXISTS phone_verifications'));
check('migration stores only a code hash', migration.includes('code_hash TEXT NOT NULL') && !migration.includes('code_plain') && !/\bcode\s+TEXT\b/.test(migration));
check('migration has a unique live row per member+number', migration.includes('idx_phone_verifications_live') && migration.includes("WHERE status = 'pending'"));
check('migration enforces one row per reference', migration.includes('reference TEXT NOT NULL UNIQUE'));
check('migration cascades with the account', migration.includes('ON DELETE CASCADE'));

/* ---------- customer route ---------- */

const customerRoute = read('functions/api/account/phone-verification.js');
check('customer route is session gated', customerRoute.includes('requireCustomer(request, env)'));
check('customer route is CSRF gated', customerRoute.includes('checkCustomerApiHeaders(request)'));
check('customer route hashes the code', customerRoute.includes('hashVerificationCode(secret'));
check('customer route returns the plaintext code once', customerRoute.includes('code,') && customerRoute.includes('verification: {'));
check('customer route enforces a cooldown', customerRoute.includes('VERIFICATION_COOLDOWN_SEC'));
check('customer route enforces hourly + daily caps', customerRoute.includes('VERIFICATION_HOURLY_MAX') && customerRoute.includes('VERIFICATION_DAILY_MAX'));
check('customer route rescinds an old pending code on resend', customerRoute.includes('expireVerificationById'));
check('customer route has no Telegram notification', !/telegram/i.test(customerRoute));
check('customer route never reads a code from the client', !customerRoute.includes('body.code') && !customerRoute.includes('body && body.code'));

/* ---------- admin route ---------- */

const adminRoute = read('functions/api/admin/phone-verifications.js');
check('admin route is CSRF gated', adminRoute.includes('checkApiHeaders(request)'));
check('admin route approves and rejects', adminRoute.includes("action !== 'approve'") && adminRoute.includes("action !== 'reject'") && adminRoute.includes("'rejected'"));
check('admin route is single-use', adminRoute.includes('decideVerification') && adminRoute.includes("status: action === 'approve' ? 'approved' : 'rejected'"));
check('admin route never returns the code hash', !adminRoute.includes('code_hash') && !adminRoute.includes('codeHash'));
check('admin list is live-pending only by default', adminRoute.includes("=== 'all' ? 'all' : 'pending'"));

/* ---------- order + profile gates ---------- */

const orderRoute = read('functions/api/orders.js');
check('order route requires verification of the used number', orderRoute.includes('findValidVerification(db, customerUserId, c.phoneNorm'));
check('order route returns phone_verification_required', orderRoute.includes("error: 'phone_verification_required'"));
check('order route no longer overwrites the entered phone with the saved one', !orderRoute.includes('c.phoneNorm = profilePhone'));
check('order route still takes name/email from the account', orderRoute.includes('c.name = profileName') && orderRoute.includes('c.email = accountEmail'));

const profileRoute = read('functions/api/account/profile.js');
check('profile route requires verification for a changed phone', profileRoute.includes("error: 'phone_verification_required'") && profileRoute.includes('nextPhone !== currentPhone'));
check('profile route exposes the verified state', profileRoute.includes('phoneVerified:') && profileRoute.includes('phoneVerifiedUntil:'));
check('profile route still allows an unchanged phone to save the address', profileRoute.includes('An unchanged number keeps its existing state'));

/* ---------- customers repo ---------- */

const customersRepo = read('functions/_shared/repositories/customers.repo.js');
check('profile reads carry phoneVerified', customersRepo.includes('phoneVerified,') && customersRepo.includes('phone_verified_at'));
check('admin customer list carries phoneVerified', customersRepo.includes('AS phoneVerified'));

/* ---------- client sheet + hook ---------- */

const sheet = read('src/features/auth/components/PhoneVerificationSheet.tsx');
check('sheet shows the 6-digit code in a large field', sheet.includes('text-[2.35rem]') && sheet.includes('tracking-[0.28em]'));
check('sheet has a copy action', sheet.includes('copyText(code)') && sheet.includes('navigator.clipboard'));
check('sheet has a live countdown', sheet.includes('useNow(') && sheet.includes('formatMMSS(leftMs)'));
check('sheet opens WhatsApp with the pre-filled message', sheet.includes('buildPhoneVerificationWhatsAppUrl') && sheet.includes('wa.me') === false);
check('sheet auto-requests once per open+number', sheet.includes('autoRef.current === phone'));
check('sheet shows waiting + success states', sheet.includes('t.waiting') && sheet.includes('t.verifiedTitle'));

const hook = read('src/features/auth/hooks/usePhoneVerification.ts');
check('hook polls while pending', hook.includes('POLL_MS') && hook.includes("phase !== 'pending'"));
check('hook caches the one-time code per member', hook.includes('CACHE_PREFIX') && hook.includes('window.localStorage'));
check('hook dispatches the verified event', hook.includes('PHONE_VERIFIED_EVENT'));

const cartDrawer = read('src/features/cart/components/CartDrawer.tsx');
check('cart watches the entered number', cartDrawer.includes('usePhoneVerification(') && cartDrawer.includes('verificationPhone'));
check('cart passes the verified gate to checkout', cartDrawer.includes('isPhoneVerified: () => phoneVerifiedRef.current'));
check('cart opens the sheet on demand', cartDrawer.includes('onRequirePhoneVerification') && cartDrawer.includes('<PhoneVerificationSheet'));

const accountSheet = read('src/features/auth/components/AccountSheet.tsx');
check('settings verification sheet resumes the save', accountSheet.includes('verifiedPhoneRef.current = verifyPhone') && accountSheet.includes('void save();'));

const adminPanel = read('src/features/admin/components/admin/AdminPhoneVerifications.tsx');
check('admin panel approves and rejects', adminPanel.includes("decide(row.id, 'approve')") && adminPanel.includes("decide(row.id, 'reject')"));
check('admin panel shows the reference, not the code', adminPanel.includes('{t.refLabel} {row.reference}') && !adminPanel.includes('row.code'));

if (fails) {
  console.error(`\nFAIL — ${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nPASS — phone verification contract holds');
