/**
 * UniMTX SMS OTP fallback contract.
 * Run: node scripts/test-sms-verification.mjs
 *
 * Proves:
 *  - simple + HMAC query building and signing;
 *  - E.164 normalization;
 *  - send/verify parsing and error handling;
 *  - the route stores method='sms', enforces the daily cap, and verifies the
 *    code server-side (no owner call);
 *  - the sheet always offers a direct "I don't have WhatsApp — send SMS"
 *    button plus the code input after an SMS request.
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildUnimtxQuery,
  isUnimtxConfigured,
  sendUnimtxOtp,
  toUnimtxPhone,
  verifyUnimtxOtp,
} from '../functions/_shared/unimtx.js';

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

/* ---------- phone + config ---------- */

check('phone becomes E.164', toUnimtxPhone('961 70 123 456') === '+96170123456');
check('Arabic digits normalize', toUnimtxPhone('٩٦١٧٠١٢٣٤٥٦') === '+96170123456');
check('short phone rejected', toUnimtxPhone('12345') === null);
check('long phone rejected', toUnimtxPhone('1234567890123456') === null);
check('configured only with an access key', isUnimtxConfigured({ UNIMTX_ACCESS_KEY_ID: 'key' }));
check('unconfigured without an access key', !isUnimtxConfigured({}));

/* ---------- query/signature ---------- */

const simple = await buildUnimtxQuery({ UNIMTX_ACCESS_KEY_ID: 'key' }, 'otp.send', 1700000000000);
check('simple mode has action + key only', !!simple && simple.params.action === 'otp.send' && simple.params.accessKeyId === 'key' && !simple.params.signature);
check('missing key returns null', (await buildUnimtxQuery({}, 'otp.send')) === null);

const hmac = await buildUnimtxQuery(
  { UNIMTX_ACCESS_KEY_ID: 'key', UNIMTX_ACCESS_KEY_SECRET: 'secret' },
  'otp.verify',
  1700000000000
);
check('HMAC mode sets algorithm + timestamp + nonce', hmac.params.algorithm === 'hmac-sha256' && hmac.params.timestamp === '1700000000000' && typeof hmac.params.nonce === 'string');
const { signature, ...unsigned } = hmac.params;
const signingText = Object.keys(unsigned).sort().map((k) => `${k}=${unsigned[k]}`).join('&');
const expectedSignature = createHmac('sha256', 'secret').update(signingText).digest('base64');
check('HMAC matches the documented sorted query', signature === expectedSignature);

/* ---------- send/verify ---------- */

let captured = null;
const fakeFetch = async (url, init) => {
  captured = { url, init };
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: '0', message: 'Success', data: { id: 'msg-1', parts: 1, price: '0.0100' } }),
  };
};
const env = { UNIMTX_ACCESS_KEY_ID: 'key', UNIMTX_ACCESS_KEY_SECRET: 'secret' };
const sent = await sendUnimtxOtp(env, { to: '96170123456', channel: 'sms' }, fakeFetch);
check('send succeeds', sent.ok && sent.data.id === 'msg-1');
check('send action is otp.send', captured.url.includes('action=otp.send'));
check('send URL carries the access key', captured.url.includes('accessKeyId=key'));
check('send URL is signed', captured.url.includes('signature='));
const body = JSON.parse(captured.init.body);
check('send body is E.164', body.to === '+96170123456');
check('send body is SMS', body.channel === 'sms');
check('send body uses 6 digits', body.digits === 6);
check('send body intent is phone_verification', body.intent === 'phone_verification');
check('send body TTL is 5 minutes', body.ttl === 300);

const badChannel = await sendUnimtxOtp(env, { to: '96170123456', channel: 'whatsapp' }, fakeFetch);
check('whatsapp channel is refused (our Cloud API is primary)', !badChannel.ok && badChannel.error === 'bad_channel');

const verifyCaptured = [];
const verifyFetch = async (url, init) => {
  verifyCaptured.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ code: '0', message: 'Success', data: { valid: true } }) };
};
const verified = await verifyUnimtxOtp(env, { to: '96170123456', code: '123456' }, verifyFetch);
check('verify succeeds', verified.ok && verified.valid);
check('verify action is otp.verify', verifyCaptured[0].url.includes('action=otp.verify'));
check('verify sends the same phone/intent', verifyCaptured[0].body.to === '+96170123456' && verifyCaptured[0].body.intent === 'phone_verification');
check('verify sends the code', verifyCaptured[0].body.code === '123456');

