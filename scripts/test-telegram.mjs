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
  handleOrderCallback,
  isBotUsernameFormat,
  isPairingCodeFormat,
  isTelegramTransitionAllowed,
  newPairingCode,
  notifyNewOrderTelegram,
  parseOrderCallback,
  readLastTelegramNotification,
  readPendingPairing,
  resolveBotUsername,
  syncOrderStatusToTelegram,
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

// 7d. Callback data: strict shape, 64-byte cap respected.
const oid = '123e4567-e89b-12d3-a456-426614174000';
ok('parse confirm', JSON.stringify(parseOrderCallback(`tg:cfm:${oid}`)) === JSON.stringify({ action: 'cfm', orderId: oid, status: 'confirmed' }));
ok('parse cancel', parseOrderCallback(`tg:cnl:${oid}`)?.status === 'cancelled');
ok('reject forged action', parseOrderCallback(`tg:done:${oid}`) === null);
ok('reject long id', parseOrderCallback(`tg:cfm:${'x'.repeat(129)}`) === null);
ok('reject non-string', parseOrderCallback(null) === null);
ok('transitions new->confirmed/cancelled', isTelegramTransitionAllowed('new', 'confirmed') && isTelegramTransitionAllowed('new', 'cancelled'));
ok('transitions confirmed->cancelled only', isTelegramTransitionAllowed('confirmed', 'cancelled') && !isTelegramTransitionAllowed('confirmed', 'confirmed'));
ok('transitions terminal blocked', !isTelegramTransitionAllowed('completed', 'cancelled') && !isTelegramTransitionAllowed('cancelled', 'confirmed'));
ok('parse received', parseOrderCallback(`tg:rcv:${oid}`)?.status === 'completed');
ok('transitions to received', isTelegramTransitionAllowed('new', 'completed') && isTelegramTransitionAllowed('confirmed', 'completed') && !isTelegramTransitionAllowed('cancelled', 'completed'));

