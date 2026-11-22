/**
 * WhatsApp Cloud API auto-verification contract.
 * Run: node scripts/test-whatsapp-webhook.mjs
 *
 * Proves the webhook can be trusted and that a correct/incorrect code leads to
 * exactly the promised reply:
 *  - Meta's raw-body HMAC is mandatory and constant-time compared;
 *  - only text messages are parsed; statuses/media are ignored;
 *  - 6-digit code extraction never grabs a longer/shorter number;
 *  - the success and wrong-code replies carry the exact Arabic/English copy;
 *  - the Graph send uses the phone-number id + bearer token, never the URL;
 *  - the route auto-approves with decidedBy='whatsapp', claims each message id
 *    once, and caps replies to protect the free monthly service allowance;
 *  - the customer request route has no Telegram notification;
 *  - the code TTL is 2 minutes.
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractVerificationCode,
  looksLikeVerificationMessage,
  normalizeWhatsAppPhone,
  pickReplyLanguage,
  readWhatsAppMessages,
  sendWhatsAppText,
  verifyWebhookSignature,
  whatsappReply,
} from '../functions/_shared/whatsapp.js';
import { VERIFICATION_CODE_TTL_MS } from '../functions/_shared/phone-verification.js';

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

/* ---------- phone + code extraction ---------- */

check('whatsapp phone strips plus/spaces', normalizeWhatsAppPhone('+961 70 123 456') === '96170123456');
check('whatsapp phone normalizes Arabic digits', normalizeWhatsAppPhone('٩٦١٧٠١٢٣٤٥٦') === '96170123456');
check('whatsapp phone rejects short numbers', normalizeWhatsAppPhone('12345') === '');
check('whatsapp phone rejects long numbers', normalizeWhatsAppPhone('1234567890123456') === '');
check('code extracted from the site message', extractVerificationCode('Hello!\nCode: 123456\nRef: ABCD1234') === '123456');
check('code extracted from a bare code', extractVerificationCode('123456') === '123456');
check('five digits are not a code', extractVerificationCode('12345') === null);
check('seven digits are not a code', extractVerificationCode('1234567') === null);
check('a phone number is not mistaken for a code', extractVerificationCode('+961 70 123 456') === null);
check('verification keyword detected (EN)', looksLikeVerificationMessage('please verify my number'));
check('verification keyword detected (AR)', looksLikeVerificationMessage('أرجو تأكيد رقمي'));
check('ordinary message ignored', !looksLikeVerificationMessage('do you deliver to Tripoli?'));
check('prefer does not look like "ref"', !looksLikeVerificationMessage('I prefer pickup please'));
check('a short bare code is a verification attempt', looksLikeVerificationMessage('123456'));
check('a long order message with 6 digits is ignored', !looksLikeVerificationMessage('my order number is 123456 and I need it today'));

/* ---------- webhook payload parsing ---------- */

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            messages: [
              {
                id: 'wamid.one',
                from: '96170123456',
                type: 'text',
                timestamp: '1770000000',
                text: { body: 'Hello!\nCode: 654321\nRef: ABCD1234' },
              },
              {
                id: 'wamid.two',
                from: '96170999999',
                type: 'image',
                image: { id: 'media-1' },
              },
            ],
            statuses: [{ id: 'wamid.status', status: 'delivered' }],
          },
        },
      ],
    },
  ],
};
const messages = readWhatsAppMessages(payload);
check('only the text message is parsed', messages.length === 1);
check('sender is normalized', messages[0].from === '96170123456');
check('message id is preserved', messages[0].id === 'wamid.one');
check('body is preserved', messages[0].text.includes('654321'));
check('non-whatsapp objects are ignored', readWhatsAppMessages({ object: 'page' }).length === 0);

/* ---------- signature ---------- */

const appSecret = 'test-app-secret';
const raw = JSON.stringify(payload);
const goodSig = `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`;
check('valid Meta signature accepted', await verifyWebhookSignature(raw, goodSig, appSecret));
check('uppercase signature accepted', await verifyWebhookSignature(raw, goodSig.toUpperCase().replace('SHA256=', 'sha256='), appSecret));
check('wrong secret rejected', !(await verifyWebhookSignature(raw, goodSig, 'other-secret')));
check('tampered body rejected', !(await verifyWebhookSignature(`${raw} `, goodSig, appSecret)));
check('missing signature rejected', !(await verifyWebhookSignature(raw, null, appSecret)));
check('malformed signature rejected', !(await verifyWebhookSignature(raw, 'sha256=nothex', appSecret)));
check('missing app secret rejected', !(await verifyWebhookSignature(raw, goodSig, '')));

/* ---------- reply copy + language ---------- */

const successAr = whatsappReply('success', 'ar');
const successEn = whatsappReply('success', 'en');
check('success says the number is confirmed (AR)', successAr.includes('تم تأكيد رقمك'));
check('success says verified (EN)', /verified/i.test(successEn));
check('success does not mention an order', !/order|طلب/i.test(successAr) && !/order/i.test(successEn));
check('wrong says the code is wrong (AR)', whatsappReply('wrong', 'ar').includes('خاطئ'));
check('wrong asks to retry (AR)', whatsappReply('wrong', 'ar').includes('إعادة المحاولة'));
check('wrong asks to retry (EN)', /try again/i.test(whatsappReply('wrong', 'en')));
check('expired asks for a new code (AR)', whatsappReply('expired', 'ar').includes('رمزًا جديدًا'));
check('missing asks for the 6-digit code', whatsappReply('missing', 'ar').includes('6'));
check(
  'conflict says the number is linked to another member (AR)',
  whatsappReply('conflict', 'ar').includes('حساب عضو آخر')
);
check(
  'conflict says the number is linked to another member (EN)',
  /linked to another member account/i.test(whatsappReply('conflict', 'en'))
);
check('stored Arabic wins over English text', pickReplyLanguage('ar', 'Hello') === 'ar');
check('stored English wins over Arabic text', pickReplyLanguage('en', 'مرحبا') === 'en');
check('detects Arabic when the row has no language', pickReplyLanguage(null, 'مرحبًا! يرجى تأكيد رقمي') === 'ar');
check('detects English when the row has no language', pickReplyLanguage(null, 'Hello! Please verify my number') === 'en');
check('bare code falls back to Arabic', pickReplyLanguage(null, '123456') === 'ar');