const invalidFetch = async () => ({ ok: true, status: 200, json: async () => ({ code: '0', message: 'Success', data: { valid: false } }) });
const invalid = await verifyUnimtxOtp(env, { to: '96170123456', code: '000000' }, invalidFetch);
check('invalid code is reported without throwing', invalid.ok && !invalid.valid);

const errorFetch = async () => ({ ok: false, status: 400, json: async () => ({ code: '105400', message: 'InsufficientFunds' }) });
const sendError = await sendUnimtxOtp(env, { to: '96170123456' }, errorFetch);
check('provider error is surfaced', !sendError.ok && sendError.code === '105400' && sendError.message === 'InsufficientFunds');

/* ---------- migration + route/UI wiring ---------- */

const migration = read('migrations/0040_phone_verification_method.sql');
check('migration adds method', migration.includes('ADD COLUMN method'));
check('migration adds provider id', migration.includes('ADD COLUMN provider_id'));
check('migration adds attempts', migration.includes('ADD COLUMN attempts'));

const route = read('functions/api/account/phone-verification.js');
check('route accepts method=sms', route.includes("body.method === 'sms'"));
check('route sends via UniMTX', route.includes('sendUnimtxOtp'));
check('route verifies via UniMTX', route.includes('verifyUnimtxOtp'));
check('route stores method sms', route.includes("method: 'sms'"));
check('route enforces the SMS daily cap', route.includes('UNIMTX_SMS_DAILY_MAX') && route.includes('countSmsRequestsSince'));
check('route locks after 5 SMS attempts', route.includes('SMS_MAX_ATTEMPTS'));
check('route approves SMS as decided_by sms', route.includes("decidedBy: 'sms'"));
check(
  'route lets an explicit SMS request replace a pending WhatsApp code',
  route.includes('pendingMethod !== method') && route.includes('expireVerificationById(db, pending.id, nowIso)')
);

const repo = read('functions/_shared/repositories/phone-verifications.repo.js');
check('webhook sees WhatsApp rows only', repo.includes("method = 'whatsapp'") && repo.includes("row.method === 'sms' ? 'sms' : 'whatsapp'"));
check('SMS attempts increment', repo.includes('incrementVerificationAttempts'));

const hook = read('src/features/auth/hooks/usePhoneVerification.ts');
check('hook can request SMS', hook.includes("'whatsapp' | 'sms'") && hook.includes('verifyPhoneSms'));
check('hook exposes verifySms', hook.includes('const verifySms') && hook.includes('setSmsError'));
check('hook caches the SMS method', hook.includes("parsed.method === 'sms'") && hook.includes("method: pending.method === 'sms' ? 'sms' : 'whatsapp'"));
check(
  'hook rechecks after returning to the page and cannot spin forever',
  hook.includes("addEventListener('visibilitychange'") && hook.includes("addEventListener('pageshow'") && hook.includes('15_000')
);

const sheet = read('src/features/auth/components/PhoneVerificationSheet.tsx');
check('sheet has Need help?', sheet.includes('t.needHelp'));
check(
  'sheet always offers the no-WhatsApp SMS button',
  sheet.includes('t.noWhatsAppSms') && sheet.includes("verification.request(lang, 'sms')")
);
check(
  'no-WhatsApp option sits above the code/WhatsApp action',
  sheet.indexOf('{smsFallback}') > -1
    && sheet.indexOf('{smsFallback}') < sheet.indexOf("{active?.method === 'sms'")
);
check(
  'verification steps mark step 1 done and step 2 current once a code exists',
  sheet.includes('stepStateFor') && sheet.includes("index === 0 ? 'done'") && sheet.includes('aria-current')
);
check('sheet has the SMS code input', sheet.includes('smsCode') && sheet.includes('verification.verifySms(smsCode)') && sheet.includes('t.smsCodeLabel'));
check('sheet reveals the SMS help copy after 60s', sheet.includes('60_000'));
check('sheet shows SMS only for the SMS method', sheet.includes("active?.method === 'sms'"));

const accountsTab = read('src/features/admin/components/admin/AdminCustomersTab.tsx');
check(
  'automatic verification panel is not rendered in Accounts',
  !accountsTab.includes('AdminPhoneVerifications')
);

if (fails) {
  console.error(`\nFAIL — ${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nPASS — UniMTX SMS fallback contract holds');
