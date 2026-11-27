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
  getUnimtxTemplateId,
  getUnimtxTemplateVar,
  isUnimtxConfigured,
  sendUnimtxOtp,
  sendUnimtxTemplateSms,
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

/* ---------- custom branded template ---------- */

check(
  'Arabic template id comes from UNIMTX_SMS_TEMPLATE_ID_AR',
  getUnimtxTemplateId({ UNIMTX_SMS_TEMPLATE_ID_AR: 'pub_otp_ar' }, 'ar') === 'pub_otp_ar'
);
check(
  'English template id comes from UNIMTX_SMS_TEMPLATE_ID_EN',
  getUnimtxTemplateId({ UNIMTX_SMS_TEMPLATE_ID_EN: 'pub_otp_en_basic2' }, 'en') === 'pub_otp_en_basic2'
);
check(
  'shared template id remains a fallback for both languages',
  getUnimtxTemplateId({ UNIMTX_SMS_TEMPLATE_ID: 'shared_tpl' }, 'ar') === 'shared_tpl'
    && getUnimtxTemplateId({ UNIMTX_SMS_TEMPLATE_ID: 'shared_tpl' }, 'en') === 'shared_tpl'
);
check(
  'a missing language template falls through (no cross-language send)',
  getUnimtxTemplateId({ UNIMTX_SMS_TEMPLATE_ID_EN: 'pub_otp_en_basic2' }, 'ar') === ''
);
check('template id is empty when unset', getUnimtxTemplateId({}, 'ar') === '' && getUnimtxTemplateId({}, 'en') === '');
check('template variable defaults to code', getUnimtxTemplateVar({}) === 'code');
check(
  'template variable can be overridden safely',
  getUnimtxTemplateVar({ UNIMTX_SMS_TEMPLATE_VAR: 'otp' }) === 'otp'
    && getUnimtxTemplateVar({ UNIMTX_SMS_TEMPLATE_VAR: 'bad name!' }) === 'code'
);
let templateCaptured = null;
const templateFetch = async (url, init) => {
  templateCaptured = { url, body: JSON.parse(init.body) };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: '0',
      message: 'Success',
      data: { messages: [{ id: 'tpl-msg-1', to: '+201205560001', parts: 1 }] },
    }),
  };
};
const templateSent = await sendUnimtxTemplateSms(
  env,
  {
    to: '201205560001',
    templateId: 'chou3abelak_verify',
    templateData: { code: '123456' },
  },
  templateFetch
);
check('template send succeeds', templateSent.ok && templateSent.providerId === 'tpl-msg-1');
check('template action is sms.message.send', templateCaptured.url.includes('action=sms.message.send'));
check('template body is E.164', templateCaptured.body.to === '+201205560001');
check('template body carries the custom template code', templateCaptured.body.templateId === 'chou3abelak_verify');
check('template body carries only the code variable', templateCaptured.body.templateData.code === '123456');
check('template body does not fall back to text/content', !templateCaptured.body.text && !templateCaptured.body.content);
const missingTemplate = await sendUnimtxTemplateSms(env, { to: '201205560001', templateId: '' }, templateFetch);
check('missing template id is refused', !missingTemplate.ok && missingTemplate.error === 'template_missing');

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
  'route supports language-specific SMS templates',
  route.includes('getUnimtxTemplateId(env, lang)')
    && route.includes('sendUnimtxTemplateSms')
    && route.includes('getUnimtxTemplateVar')
    && route.includes('templateData: { [templateVar]: smsCode }')
);
check(
  'route falls back to the built-in OTP when a template fails',
  route.includes("if (codeHash === 'unimtx')") && route.includes('sendUnimtxOtp')
);
check(
  'route verifies a custom template code against our local hash',
  route.includes("pending.code_hash === 'unimtx'") && route.includes('verificationCodeMatches')
);
check(
  'route explains a code cancelled by a saved-phone change',
  route.includes('findPhoneChangeRevocation') && route.includes("PHONE_CHANGED_ERROR")
);
check(
  'route re-checks ownership before an SMS approval',
  route.includes('phoneOwnedByAnotherUser') && route.includes("decidedBy: 'ownership_conflict'")
);
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
check(
  'sheet keeps the SMS action in the fixed footer',
  sheet.includes('footerSecondary') && sheet.includes('t.noWhatsAppSms')
);
check(
  'sheet always offers the no-WhatsApp SMS button',
  sheet.includes('t.noWhatsAppSms') && sheet.includes("verification.request(lang, 'sms')")
);
check(
  'SMS action is always visible (no 60s reveal timer)',
  !sheet.includes('60_000') && sheet.indexOf('t.noWhatsAppSms') > sheet.indexOf('footerSecondary')
);
check(
  'sheet footer has safe-area bottom padding',
  sheet.includes('pb-[max(1rem,env(safe-area-inset-bottom))]')
);
check(
  'verification steps mark step 1 done and step 2 current once a code exists',
  sheet.includes('stepStateFor') && sheet.includes("index === 0 ? 'done'") && sheet.includes('aria-current')
);
check('sheet has the SMS code input', sheet.includes('smsCode') && sheet.includes('verification.verifySms(smsCode)') && sheet.includes('t.smsCodeLabel'));
check(
  'resend stays hidden until the five-minute code expires',
  sheet.includes('leftMs <= 0 &&') && sheet.includes('t.resend') && sheet.includes('t.smsResend')
);
check(
  'sheet shows the cancelled-after-phone-change reason',
  sheet.includes("verification.smsError === 'phone_changed'") && sheet.includes('t.smsErrorPhoneChanged')
);
check(
  'sheet shows the linked-account reason for an SMS ownership conflict',
  sheet.includes("verification.smsError === 'phone_linked_other_account'") && sheet.includes('t.errorPhoneLinked')
);
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
