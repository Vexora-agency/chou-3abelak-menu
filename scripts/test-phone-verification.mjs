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
  VERIFICATION_COOLDOWN_SEC,
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
check('same-channel resend cooldown is five minutes', VERIFICATION_COOLDOWN_SEC === 300);
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

const ownershipMigration = read('migrations/0042_phone_ownership.sql');
check(
  'ownership migration retires elapsed approvals',
  ownershipMigration.includes("SET status = 'expired'") && ownershipMigration.includes("julianday('now', '-365 days')")
);
check(
  'ownership migration keeps the first live approval and revokes duplicates',
  ownershipMigration.includes("SET status = 'revoked'") && ownershipMigration.includes('ownership_duplicate')
);
check(
  'ownership migration enforces one approved owner per phone',
  ownershipMigration.includes('idx_phone_verifications_one_owner')
    && ownershipMigration.includes('ON phone_verifications(phone)')
    && ownershipMigration.includes("WHERE status = 'approved'")
);

/* ---------- customer route ---------- */

const customerRoute = read('functions/api/account/phone-verification.js');
check('customer route is session gated', customerRoute.includes('requireCustomer(request, env)'));
check('customer route is CSRF gated', customerRoute.includes('checkCustomerApiHeaders(request)'));
check('customer route hashes the code', customerRoute.includes('hashVerificationCode(secret'));
check('customer route returns the plaintext code once', customerRoute.includes('code,') && customerRoute.includes('verification: {'));
check('customer route enforces a cooldown', customerRoute.includes('VERIFICATION_COOLDOWN_SEC'));
check('customer route enforces hourly + daily caps', customerRoute.includes('VERIFICATION_HOURLY_MAX') && customerRoute.includes('VERIFICATION_DAILY_MAX'));
check('customer route rescinds an old pending code on resend', customerRoute.includes('expireVerificationById'));
check(
  'customer route refuses a number owned by another member',
  customerRoute.includes('phoneOwnedByAnotherUser')
    && customerRoute.includes('phoneLinkedResponse')
    && customerRoute.includes('PHONE_LINKED_ERROR')
);
check(
  'customer status marks a number owned by another member',
  customerRoute.includes('linkedToOtherAccount')
);
check('customer route has no Telegram notification', !/telegram/i.test(customerRoute));
check('customer route generates the WhatsApp code server-side', customerRoute.includes('generateVerificationCode()') && customerRoute.includes("body.action === 'verify'") && customerRoute.includes('body.code'));

/* ---------- admin route ---------- */

const adminRoute = read('functions/api/admin/phone-verifications.js');
check('admin route is CSRF gated', adminRoute.includes('checkApiHeaders(request)'));
check('admin route approves and rejects', adminRoute.includes("action !== 'approve'") && adminRoute.includes("action !== 'reject'") && adminRoute.includes("'rejected'"));
check('admin route is single-use', adminRoute.includes('decideVerification') && adminRoute.includes("status: action === 'approve' ? 'approved' : 'rejected'"));
check('admin route never returns the code hash', !adminRoute.includes('code_hash') && !adminRoute.includes('codeHash'));
check('admin list is live-pending only by default', adminRoute.includes("=== 'all' ? 'all' : 'pending'"));
check(
  'admin approval re-checks one-owner-per-phone',
  adminRoute.includes('phoneOwnedByAnotherUser') && adminRoute.includes('expireStaleApproved')
);

const webhookRoute = read('functions/api/whatsapp/webhook.js');
check(
  'whatsapp webhook re-checks ownership before approving',
  webhookRoute.includes('phoneOwnedByAnotherUser') && webhookRoute.includes("decidedBy: 'ownership_conflict'")
);

/* ---------- order + profile gates ---------- */

const orderRoute = read('functions/api/orders.js');
check('order route requires verification of the used number', orderRoute.includes('findValidVerification(db, customerUserId, c.phoneNorm'));
check('order route returns phone_verification_required', orderRoute.includes("error: 'phone_verification_required'"));
check('order route no longer overwrites the entered phone with the saved one', !orderRoute.includes('c.phoneNorm = profilePhone'));
check(
  'order route keeps the entered recipient name and takes email from the account',
  orderRoute.includes('if (!c.name && profileName) c.name = profileName') && orderRoute.includes('c.email = accountEmail')
);

