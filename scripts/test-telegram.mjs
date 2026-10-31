// Phase 2+3 Telegram tests: pure-helper verification (no Workers, no D1).
// Run: npm run test:telegram  (or: node scripts/test-telegram.mjs)
// D1 SQL (pairing consume atomicity, TTL) is verified by the local migration
// apply + the manual webhook checklist in the phase report — not here.
import {
  buildDeepLink,
  buildOrderKeyboard,
  callTelegramApi,
  escapeHtml,
  formatNewOrderMessage,
  isBotUsernameFormat,
  isPairingCodeFormat,
  newPairingCode,
  notifyNewOrderTelegram,
  readLastTelegramNotification,
  readPendingPairing,
  resolveBotUsername,
  verifyWebhookSecret,
} from '../functions/_shared/telegram.js';
import { sha256Hex } from '../functions/_shared/access.js';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
};

// 1. Pairing code shape: 43-char base64url (fits /start 64-char limit).
const codes = new Set();
let shapeOk = true;
for (let i = 0; i < 25; i++) {
  const c = newPairingCode();
  if (!isPairingCodeFormat(c)) shapeOk = false;
  codes.add(c);
}
ok('pairing code format (25 samples)', shapeOk);
ok('pairing codes unique (25 samples)', codes.size === 25);
ok('reject bad code shapes', !isPairingCodeFormat('short') && !isPairingCodeFormat('x'.repeat(44)) && !isPairingCodeFormat(null));

// 2. Hash-only storage primitive: 64-hex, deterministic, preimage-hidden.
const h1 = await sha256Hex([...codes][0]);
const h2 = await sha256Hex([...codes][0]);
const h3 = await sha256Hex([...codes][1]);
ok('sha256 hex length', /^[0-9a-f]{64}$/.test(h1));
ok('sha256 deterministic', h1 === h2);
ok('sha256 distinct per code', h1 !== h3);

// 3. Bot username + deep link.
ok('username valid', isBotUsernameFormat('YourRestaurantBot'));
ok('username rejects short/garbage', !isBotUsernameFormat('ab') && !isBotUsernameFormat('has space') && !isBotUsernameFormat(''));
const dl = buildDeepLink('YourRestaurantBot', [...codes][2]);
ok('deep link shape', dl === `https://t.me/YourRestaurantBot?start=${[...codes][2]}`);
ok('deep link null without username', buildDeepLink('', [...codes][2]) === null);

// 4. Webhook secret gate.
const req = (v) => ({ headers: { get: (k) => (k === 'X-Telegram-Bot-Api-Secret-Token' ? v : null) } });
ok('secret match', verifyWebhookSecret(req('s3cret'), { TELEGRAM_WEBHOOK_SECRET: 's3cret' }) === true);
ok('secret mismatch', verifyWebhookSecret(req('nope'), { TELEGRAM_WEBHOOK_SECRET: 's3cret' }) === false);
ok('secret missing header', verifyWebhookSecret(req(''), { TELEGRAM_WEBHOOK_SECRET: 's3cret' }) === false);
ok('secret unconfigured -> null (closed)', verifyWebhookSecret(req('x'), {}) === null);

// 5. Bot API transport classification (mocked fetch — no network).
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const out1 = await callTelegramApi('tok', 'sendMessage', { a: 1 }, 5000, async () => jsonRes(200, { ok: true, result: { message_id: 7 } }));
ok('api ok passthrough', out1.ok === true && out1.result.message_id === 7);
const out2 = await callTelegramApi('tok', 'sendMessage', {}, 5000, async () => jsonRes(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3 } }));
ok('429 retryable + retry_after', out2.ok === false && out2.retryable === true && out2.retryAfter === 3);
const out3 = await callTelegramApi('tok', 'sendMessage', {}, 5000, async () => jsonRes(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }));
ok('400 not retryable', out3.ok === false && out3.retryable === false);
const out4 = await callTelegramApi('tok', 'sendMessage', {}, 5000, async () => null);
ok('network failure retryable', out4.ok === false && out4.retryable === true);
const out5 = await callTelegramApi('', 'sendMessage', {}, 5000, async () => jsonRes(200, { ok: true }));
ok('empty token refused', out5.ok === false && out5.retryable === false);

// 6. HTML escaping for Phase 4 message text.
ok('escape html', escapeHtml('<b>&"x"</b>') === '&lt;b&gt;&amp;"x"&lt;/b&gt;');