// 7e. Callback handling end-to-end (mocked D1 + Bot API).
function orderDb(linked, initialStatus = 'new') {
  const base = mockDb(linked);
  const orders = new Map([['ord-1', {
    id: 'ord-1', number: 1001, status: initialStatus, type: 'delivery',
    customer_name: 'Ali', customer_phone: '96170', customer_address: null, customer_table: null,
    notes: null, location_lat: null, location_lng: null,
    items_json: '[]', subtotal: 100, delivery_fee: 0, total: 100, lang: 'ar',
    track_token: 't'.repeat(32), created_at: 't', updated_at: 't',
  }]]);
  const db = {
    ledger: base.ledger,
    orders,
    prepare(sql) {
      const inner = base.prepare(sql);
      return {
        first(...a) {
          if (sql.includes('FROM orders WHERE id')) {
            return Promise.resolve(orders.get(a[0]) || null);
          }
          return inner.first(...a);
        },
        run(...a) { return inner.run(...a); },
        all(...a) { return inner.all(...a); },
        bind(...args) {
          return {
            first() {
              if (sql.includes('FROM orders WHERE id')) {
                return Promise.resolve(orders.get(args[0]) || null);
              }
              return base.prepare(sql).bind(...args).first();
            },
            async run() {
              if (sql.includes('UPDATE orders SET status')) {
                const row = orders.get(args[2]);
                if (!row) return { meta: { changes: 0 } };
                row.status = args[0];
                row.updated_at = args[1];
                return { meta: { changes: 1 } };
              }
              return base.prepare(sql).bind(...args).run();
            },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  return db;
}
const cbCalls = [];
const realFetch2 = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const method = String(url).split('/').pop();
  cbCalls.push({ method, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
};
const cbBase = { callbackId: 'cb1', clickerId: 12345, chatId: 12345, messageId: 9, messageText: 'order' };
const dbNew = orderDb(true, 'new');
const okConfirm = await handleOrderCallback(dbNew, 'tok', { ...cbBase, data: `tg:cfm:ord-1` });
ok('confirm new order', okConfirm.handled === true && okConfirm.status === 'confirmed' && dbNew.orders.get('ord-1').status === 'confirmed');
ok('buttons frozen after action', cbCalls.some((c) => c.method === 'editMessageReplyMarkup'));
const repeat = await handleOrderCallback(dbNew, 'tok', { ...cbBase, callbackId: 'cb2', data: `tg:cfm:ord-1` });
ok('repeat confirm is noop', repeat.handled === true && repeat.noop === true && cbCalls.filter((c) => c.method === 'editMessageText').length === 1);
const badTrans = await handleOrderCallback(orderDb(true, 'completed'), 'tok', { ...cbBase, callbackId: 'cb3', data: `tg:cfm:ord-1` });
ok('terminal order rejected', badTrans.handled === false && badTrans.reason === 'bad_transition');
const unlinked = await handleOrderCallback(orderDb(false), 'tok', { ...cbBase, callbackId: 'cb4', data: `tg:cfm:ord-1` });
ok('stranger click rejected', unlinked.reason === 'unauthorized');
const forged = await handleOrderCallback(orderDb(true), 'tok', { ...cbBase, callbackId: 'cb5', data: 'tg:done:ord-1' });
ok('forged data rejected', forged.reason === 'bad_data');
const dbRecv = orderDb(true, 'confirmed');
const received = await handleOrderCallback(dbRecv, 'tok', { ...cbBase, callbackId: 'cb6', data: `tg:rcv:ord-1` });
ok('received marks completed', received.handled === true && received.status === 'completed' && dbRecv.orders.get('ord-1').status === 'completed');
const receivedAgain = await handleOrderCallback(dbRecv, 'tok', { ...cbBase, callbackId: 'cb7', data: `tg:rcv:ord-1` });
ok('repeat received is noop', receivedAgain.handled === true && receivedAgain.noop === true);
const lateCancel = await handleOrderCallback(dbRecv, 'tok', { ...cbBase, callbackId: 'cb8', data: `tg:cnl:ord-1` });
ok('cancel after completed rejected', lateCancel.handled === false && lateCancel.reason === 'bad_transition');
globalThis.fetch = realFetch2;

// 7g. Site -> Telegram sync (dashboard change stamps the same message).
const prevFetch7g = globalThis.fetch;
const syncCalls = [];
globalThis.fetch = async (url, init) => {
  syncCalls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
};
const dbSync = mockDb(true);
dbSync.ledger.set('ord-s1', { status: 'sent', order_number: 11, chat_id: 111, message_id: 22, message_text: '<b>طلب جديد #11</b>' });
const s1 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'ord-s1', status: 'confirmed', adminUrl: 'https://x/admin/dashboard' });
const editText = syncCalls.find((c) => c.method === 'editMessageText');
ok('sync stamps banner', s1.sent === 1 && editText && editText.body.text.includes('✅ تم تأكيد الطلب') && editText.body.text.includes('#11'));
ok('sync freezes buttons', syncCalls.some((c) => c.method === 'editMessageReplyMarkup' && c.body.reply_markup.inline_keyboard.length === 0));
const s2 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'missing', status: 'confirmed', adminUrl: '' });
ok('sync skips unknown order silently', s2.sent === 0 && s2.reason === 'no_message');
dbSync.ledger.set('ord-s2', { status: 'sent', order_number: 12, chat_id: null, message_id: null, message_text: null });
const s3 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'ord-s2', status: 'cancelled', adminUrl: '' });
ok('sync skips pre-0015 rows silently', s3.sent === 0 && s3.reason === 'no_message');
const nCalls = syncCalls.length;
const s4 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'ord-s1', status: 'new', adminUrl: 'https://x/admin/dashboard' });
ok('reopen restores buttons', s4.sent === 1 && syncCalls.length === nCalls + 1 && syncCalls[syncCalls.length - 1].body.reply_markup.inline_keyboard.length === 3);
dbSync.ledger.set('ord-s3', { status: 'sent', order_number: 13, chat_id: 111, message_id: 23, message_text: '<b>طلب</b>\n\n✅ تم تأكيد الطلب' });
const s5 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'ord-s3', status: 'completed', adminUrl: '' });
const editText3 = syncCalls.filter((c) => c.method === 'editMessageText').pop();
ok('no double banner on restamp', s5.sent === 1 && editText3.body.text.includes('📦 تم الاستلام') && !editText3.body.text.includes('تم تأكيد'));
const s6 = await syncOrderStatusToTelegram(dbSync, '', { orderId: 'ord-s1', status: 'confirmed', adminUrl: '' });
ok('sync without token skips', s6.sent === 0 && s6.reason === 'misconfigured');
globalThis.fetch = prevFetch7g;

// 8. Order keyboard: URL view + confirm/cancel + received (64-byte cap).
const kb2 = buildOrderKeyboard('https://x/admin/dashboard', oid);
ok('keyboard has view + actions + received', kb2.inline_keyboard.length === 3 && kb2.inline_keyboard[0][0].url === 'https://x/admin/dashboard');
const cbData = kb2.inline_keyboard[1].map((b) => b.callback_data);
ok('callback data fits 64 bytes', cbData.every((d) => d.length <= 64 && parseOrderCallback(d) !== null));
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
                return row ? { ...row } : null;
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