/* ---------- Graph send ---------- */

let captured = null;
const fakeFetch = async (url, init) => {
  captured = { url, init };
  return {
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: 'wamid.sent' }] }),
  };
};
const env = {
  WHATSAPP_ACCESS_TOKEN: 'token-123',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_GRAPH_VERSION: 'v24.0',
};
const sent = await sendWhatsAppText(env, '96170123456', 'test body', fakeFetch);
check('graph send succeeds', sent.ok);
check('graph url uses the phone-number id', captured.url === 'https://graph.facebook.com/v24.0/1234567890/messages');
check('graph send uses a bearer header', captured.init.headers.Authorization === 'Bearer token-123');
check('graph token never appears in the URL', !captured.url.includes('token-123'));
const body = JSON.parse(captured.init.body);
check('graph payload is a text message', body.type === 'text' && body.text.body === 'test body');
check('graph recipient is normalized', body.to === '96170123456');
check('graph payload uses whatsapp product', body.messaging_product === 'whatsapp');

const unconfigured = await sendWhatsAppText({}, '96170123456', 'x', fakeFetch);
check('unconfigured send reports not_configured', !unconfigured.ok && unconfigured.error === 'not_configured');

const failingFetch = async () => ({
  ok: false,
  status: 400,
  json: async () => ({ error: { message: 'bad request' } }),
});
const failed = await sendWhatsAppText(env, '96170123456', 'x', failingFetch);
check('graph error is reported without throwing', !failed.ok && failed.status === 400);

/* ---------- migration + route wiring ---------- */

const migration = read('migrations/0038_whatsapp_webhook.sql');
check('migration creates the webhook ledger', migration.includes('CREATE TABLE IF NOT EXISTS whatsapp_webhook_events'));
check('migration makes the message id unique', migration.includes('message_id TEXT PRIMARY KEY'));
check('migration indexes the sender for reply caps', migration.includes('idx_whatsapp_events_phone'));
const langMigration = read('migrations/0039_phone_verification_lang.sql');
check('migration remembers the site language', langMigration.includes('ADD COLUMN lang') && langMigration.includes("DEFAULT 'en'"));

const route = read('functions/api/whatsapp/webhook.js');
check('webhook verifies the GET challenge', route.includes("hub.mode") && route.includes("hub.verify_token") && route.includes('hub.challenge'));
check('webhook verifies the raw-body signature', route.includes('X-Hub-Signature-256') && route.includes('verifyWebhookSignature'));
check('webhook requires an app secret', route.includes('WHATSAPP_APP_SECRET') && route.includes("error: 'unavailable'"));
check('webhook claims each message once', route.includes('claimWhatsAppEvent') && route.includes('finishWhatsAppEvent'));
check('webhook matches the code against the pending row', route.includes('verificationCodeMatches') && route.includes('listPendingVerificationsByPhone'));
check('webhook auto-approves as whatsapp', route.includes("decidedBy: 'whatsapp'") && route.includes('decideVerification'));
check(
  'webhook refuses a number claimed by another member',
  route.includes('phoneOwnedByAnotherUser') && route.includes("decidedBy: 'ownership_conflict'")
);
check('webhook replies in the row language', route.includes("whatsappReply('success'") && route.includes('pickReplyLanguage'));
check('webhook caps replies per phone + month', route.includes('REPLY_HOURLY_PER_PHONE') && route.includes('REPLY_DAILY_PER_PHONE') && route.includes('WHATSAPP_REPLY_MONTHLY_CAP'));
check('webhook ignores ordinary messages without a reply', route.includes('looksLikeVerificationMessage(msg.text)') && route.includes('return'));

const customerRoute = read('functions/api/account/phone-verification.js');
check('customer route has no Telegram notification', !/telegram/i.test(customerRoute));
check('customer route stores the site language', customerRoute.includes('lang,') && customerRoute.includes('insertVerification'));
check('code TTL is two minutes', VERIFICATION_CODE_TTL_MS === 2 * 60 * 1000);

const sheet = read('src/features/auth/strings.ts');
check('sheet says automatic confirmation', sheet.includes('Confirmed automatically'));
check('sheet success copy does not mention an order', !sheet.includes('You can place your order now.') && !sheet.includes('يمكنك إرسال طلبك الآن.'));
const sheetComponent = read('src/features/auth/components/PhoneVerificationSheet.tsx');
check(
  'sheet prefers the server verification URL over the menu number',
  sheetComponent.includes('active?.whatsappUrl || buildPhoneVerificationWhatsAppUrl')
);
check(
  'sheet shows the destination number before sending',
  sheetComponent.includes('destinationNumber') && sheetComponent.includes('t.sendingTo')
);

const admin = read('src/features/admin/components/admin/AdminPhoneVerifications.tsx');
check('admin panel describes the manual fallback', /Automatic WhatsApp verification is on/i.test(admin) && admin.includes('fallback'));

if (fails) {
  console.error(`\nFAIL — ${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nPASS — WhatsApp auto-verification contract holds');