// 7. Order message formatting (Phase 4).
const sampleCleaned = {
  type: 'delivery',
  name: 'Ali <b>Test</b>',
  phone: '96170123456',
  address: 'Beirut, Hamra & Main St',
  table: null,
  notes: 'بدون بصل <urgent>',
  items: [
    {
      id: 'i1', qty: 2, unitPrice: 150000,
      name: { ar: 'برجر لحم', en: 'Beef Burger' },
      variantName: { ar: 'كبير', en: 'Large' },
      addonNames: [{ ar: 'جبنة إضافية', en: 'Extra cheese' }],
    },
    { id: 'i2', qty: 1, unitPrice: 50000, name: { ar: '', en: 'Fries' } },
  ],
  subtotal: 350000,
  deliveryFee: 30000,
  total: 380000,
};
const msg = formatNewOrderMessage(sampleCleaned, 1001, 'ل.ل');
ok('message has order number', msg.includes('#1001'));
ok('message escapes customer name', msg.includes('Ali &lt;b&gt;Test&lt;/b&gt;') && !msg.includes('<b>Test</b>'));
ok('message shows type + address', msg.includes('توصيل') && msg.includes('Hamra &amp; Main St'));
ok('message shows variant/addon', msg.includes('كبير') && msg.includes('+جبنة إضافية'));
ok('message falls back to en name', msg.includes('Fries'));
ok('message totals', msg.includes('380,000') && msg.includes('ل.ل'));
ok('message escapes notes', msg.includes('بدون بصل &lt;urgent&gt;'));
const dinein = formatNewOrderMessage({ ...sampleCleaned, type: 'dinein', table: 'T5', address: null }, 1002, '');
ok('dinein shows table not address', dinein.includes('T5') && !dinein.includes('العنوان'));
const many = formatNewOrderMessage(
  { ...sampleCleaned, items: Array.from({ length: 25 }, (_, i) => ({ id: `i${i}`, qty: 1, unitPrice: 1000, name: { en: `Item ${i}` } })) },
  1003, ''
);
ok('long orders truncated with remainder', many.includes('أصناف أخرى') && many.length <= 4100);
ok('empty items safe', formatNewOrderMessage({ type: 'pickup', name: 'X', phone: '1', items: [] }, 1, '').includes('#1'));

// 7b. Bot username resolution: env (developer) wins, D1 fallback, else null.
const dbWithD1Name = {
  prepare() {
    return {
      bind() { return this; },
      async first() { return { value: JSON.stringify({ bot_username: 'D1FallbackBot' }) }; },
    };
  },
};
ok('env username wins', await resolveBotUsername(dbWithD1Name, { TELEGRAM_BOT_USERNAME: 'EnvSetBot' }) === 'EnvSetBot');
ok('d1 fallback used', await resolveBotUsername(dbWithD1Name, {}) === 'D1FallbackBot');
ok('bad env falls back to d1', await resolveBotUsername(dbWithD1Name, { TELEGRAM_BOT_USERNAME: 'ab' }) === 'D1FallbackBot');
ok('null when unconfigured', await resolveBotUsername(mockDb(false), {}) === null);

// 7c. Pending-pairing flag survives refresh (count only — never the code).
const dbPending = {
  prepare() {
    return {
      bind() { return this; },
      async first() { return { n: 2, exp: '2026-01-01T00:10:00.000Z' }; },
    };
  },
};
const pend = await readPendingPairing(dbPending);
ok('pending flag true with expiry', pend.pending === true && pend.expiresAt === '2026-01-01T00:10:00.000Z');
const pendNone = await readPendingPairing(mockDb(false));
ok('pending flag false when none', pendNone.pending === false);

// 8. View-button keyboard (URL — no callback, no auth surface).
const kb = buildOrderKeyboard('https://example.com/admin/dashboard');
ok('keyboard url button', kb.inline_keyboard[0][0].url === 'https://example.com/admin/dashboard'
  && typeof kb.inline_keyboard[0][0].text === 'string');