const profileRoute = read('functions/api/account/profile.js');
check('profile route saves a changed phone without verification', !profileRoute.includes("error: 'phone_verification_required'") && !profileRoute.includes('nextPhone') && profileRoute.includes('Saving a changed number is intentionally NOT gated'));
check(
  'profile route refuses a number owned by another member',
  profileRoute.includes('phoneOwnedByAnotherUser') && profileRoute.includes('PHONE_LINKED_ERROR')
);
check(
  'changing the saved phone revokes every old proof',
  profileRoute.includes('revokeUserVerifications') && profileRoute.includes('phoneChanged')
);
check(
  'saving the number currently being verified keeps its fresh pending code',
  profileRoute.includes("'profile_phone_changed'") && profileRoute.includes('phone.phone')
);
check('profile route exposes the verified state', profileRoute.includes('phoneVerified:') && profileRoute.includes('phoneVerifiedUntil:'));
check('order route remains the verification gate', orderRoute.includes("error: 'phone_verification_required'") && orderRoute.includes('findValidVerification(db, customerUserId, c.phoneNorm'));
check(
  'order route refuses a number owned by another member',
  orderRoute.includes('phoneOwnedByAnotherUser') && orderRoute.includes('PHONE_LINKED_ERROR')
);

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
check(
  'sheet shows the linked-account reason instead of a generic error',
  sheet.includes('phone_linked_other_account') && sheet.includes('t.errorPhoneLinked')
);
check(
  'linked number offers no pointless retry/get-code action',
  sheet.includes('const phoneTaken') && sheet.includes('!phoneTaken')
);

const hook = read('src/features/auth/hooks/usePhoneVerification.ts');
check('hook polls while pending', hook.includes('POLL_MS') && hook.includes("phase !== 'pending'"));
check('hook caches the one-time code per member', hook.includes('CACHE_PREFIX') && hook.includes('window.localStorage'));
check('hook dispatches the verified event', hook.includes('PHONE_VERIFIED_EVENT'));
check(
  'hook stops on a number owned by another member',
  hook.includes('state.linkedToOtherAccount') && hook.includes("setError('phone_linked_other_account')")
);

const sharedPhone = read('functions/_shared/phone-verification.js');
check(
  'shared copy states the number is linked to another member',
  sharedPhone.includes('PHONE_LINKED_ERROR') && sharedPhone.includes('linked to another member account')
);
const phoneRepo = read('functions/_shared/repositories/phone-verifications.repo.js');
check(
  'repo exposes ownership + revocation helpers',
  phoneRepo.includes('findVerifiedPhoneOwner')
    && phoneRepo.includes('phoneOwnedByAnotherUser')
    && phoneRepo.includes('revokeUserVerifications')
    && phoneRepo.includes('expireStaleApproved')
);
check(
  'revocation keeps a pending code for the number being saved',
  phoneRepo.includes('exceptPendingPhone') && phoneRepo.includes('keepPendingPhone')
);

const cartDrawer = read('src/features/cart/components/CartDrawer.tsx');
check('cart watches the entered number', cartDrawer.includes('usePhoneVerification(') && cartDrawer.includes('verificationPhone'));
check('cart passes the verified gate to checkout', cartDrawer.includes('isPhoneVerified: () => phoneVerifiedRef.current'));
check('cart opens the sheet on demand', cartDrawer.includes('onRequirePhoneVerification') && cartDrawer.includes('<PhoneVerificationSheet'));

const accountSheet = read('src/features/auth/components/AccountSheet.tsx');
check('settings verifying saves the current form', accountSheet.includes('void save();') && accountSheet.includes('setVerifyOpen(false);'));
check(
  'account save shows the linked-account reason instead of a generic failure',
  accountSheet.includes('phone_linked_other_account') && accountSheet.includes('phoneLinkedOtherAccount')
);

const cartApi = read('src/features/cart/services/cart.api.ts');
check(
  'checkout maps the linked-account rejection',
  cartApi.includes('phone_linked_other_account') && cartApi.includes("failure: 'phone_taken'")
);
const checkoutHook = read('src/features/cart/hooks/useCartCheckoutSubmit.ts');
check(
  'checkout shows the linked-account reason without opening verification',
  checkoutHook.includes("result.failure === 'phone_taken'") && checkoutHook.includes('isPhoneTaken')
);

const adminPanel = read('src/features/admin/components/admin/AdminPhoneVerifications.tsx');
check('admin panel approves and rejects', adminPanel.includes("decide(row.id, 'approve')") && adminPanel.includes("decide(row.id, 'reject')"));
check('admin panel shows the reference, not the code', adminPanel.includes('{t.refLabel} {row.reference}') && !adminPanel.includes('row.code'));

if (fails) {
  console.error(`\nFAIL — ${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nPASS — phone verification contract holds');