// 9. Ledger sender with mocked D1 + fetch.
function mockDb(linked) {
  const ledger = new Map();
  return {
    ledger,
    prepare(sql) {
      const self = this;
      const noBind = () => self.prepare(sql).bind();
      return {
        first(...a) { return noBind().first(...a); },
        run(...a) { return noBind().run(...a); },
        all(...a) { return noBind().all(...a); },
        bind(...args) {
          return {
            async run() {
              if (sql.includes('INSERT INTO telegram_notifications')) {
                if (!self.ledger.has(args[0])) {
                  self.ledger.set(args[0], { status: 'pending', attempts: 0, order_number: args[1] });
                }
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE telegram_notifications')) {
                const row = self.ledger.get(args[0]) || {};
                self.ledger.set(args[0], { ...row, status: args[1], attempts: args[2], last_error: args[3] });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('DELETE FROM telegram_pairing_codes')) return { meta: { changes: 0 } };
              return { meta: { changes: 0 } };
            },
            async first() {
              if (sql.includes('FROM telegram_notifications') && sql.includes('order_id')) {
                const row = self.ledger.get(args[0]);
                return row ? { status: row.status } : null;
              }
              if (sql.includes('SELECT value FROM service_config')) {
                return linked ? { value: JSON.stringify({ chat_id: 12345, linked_at: '2026-01-01' }) } : null;
              }
              if (sql.includes('SELECT order_number')) {
                const rows = [...self.ledger.entries()];
                if (!rows.length) return null;
                const r = rows[rows.length - 1][1];
                return { order_number: r.order_number, status: r.status, attempts: r.attempts, updated_at: 't', sent_at: null };
              }
              return null;
            },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
}
const apiOk = (calls) => async () => { calls.n += 1; return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }; };

const realFetch = globalThis.fetch;
let calls = { n: 0 };
globalThis.fetch = apiOk(calls);
const dbLinked = mockDb(true);
const r1 = await notifyNewOrderTelegram(dbLinked, 'tok', {
  orderId: 'ord-1', orderNumber: 1001, cleaned: sampleCleaned, storeName: 'مطعم', currency: 'ل.ل', adminUrl: 'https://x/admin/dashboard',
});
ok('first send delivered', r1.sent === 1 && calls.n === 1);
const r2 = await notifyNewOrderTelegram(dbLinked, 'tok', {
  orderId: 'ord-1', orderNumber: 1001, cleaned: sampleCleaned, storeName: 'مطعم', currency: 'ل.ل', adminUrl: 'https://x/admin/dashboard',
});
ok('duplicate skipped without resend', r2.sent === 0 && r2.reason === 'duplicate' && calls.n === 1);

const dbUnlinked = mockDb(false);
const r3 = await notifyNewOrderTelegram(dbUnlinked, 'tok', { orderId: 'ord-2', orderNumber: 2, cleaned: sampleCleaned, adminUrl: '' });
ok('unlinked order still succeeds silently', r3.sent === 0 && r3.reason === 'unlinked' && calls.n === 1);
const r4 = await notifyNewOrderTelegram(dbLinked, '', { orderId: 'ord-3', orderNumber: 3, cleaned: sampleCleaned, adminUrl: '' });
ok('missing token never throws', r4.sent === 0 && r4.reason === 'no_token');

// Retryable then success: 429 (retry_after 1) then ok — one retry only.
let seq = 0;
globalThis.fetch = async () => {
  seq += 1;
  if (seq === 1) return { ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, description: 'Too Many', parameters: { retry_after: 1 } }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
};
const dbRetry = mockDb(true);
const r5 = await notifyNewOrderTelegram(dbRetry, 'tok', { orderId: 'ord-9', orderNumber: 9, cleaned: sampleCleaned, adminUrl: '' });
ok('retryable error retried once then sent', r5.sent === 1 && seq === 2);

// Non-retryable: single attempt, recorded failed.
let bad = 0;
globalThis.fetch = async () => { bad += 1; return { ok: false, status: 400, json: async () => ({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }) }; };
const dbBad = mockDb(true);
const r6 = await notifyNewOrderTelegram(dbBad, 'tok', { orderId: 'ord-10', orderNumber: 10, cleaned: sampleCleaned, adminUrl: '' });
ok('400 fails without retry', r6.sent === 0 && bad === 1 && dbBad.ledger.get('ord-10').status === 'failed');
globalThis.fetch = realFetch;

// 10. Last-notification read.
const last = await readLastTelegramNotification(dbBad);
ok('last notification mapped', last && last.orderNumber === 10 && last.status === 'failed');
ok('last notification null on empty', await readLastTelegramNotification(mockDb(true)) === null);

console.log(`telegram: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
