// Phase 2+3 Telegram tests: pure-helper verification (no Workers, no D1).
// Run: npm run test:telegram  (or: node scripts/test-telegram.mjs)
// D1 SQL (pairing consume atomicity, TTL) is verified by the local migration
// apply + the manual webhook checklist in the phase report — not here.
import {
  buildDeepLink,
  buildMapsLink,
  buildOrderKeyboard,
  callTelegramApi,
  consumePairingCode,
  escapeHtml,
  formatNewOrderMessage,
  handleOrderCallback,
  isBotUsernameFormat,
  isPairingCodeFormat,
  isTelegramTransitionAllowed,
  issuePairingCode,
  listDeliveryChats,
  listOrderDeliveryMessages,
  newPairingCode,
  notifyNewOrderTelegram,
  notifyOwnerAutoCompleted,
  notifyOwnerCustomerCancelled,
  notifyOwnerOrderLocked,
  parseOrderCallback,
  readLastTelegramNotification,
  readPendingPairing,
  readyBannerFor,
  rebuildOrderMessage,
  removeDeliveryChat,
  resolveBotUsername,
  saveDeliveryLink,
  saveDeliveryMessage,
  syncOrderStatusToTelegram,
  verifyWebhookSecret,
} from '../functions/_shared/telegram.js';
import { sha256Hex } from '../functions/_shared/access.js';
import { readFileSync } from 'node:fs';

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

// 7s. Split quantities (addonQty): mixed counts show ×n, full counts plain, legacy unchanged.
{
  const splitLine = {
    id: 'd1', qty: 4, unitPrice: 60000,
    name: { ar: 'مشروب', en: 'Drink' },
    addonIds: ['pepsi-a', 'pepsi-b', 'veg'],
    addonQty: { 'pepsi-a': 2, 'pepsi-b': 2, veg: 4 },
    addonNames: [
      { ar: 'بيبسي أ', en: 'Pepsi A' },
      { ar: 'بيبسي ب', en: 'Pepsi B' },
      { ar: 'خضرة', en: 'Veg' },
    ],
  };
  const splitMsg = formatNewOrderMessage({ ...sampleCleaned, items: [splitLine] }, 2001, '');
  ok('split mixed counts show ×n', splitMsg.includes('+بيبسي أ ×') && splitMsg.includes('+بيبسي ب ×'));
  ok('split full count renders plain (no × for veg)', !splitMsg.includes('+خضرة ×') && splitMsg.includes('+خضرة'));
  // Legacy line without addonQty renders exactly as today (no per-option ×).
  const legacyLine = {
    id: 'd2', qty: 4, unitPrice: 70000,
    name: { ar: 'مشروب', en: 'Drink' },
    addonIds: ['pepsi-a', 'pepsi-b'],
    addonNames: [{ ar: 'بيبسي أ', en: 'Pepsi A' }, { ar: 'بيبسي ب', en: 'Pepsi B' }],
  };
  const legacyMsg = formatNewOrderMessage({ ...sampleCleaned, items: [legacyLine] }, 2002, '');
  ok('legacy split-less line has no count marks', legacyMsg.includes('+بيبسي أ') && !legacyMsg.includes('+بيبسي أ ×') && !legacyMsg.includes('+بيبسي ب ×'));
  // Zero-count option hidden (applies to zero units).
  const zeroLine = {
    id: 'd3', qty: 4, unitPrice: 50000,
    name: { ar: 'مشروب', en: 'Drink' },
    addonIds: ['pepsi-a', 'veg'],
    addonQty: { 'pepsi-a': 0, veg: 4 },
    addonNames: [{ ar: 'بيبسي أ', en: 'Pepsi A' }, { ar: 'خضرة', en: 'Veg' }],
  };
  const zeroMsg = formatNewOrderMessage({ ...sampleCleaned, items: [zeroLine] }, 2003, '');
  ok('zero-count option hidden', !zeroMsg.includes('بيبسي أ') && zeroMsg.includes('+خضرة'));
}

// 7f. Maps link + bidi: precise coords link, address search fallback, isolates.
const withLoc = { ...sampleCleaned, location: { lat: 33.8938, lng: 35.5018 } };
const precise = buildMapsLink(withLoc);
ok('precise maps link', precise && precise.precise === true && precise.url.includes('33.8938,35.5018'));
ok('precise link is an exact pin, not a search', precise.url.includes('maps?q=') && !precise.url.includes('search'));
ok('out-of-range coords rejected', buildMapsLink({ type: 'delivery', location: { lat: 500, lng: 10 } }) === null);
const search = buildMapsLink(sampleCleaned);
ok('address search fallback', search && search.precise === false && search.url.includes('query='));
ok('no maps link without address', buildMapsLink({ type: 'delivery' }) === null && buildMapsLink({ type: 'pickup', address: 'x' }) === null);
// Coarse fixes are NEVER presented as exact: address present -> address
// search; no address -> explicitly approximate pin.
const coarseWithAddr = buildMapsLink({ ...withLoc, location: { lat: 33.8938, lng: 35.5018, accuracy: 2500 } });
ok('coarse fix downgraded to address search', coarseWithAddr && coarseWithAddr.precise === false && coarseWithAddr.url.includes('search/?api=1'));
const coarseNoAddr = buildMapsLink({ type: 'delivery', address: '  ', location: { lat: 33.9, lng: 35.5, accuracy: 3000 } });
ok('coarse fix without address stays approximate pin', coarseNoAddr && coarseNoAddr.precise === false && coarseNoAddr.url.includes('maps?q='));
const goodAcc = buildMapsLink({ type: 'delivery', address: 'x', location: { lat: 33.9, lng: 35.5, accuracy: 30 } });
ok('good fix stays exact pin', goodAcc && goodAcc.precise === true && goodAcc.url.includes('&z=18'));
const coarseMsg = formatNewOrderMessage({ ...sampleCleaned, location: { lat: 33.9, lng: 35.5, accuracy: 3000 } }, 1001, '');
ok('coarse message warns instead of claiming exact', coarseMsg.includes('تقريبي') && !coarseMsg.includes('الموقع الدقيق'));
const locMsg = formatNewOrderMessage(withLoc, 1001, 'ل.ل');
ok('message has pretty maps anchor', locMsg.includes('الموقع الدقيق على الخريطة') && locMsg.includes('maps?q=33.8938,35.5018&amp;z=18'));
const searchMsg = formatNewOrderMessage(sampleCleaned, 1001, 'ل.ل');
ok('fallback link labeled approximate', searchMsg.includes('بحث تقريبي عن العنوان'));
ok('bidi isolates wrap numbers', [...locMsg].some((c) => c.charCodeAt(0) === 0x2066) && [...locMsg].some((c) => c.charCodeAt(0) === 0x2069));
ok('bold labels on important fields', locMsg.includes('<b>العميل:</b>') && locMsg.includes('<b>الهاتف:</b>') && locMsg.includes('<b>العنوان:</b>') && locMsg.includes('<b>الإجمالي:'));  

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
ok('transitions new->confirmed/ready/cancelled', isTelegramTransitionAllowed('new', 'confirmed') && isTelegramTransitionAllowed('new', 'ready') && isTelegramTransitionAllowed('new', 'cancelled'));
ok('transitions confirmed->ready/cancelled (+legacy completed)', isTelegramTransitionAllowed('confirmed', 'ready') && isTelegramTransitionAllowed('confirmed', 'cancelled') && isTelegramTransitionAllowed('confirmed', 'completed') && !isTelegramTransitionAllowed('confirmed', 'confirmed'));
ok('transitions ready->completed/cancelled only', isTelegramTransitionAllowed('ready', 'completed') && isTelegramTransitionAllowed('ready', 'cancelled') && !isTelegramTransitionAllowed('ready', 'confirmed') && !isTelegramTransitionAllowed('ready', 'new'));
ok('transitions terminal blocked', !isTelegramTransitionAllowed('completed', 'cancelled') && !isTelegramTransitionAllowed('cancelled', 'confirmed') && !isTelegramTransitionAllowed('completed', 'ready') && !isTelegramTransitionAllowed('cancelled', 'ready'));
ok('parse received', parseOrderCallback(`tg:rcv:${oid}`)?.status === 'completed');
ok('parse ready', JSON.stringify(parseOrderCallback(`tg:rdy:${oid}`)) === JSON.stringify({ action: 'rdy', orderId: oid, status: 'ready' }));
ok('transitions to received', isTelegramTransitionAllowed('new', 'completed') && isTelegramTransitionAllowed('confirmed', 'completed') && isTelegramTransitionAllowed('ready', 'completed') && !isTelegramTransitionAllowed('cancelled', 'completed'));

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
const confirmKb = cbCalls.filter((c) => c.method === 'editMessageReplyMarkup');
ok('confirm arms delivered keyboard in the text edit (single round-trip)', confirmKb.length === 0 && cbCalls.some((c) => c.method === 'editMessageText' && JSON.stringify(c.body.reply_markup || {}).includes('tg:rcv:ord-1')));
const stamped = cbCalls.find((c) => c.method === 'editMessageText');
ok('stamped message keeps html (links survive)', !!stamped && stamped.body.text.includes('<b>') && stamped.body.parse_mode === 'HTML');
// Rebuild from the DB row keeps the exact-pin maps link after confirm.
const rrow = {
  id: 'ord-x', number: 4242, status: 'new', type: 'delivery',
  customer_name: 'Layla', customer_phone: '70111', customer_address: '15 شارع الحمرا',
  customer_table: null, notes: null, location_lat: 33.9, location_lng: 35.5,
  items_json: '[]', subtotal: 0, delivery_fee: 0, total: 0, lang: 'ar',
};
const rebuilt = await rebuildOrderMessage(mockDb(true), undefined, rrow);
ok('rebuild keeps exact-pin maps link', !!rebuilt && rebuilt.includes('www.google.com/maps?q=33.9,35.5&amp;z=18') && rebuilt.includes('#4242'));
ok('rebuild null-safe', await rebuildOrderMessage(null, null, null) === null);
// Rebuild after Confirm must keep the picker address + delivery fee line
// (a delivery_fee/deliveryFee name mismatch used to drop the fee line).
const rrow2 = {
  id: 'ord-y', number: 4243, status: 'new', type: 'delivery',
  customer_name: 'Omar', customer_phone: '70222',
  customer_address: 'Zahle, Main Rd 12',
  customer_table: null, notes: null, location_lat: 33.9, location_lng: 35.5,
  items_json: '[]', subtotal: 350000, delivery_fee: 30000, total: 380000, lang: 'ar',
};
const rebuilt2 = await rebuildOrderMessage(mockDb(true), undefined, rrow2);
ok('rebuild keeps picker address', !!rebuilt2 && rebuilt2.includes('Zahle, Main Rd 12'));
ok('rebuild keeps delivery fee line', !!rebuilt2 && rebuilt2.includes('30,000'));
ok('confirm stamps preparing banner', !!stamped && stamped.body.text.includes('🔥 الطلب قيد التحضير'));
const repeat = await handleOrderCallback(dbNew, 'tok', { ...cbBase, callbackId: 'cb2', data: `tg:cfm:ord-1` });
ok('repeat confirm is noop', repeat.handled === true && repeat.noop === true && cbCalls.filter((c) => c.method === 'editMessageText').length === 1);
const healKb = cbCalls.filter((c) => c.method === 'editMessageReplyMarkup' && JSON.stringify(c.body.reply_markup || {}).includes('tg:rcv:ord-1'));
ok('repeat confirm re-asserts delivered keyboard (self-heal)', healKb.length >= 1);
// Lost-edit recovery: if the swap edits fail (deleted message), the DB still
// flips and the answer still clears the spinner; the NEXT tap on the stale
// buttons heals them instead of stranding them forever.
const failCalls = [];
const okMock = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const method = String(url).split('/').pop();
  failCalls.push({ method, body: JSON.parse(init.body) });
  if (method === 'editMessageText' || method === 'editMessageReplyMarkup') {
    return { ok: false, status: 400, json: async () => ({ ok: false, error_code: 400, description: 'Bad Request: message to edit not found' }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
};
const dbFail = orderDb(true, 'new');
const rFail = await handleOrderCallback(dbFail, 'tok', { ...cbBase, callbackId: 'cbF1', data: 'tg:cfm:ord-1' });
ok('confirm survives lost message edit', rFail.handled === true && rFail.status === 'confirmed' && dbFail.orders.get('ord-1').status === 'confirmed');
const rHeal = await handleOrderCallback(dbFail, 'tok', { ...cbBase, callbackId: 'cbF2', data: 'tg:cfm:ord-1' });
ok(
  'repeat tap re-asserts delivered keyboard after lost edit',
  rHeal.handled === true && failCalls.some((c) => c.method === 'editMessageReplyMarkup' && JSON.stringify(c.body.reply_markup || {}).includes('tg:rcv:ord-1')),
);
// 'message is not modified' means already converged — benign, never an error.
globalThis.fetch = async (url, init) => {
  const method = String(url).split('/').pop();
  if (method === 'editMessageText' || method === 'editMessageReplyMarkup') {
    return { ok: false, status: 400, json: async () => ({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
};
const rBenign = await handleOrderCallback(orderDb(true, 'new'), 'tok', { ...cbBase, callbackId: 'cbF3', data: 'tg:cfm:ord-1' });
ok('not-modified edit treated as converged', rBenign.handled === true && rBenign.status === 'confirmed');
globalThis.fetch = okMock;
const badTrans = await handleOrderCallback(orderDb(true, 'completed'), 'tok', { ...cbBase, callbackId: 'cb3', data: `tg:cfm:ord-1` });
ok('terminal order rejected', badTrans.handled === false && badTrans.reason === 'bad_transition');
const unlinked = await handleOrderCallback(orderDb(false), 'tok', { ...cbBase, callbackId: 'cb4', data: `tg:cfm:ord-1` });
ok('stranger click rejected', unlinked.reason === 'unauthorized');
const forged = await handleOrderCallback(orderDb(true), 'tok', { ...cbBase, callbackId: 'cb5', data: 'tg:done:ord-1' });
ok('forged data rejected', forged.reason === 'bad_data');
// Frozen step: legacy in-flight tg:rdy buttons no longer move orders —
// they answer with a modal alert and strip the dead buttons. The order
// row is untouched. Legacy `ready` ROWS still complete via rcv (seeded
// directly below since no press can create one anymore).
const dbReady = orderDb(true, 'confirmed');
const nCallsBeforeReady = cbCalls.length;
const ready = await handleOrderCallback(dbReady, 'tok', { ...cbBase, callbackId: 'cbR1', data: `tg:rdy:ord-1` });
const readyCalls = cbCalls.slice(nCallsBeforeReady);
const readyAnswer = readyCalls.find((c) => c.method === 'answerCallbackQuery');
ok('stale rdy is frozen (deprecated)', ready.handled === false && ready.reason === 'deprecated' && dbReady.orders.get('ord-1').status === 'confirmed');
ok('freeze answers with modal alert', !!readyAnswer && readyAnswer.body.show_alert === true && readyAnswer.body.cache_time === 0 && String(readyAnswer.body.text || '').includes('لوحة التحكم'));
const readyStrip = readyCalls.find((c) => c.method === 'editMessageReplyMarkup');
ok('freeze strips the dead buttons', !!readyStrip && Array.isArray(readyStrip.body.reply_markup.inline_keyboard) && readyStrip.body.reply_markup.inline_keyboard.length === 0);
ok('freeze stamps no banner', !readyCalls.some((c) => c.method === 'editMessageText'));
const readyAgain = await handleOrderCallback(dbReady, 'tok', { ...cbBase, callbackId: 'cbR2', data: `tg:rdy:ord-1` });
ok('repeat rdy stays frozen', readyAgain.handled === false && readyAgain.reason === 'deprecated');
dbReady.orders.get('ord-1').status = 'ready';
const readyDone = await handleOrderCallback(dbReady, 'tok', { ...cbBase, callbackId: 'cbR3', data: `tg:rcv:ord-1` });
ok('ready completes via legacy rcv', readyDone.handled === true && readyDone.status === 'completed' && dbReady.orders.get('ord-1').status === 'completed');
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
ok('sync stamps banner', s1.sent === 1 && editText && editText.body.text.includes('🔥 الطلب قيد التحضير') && editText.body.text.includes('#11'));
ok(
  'sync text edit carries keyboard (atomic, no wipe)',
  !!editText && JSON.stringify(editText.body.reply_markup || {}).includes('tg:rcv:ord-s1')
);
ok(
  'sync keeps delivered buttons on confirm (no freeze)',
  syncCalls.some(
    (c) => c.method === 'editMessageReplyMarkup' && JSON.stringify(c.body.reply_markup).includes('tg:rcv:ord-s1')
  )
);
const s2 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'missing', status: 'confirmed', adminUrl: '' });
ok('sync skips unknown order silently', s2.sent === 0 && s2.reason === 'no_message');
dbSync.ledger.set('ord-s2', { status: 'sent', order_number: 12, chat_id: null, message_id: null, message_text: null });
const s3 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'ord-s2', status: 'cancelled', adminUrl: '' });
ok('sync skips pre-0015 rows silently', s3.sent === 0 && s3.reason === 'no_message');
const nCalls = syncCalls.length;
const s4 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'ord-s1', status: 'new', adminUrl: 'https://x/admin/dashboard' });
ok('reopen restores buttons', s4.sent === 1 && syncCalls.length === nCalls + 1 && syncCalls[syncCalls.length - 1].body.reply_markup.inline_keyboard.length === 2);
dbSync.ledger.set('ord-s3', { status: 'sent', order_number: 13, chat_id: 111, message_id: 23, message_text: '<b>طلب</b>\n\n✅ تم تأكيد الطلب' });
const s5 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'ord-s3', status: 'completed', adminUrl: '' });
const editText3 = syncCalls.filter((c) => c.method === 'editMessageText').pop();
ok('no double banner on restamp', s5.sent === 1 && editText3.body.text.includes('📦 تم الاستلام') && !editText3.body.text.includes('قيد التحضير') && !editText3.body.text.includes('تم تأكيد'));
const freezeTerminal = syncCalls.filter((c) => c.method === 'editMessageReplyMarkup').pop();
ok('terminal still freezes buttons', !!freezeTerminal && freezeTerminal.body.reply_markup.inline_keyboard.length === 0);
dbSync.ledger.set('ord-r1', { status: 'sent', order_number: 14, chat_id: 111, message_id: 26, message_text: '<b>طلب #14</b>\n\n🔥 الطلب قيد التحضير' });
const sR = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'ord-r1', status: 'ready', adminUrl: 'https://x/admin/dashboard' });
const editTextR = syncCalls.filter((c) => c.method === 'editMessageText').pop();
ok('sync ready stamps out-for-delivery banner, old one cleared', sR.sent === 1 && editTextR.body.text.includes('🛵 الطلب خارج للتوصيل') && !editTextR.body.text.includes('قيد التحضير'));
ok(
  'sync keeps delivered buttons on ready (no freeze)',
  syncCalls.some(
    (c) => c.method === 'editMessageReplyMarkup' && JSON.stringify(c.body.reply_markup).includes('tg:rcv:ord-r1')
  )
);
dbSync.ledger.set('ord-r2', { status: 'sent', order_number: 16, chat_id: 111, message_id: 27, message_text: '<b>طلب #16</b>\n\n🛵 الطلب خارج للتوصيل' });
const sR2 = await syncOrderStatusToTelegram(dbSync, 'tok', { orderId: 'ord-r2', status: 'completed', adminUrl: '' });
const editTextR2 = syncCalls.filter((c) => c.method === 'editMessageText').pop();
ok('re-stamp after ready clears ready banner', sR2.sent === 1 && editTextR2.body.text.includes('📦 تم الاستلام') && !editTextR2.body.text.includes('خارج للتوصيل'));
const s6 = await syncOrderStatusToTelegram(dbSync, '', { orderId: 'ord-s1', status: 'confirmed', adminUrl: '' });
ok('sync without token skips', s6.sent === 0 && s6.reason === 'misconfigured');
globalThis.fetch = prevFetch7g;

// 7h. Owner ping on system auto-complete.
const autoCalls = [];
globalThis.fetch = async (url, init) => {
  autoCalls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
};
const dbAuto = mockDb(true);
const ac1 = await notifyOwnerAutoCompleted(dbAuto, 'tok', { orderNumber: 42, customerName: 'Samir <x>' });
ok('auto-complete ping sent', ac1.sent === 1 && autoCalls.length === 1 && autoCalls[0].body.text.includes('#42') && !autoCalls[0].body.text.includes('<x>'));
ok('auto-complete ping goes to linked chat', autoCalls[0].body.chat_id === 12345);
const ac2 = await notifyOwnerAutoCompleted(mockDb(false), 'tok', { orderNumber: 42, customerName: 'X' });
ok('auto-complete ping skips unlinked', ac2.sent === 0 && ac2.reason === 'unlinked');
const ac3 = await notifyOwnerAutoCompleted(dbAuto, '', { orderNumber: 42, customerName: 'X' });
ok('auto-complete ping needs token', ac3.sent === 0);
globalThis.fetch = prevFetch7g;

// 7i. Owner pings for customer cancel + lock expiry.
const cxCalls = [];
globalThis.fetch = async (url, init) => {
  cxCalls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
};
const dbCx = mockDb(true);
const cx1 = await notifyOwnerCustomerCancelled(dbCx, 'tok', { orderNumber: 55, customerName: 'Layla <x>' });
ok('cancel ping sent', cx1.sent === 1 && cxCalls.length === 1 && cxCalls[0].body.chat_id === 12345 && cxCalls[0].body.text.includes('#55') && !cxCalls[0].body.text.includes('<x>'));
const cx2 = await notifyOwnerCustomerCancelled(mockDb(false), 'tok', { orderNumber: 55, customerName: 'X' });
ok('cancel ping skips unlinked', cx2.sent === 0 && cx2.reason === 'unlinked');
const cx3 = await notifyOwnerCustomerCancelled(dbCx, '', { orderNumber: 55, customerName: 'X' });
ok('cancel ping needs token', cx3.sent === 0);
const lk1 = await notifyOwnerOrderLocked(dbCx, 'tok', { orderNumber: 77, customerName: 'Ali' });
ok('lock ping sent', lk1.sent === 1 && cxCalls.length === 2 && cxCalls[1].body.text.includes('#77'));
const lk2 = await notifyOwnerOrderLocked(dbCx, 'tok', { orderNumber: NaN, customerName: 'Ali' });
ok('lock ping rejects bad order', lk2.sent === 0);
globalThis.fetch = prevFetch7g;

// 8. Order keyboard: URL view + owner-confirms-receipt (confirmed) + cancel.
const kb2 = buildOrderKeyboard('https://x/admin/dashboard', oid);
ok('keyboard has view + confirm + cancel', kb2.inline_keyboard.length === 2 && kb2.inline_keyboard[0][0].url === 'https://x/admin/dashboard');
ok('confirm means preparing, not delivered', JSON.stringify(kb2).includes(`tg:cfm:${oid}`) && !JSON.stringify(kb2).includes('tg:rcv:') && parseOrderCallback(`tg:cfm:${oid}`)?.status === 'confirmed');
ok('confirm button reads preparing', kb2.inline_keyboard[1][0].text.includes('التحضير') && kb2.inline_keyboard[1][0].callback_data === `tg:cfm:${oid}`);
// Old in-flight tg:rcv callbacks still complete (never attached to new messages).
ok('legacy rcv callback still completes', parseOrderCallback(`tg:rcv:${oid}`)?.status === 'completed');
const cbData = kb2.inline_keyboard[1].map((b) => b.callback_data);
ok('callback data fits 64 bytes', cbData.every((d) => d.length <= 64 && parseOrderCallback(d) !== null));
const kb = buildOrderKeyboard('https://example.com/admin/dashboard');
ok(
  'keyboard url button',
  kb.inline_keyboard[0][0].url === 'https://example.com/admin/dashboard' &&
    typeof kb.inline_keyboard[0][0].text === 'string'
);
const kbReady = buildOrderKeyboard('https://x/admin/dashboard', oid, 'confirmed');
const kbReadyCbs = kbReady.inline_keyboard.flat().map((b) => b.callback_data || '');
ok(
  'confirmed keyboard offers delivered + cancel only',
  kbReadyCbs.includes(`tg:rcv:${oid}`) &&
    kbReadyCbs.includes(`tg:cnl:${oid}`) &&
    !kbReadyCbs.some((d) => (d || '').startsWith('tg:cfm:')) &&
    !kbReadyCbs.some((d) => (d || '').startsWith('tg:rdy:'))
);
const kbNoAdmin = buildOrderKeyboard('', oid, 'confirmed');
ok(
  'keyboard without admin url omits view row',
  kbNoAdmin.inline_keyboard.length === 1 && kbNoAdmin.inline_keyboard[0].length === 2
);
ok('readyBannerFor respects order type', readyBannerFor('delivery').includes('خارج للتوصيل') && readyBannerFor('pickup').includes('جاهز للاستلام') && readyBannerFor('dinein').includes('جاهز للاستلام'));

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

// 11. Migration 0026 (delivery-crew sharing) ships the new tables + role column.
{
  const sql26 = readFileSync(new URL('../migrations/0026_telegram_delivery.sql', import.meta.url), 'utf8');
  ok('0026 creates telegram_chats', sql26.includes('CREATE TABLE') && sql26.includes('telegram_chats'));
  ok('0026 creates telegram_order_chats', sql26.includes('telegram_order_chats'));
  ok('0026 adds pairing role column', sql26.includes('ADD COLUMN role') && sql26.includes("DEFAULT 'owner'"));
}

// 12. Pairing codes carry role (owner default, delivery opt-in).
function mockRoleDb() {
  const codes = new Map();
  return {
    codes,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes('INSERT INTO telegram_pairing_codes')) {
                const role = args.length >= 4 ? args[3] : 'owner';
                codes.set(args[0], { code_hash: args[0], created_at: args[1], expires_at: args[2], used_at: null, consumed_by_chat: null, role });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE telegram_pairing_codes SET used_at')) {
                const row = codes.get(args[0]);
                if (!row || row.used_at) return { meta: { changes: 0 } };
                if (!(row.expires_at > args[1])) return { meta: { changes: 0 } };
                row.used_at = args[1];
                row.consumed_by_chat = args[2];
                return { meta: { changes: 1 } };
              }
              if (sql.includes('DELETE FROM telegram_pairing_codes')) return { meta: { changes: 0 } };
              return { meta: { changes: 0 } };
            },
            async first() {
              if (sql.includes('SELECT role FROM telegram_pairing_codes')) {
                const row = codes.get(args[0]);
                return row ? { role: row.role } : null;
              }
              if (sql.includes('SELECT COUNT(*)')) return { n: 0, exp: null };
              return null;
            },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
}
{
  const dbOwner = mockRoleDb();
  const issuedOwner = await issuePairingCode(dbOwner);
  ok('owner issue defaults to owner role', issuedOwner && issuedOwner.role === 'owner' && typeof issuedOwner.code === 'string');
  const consumedOwner = await consumePairingCode(dbOwner, issuedOwner.code, 111);
  ok('owner consume returns owner role', !!consumedOwner && consumedOwner.role === 'owner');
  const dbCrew = mockRoleDb();
  const issuedCrew = await issuePairingCode(dbCrew, 'delivery');
  ok('delivery issue carries delivery role', issuedCrew && issuedCrew.role === 'delivery');
  const consumedCrew = await consumePairingCode(dbCrew, issuedCrew.code, 222);
  ok('delivery consume returns delivery role', !!consumedCrew && consumedCrew.role === 'delivery');
  const badConsume = await consumePairingCode(dbCrew, issuedCrew.code, 333);
  ok('reused code rejected (no oracle)', badConsume === false);
}

// 13. Delivery-chat CRUD round-trip (best-effort, never throws).
function mockDeliveryStore({ linked = true } = {}) {
  const chats = new Map();
  const orderChats = new Map();
  const ledger = new Map();
  const orders = new Map();
  const pairing = new Map();
  return {
    chats,
    orderChats,
    ledger,
    orders,
    pairing,
    prepare(sql) {
      const self = this;
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes('INSERT OR REPLACE INTO telegram_chats')) {
                chats.set(args[0], { chat_id: args[0], role: args[1], label: args[2], linked_at: args[3] });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('DELETE FROM telegram_chats')) {
                chats.delete(args[0]);
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INSERT INTO telegram_order_chats')) {
                orderChats.set(`${args[0]}:${args[1]}`, { order_id: args[0], chat_id: args[1], message_id: args[2], message_text: args[3], status: args[4] });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INSERT INTO telegram_notifications')) {
                if (!ledger.has(args[0])) ledger.set(args[0], { status: 'pending', attempts: 0, order_number: args[1] });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE telegram_notifications')) {
                const row = ledger.get(args[0]) || {};
                ledger.set(args[0], { ...row, status: args[1], attempts: args[2], last_error: args[3] });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INSERT INTO telegram_pairing_codes')) {
                const role = args.length >= 4 ? args[3] : 'owner';
                pairing.set(args[0], { code_hash: args[0], created_at: args[1], expires_at: args[2], used_at: null, consumed_by_chat: null, role });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE telegram_pairing_codes SET used_at')) {
                const row = pairing.get(args[0]);
                if (!row || row.used_at) return { meta: { changes: 0 } };
                if (!(row.expires_at > args[1])) return { meta: { changes: 0 } };
                row.used_at = args[1];
                row.consumed_by_chat = args[2];
                return { meta: { changes: 1 } };
              }
              if (sql.includes('DELETE FROM telegram_pairing_codes')) return { meta: { changes: 0 } };
              if (sql.includes('UPDATE orders SET status')) {
                const row = orders.get(args[2]);
                if (!row) return { meta: { changes: 0 } };
                row.status = args[0];
                row.updated_at = args[1];
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE orders SET confirmed_at') || sql.includes('confirmed_at')) return { meta: { changes: 1 } };
              return { meta: { changes: 0 } };
            },
            async first() {
              if (sql.includes('SELECT role FROM telegram_pairing_codes')) {
                const row = pairing.get(args[0]);
                return row ? { role: row.role } : null;
              }
              if (sql.includes('SELECT COUNT(*)') && sql.includes('telegram_pairing_codes')) return { n: 0, exp: null };
              if (sql.includes('SELECT COUNT(*) AS c FROM orders')) return { c: 0 };
              if (sql.includes('FROM telegram_notifications') && sql.includes('order_id')) {
                const row = ledger.get(args[0]);
                return row ? { ...row } : null;
              }
              if (sql.includes('SELECT value FROM service_config')) {
                return linked ? { value: JSON.stringify({ chat_id: 12345, linked_at: '2026-01-01' }) } : null;
              }
              if (sql.includes('FROM orders WHERE id')) {
                return orders.get(args[0]) || null;
              }
              if (sql.includes('SELECT order_number')) {
                const rows = [...ledger.entries()];
                if (!rows.length) return null;
                const r = rows[rows.length - 1][1];
                return { order_number: r.order_number, status: r.status, attempts: r.attempts, updated_at: 't', sent_at: null };
              }
              return null;
            },
            async all() {
              if (sql.includes('FROM telegram_chats')) {
                return { results: [...chats.values()].filter((r) => r.role === 'delivery').map((r) => ({ chat_id: r.chat_id, label: r.label, linked_at: r.linked_at })) };
              }
              if (sql.includes('FROM telegram_order_chats')) {
                return { results: [...orderChats.values()].filter((r) => r.order_id === args[0]).map((r) => ({ chat_id: r.chat_id, message_id: r.message_id, message_text: r.message_text, status: r.status })) };
              }
              if (sql.includes('FROM orders WHERE')) return { results: [] };
              return { results: [] };
            },
          };
        },
      };
    },
  };
}
{
  const db = mockDeliveryStore({ linked: true });
  ok('delivery list empty initially', (await listDeliveryChats(db)).length === 0);
  ok('save delivery link', await saveDeliveryLink(db, 777, 'Crew One') === true);
  ok('save second delivery link', await saveDeliveryLink(db, 888) === true);
  const chats = await listDeliveryChats(db);
  ok('delivery list has two chats', chats.length === 2 && chats.some((c) => c.chatId === 777 && c.label === 'Crew One') && chats.some((c) => c.chatId === 888));
  ok('remove delivery chat', await removeDeliveryChat(db, 777) === true);
  const after = await listDeliveryChats(db);
  ok('delivery remove drops only that chat', after.length === 1 && after[0].chatId === 888);
  ok('save delivery message', await saveDeliveryMessage(db, { orderId: 'o-1', chatId: 888, messageId: 5, messageText: '<b>hi</b>', status: 'sent' }) === true);
  const copies = await listOrderDeliveryMessages(db, 'o-1');
  ok('list delivery copies', copies.length === 1 && copies[0].chatId === 888 && copies[0].messageId === 5);
  ok('list empty for unknown order', (await listOrderDeliveryMessages(db, 'nope')).length === 0);
  ok('delivery helpers never throw on null db', (await listDeliveryChats(null)).length === 0 && (await listOrderDeliveryMessages(null, 'x')).length === 0);
}

// 14. Delivery fan-out: owner send unchanged + crew copies without admin-url row.
{
  const prev = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ method: String(url).split('/').pop(), body });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 100 + sent.length } }) };
  };
  const db = mockDeliveryStore({ linked: true });
  await saveDeliveryLink(db, 777);
  await saveDeliveryLink(db, 888);
  const r = await notifyNewOrderTelegram(db, 'tok', {
    orderId: 'ord-fan', orderNumber: 2001, cleaned: sampleCleaned, storeName: 'مطعم', currency: 'ل.ل', adminUrl: 'https://x/admin/dashboard',
  });
  const sends = sent.filter((c) => c.method === 'sendMessage');
  const ownerSend = sends.find((c) => c.body.chat_id === 12345);
  const crewSends = sends.filter((c) => c.body.chat_id === 777 || c.body.chat_id === 888);
  ok('fan-out sends owner + 2 crew', r.sent === 1 && sends.length === 3 && !!ownerSend && crewSends.length === 2);
  ok('owner keeps admin-url view row', !!ownerSend && JSON.stringify(ownerSend.body.reply_markup).includes('https://x/admin/dashboard'));
  ok(
    'crew copies have no admin-url row (confirm+cancel only)',
    crewSends.every((c) => !JSON.stringify(c.body.reply_markup).includes('https://x/admin') && JSON.stringify(c.body.reply_markup).includes('tg:cfm:ord-fan'))
  );
  ok(
    'crew copies share owner text',
    crewSends.every((c) => c.body.text === ownerSend.body.text && c.body.text.includes('#2001'))
  );
  const stored = await listOrderDeliveryMessages(db, 'ord-fan');
  ok('crew copies recorded in ledger', stored.length === 2 && stored.every((s) => typeof s.messageId === 'number'));
  globalThis.fetch = prev;
}

// 15. Delivery-chat callback auth: crew allowed, stranger rejected.
{
  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: true }) });
  const mkOrder = (db) => {
    db.orders.set('ord-d1', {
      id: 'ord-d1', number: 3001, status: 'new', type: 'delivery',
      customer_name: 'Ali', customer_phone: '96170', customer_address: null, customer_table: null,
      notes: null, location_lat: null, location_lng: null,
      items_json: '[]', subtotal: 100, delivery_fee: 0, total: 100, lang: 'ar',
      track_token: 't'.repeat(32), created_at: 't', updated_at: 't',
    });
  };
  const dbCrewOnly = mockDeliveryStore({ linked: false });
  mkOrder(dbCrewOnly);
  await saveDeliveryLink(dbCrewOnly, 777);
  const allowed = await handleOrderCallback(dbCrewOnly, 'tok', {
    callbackId: 'cb-d1', clickerId: 777, chatId: 777, messageId: 11, data: 'tg:cfm:ord-d1', messageText: 'order', env: {},
  });
  ok('delivery chat click allowed', allowed.handled === true && allowed.status === 'confirmed' && dbCrewOnly.orders.get('ord-d1').status === 'confirmed');
  const copiesAfter = await listOrderDeliveryMessages(dbCrewOnly, 'ord-d1');
  ok('delivery tap heals crew copy (not owner ledger)', copiesAfter.length === 1 && copiesAfter[0].chatId === 777);
  const stranger = await handleOrderCallback(dbCrewOnly, 'tok', {
    callbackId: 'cb-d2', clickerId: 999, chatId: 999, messageId: 12, data: 'tg:cfm:ord-d1', messageText: 'order', env: {},
  });
  ok('stranger chat rejected', stranger.handled === false && stranger.reason === 'unauthorized');
  const mismatched = await handleOrderCallback(dbCrewOnly, 'tok', {
    callbackId: 'cb-d3', clickerId: 777, chatId: 888, messageId: 13, data: 'tg:cnl:ord-d1', messageText: 'order', env: {},
  });
  ok('clicker/chat mismatch rejected', mismatched.handled === false && mismatched.reason === 'unauthorized');
  globalThis.fetch = prev;
}

// 16. Sync mirrors banner+keyboard to delivery copies (no admin-url row).
{
  const prev = globalThis.fetch;
  const callsSync = [];
  globalThis.fetch = async (url, init) => {
    callsSync.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  };
  const db = mockDeliveryStore({ linked: true });
  db.ledger.set('ord-m1', { status: 'sent', order_number: 4001, chat_id: 111, message_id: 22, message_text: '<b>طلب جديد #4001</b>' });
  await saveDeliveryMessage(db, { orderId: 'ord-m1', chatId: 777, messageId: 33, messageText: '<b>طلب جديد #4001</b>', status: 'sent' });
  const s = await syncOrderStatusToTelegram(db, 'tok', { orderId: 'ord-m1', status: 'confirmed', adminUrl: 'https://x/admin/dashboard' });
  const ownerKb = callsSync.find((c) => c.method === 'editMessageReplyMarkup' && c.body.chat_id === 111);
  const crewKb = callsSync.find((c) => c.method === 'editMessageReplyMarkup' && c.body.chat_id === 777);
  const crewText = callsSync.find((c) => c.method === 'editMessageText' && c.body.chat_id === 777);
  ok('sync mirrors confirmed to crew', s.sent === 1 && !!crewText && crewText.body.text.includes('🔥 الطلب قيد التحضير'));
  ok('owner confirm keeps admin view row', !!ownerKb && JSON.stringify(ownerKb.body.reply_markup).includes('https://x/admin/dashboard') && JSON.stringify(ownerKb.body.reply_markup).includes('tg:rcv:ord-m1'));
  ok('crew confirm has delivered buttons without admin row', !!crewKb && JSON.stringify(crewKb.body.reply_markup).includes('tg:rcv:ord-m1') && !JSON.stringify(crewKb.body.reply_markup).includes('https://x/admin'));
  // Terminal still freezes both.
  callsSync.length = 0;
  const t = await syncOrderStatusToTelegram(db, 'tok', { orderId: 'ord-m1', status: 'completed', adminUrl: 'https://x/admin/dashboard' });
  const frozen = callsSync.filter((c) => c.method === 'editMessageReplyMarkup');
  ok('terminal freezes owner + crew', t.sent === 1 && frozen.length === 2 && frozen.every((c) => c.body.reply_markup.inline_keyboard.length === 0));
  globalThis.fetch = prev;
}

// 17. Admin delivery-code / delivery-remove + GET deliveryChats.
{
  const { onRequest: adminTelegram } = await import('../functions/api/admin/telegram.js');
  const AH = { 'X-Requested-With': 'menu-admin', Origin: 'https://x' };
  const envBase = (db) => ({ ORDERS_DB: db, SITE_PLAN: 'pro', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_WEBHOOK_SECRET: 's', TELEGRAM_BOT_USERNAME: 'TestBot123' });
  const db = mockDeliveryStore({ linked: true });
  const codeReq = new Request('https://x/api/admin/telegram', {
    method: 'POST',
    headers: { ...AH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delivery-code' }),
  });
  const codeRes = await adminTelegram({ request: codeReq, env: envBase(db) });
  const codeBody = await codeRes.json().catch(() => null);
  ok('admin delivery-code issues crew code', codeRes.status === 200 && !!codeBody && codeBody.ok === true && typeof codeBody.code === 'string' && typeof codeBody.deepLink === 'string' && codeBody.deepLink.includes('https://t.me/TestBot123'));
  // Consume it as crew to prove the role survived the admin path.
  const crewCode = codeBody.code;
  const { sha256Hex: sha } = await import('../functions/_shared/access.js');
  const h = await sha(crewCode);
  const storedRole = db.pairing.get(h);
  ok('delivery code stored with delivery role', !!storedRole && storedRole.role === 'delivery');
  await saveDeliveryLink(db, 555, 'Crew Van');
  const getReq = new Request('https://x/api/admin/telegram', { headers: AH });
  const getRes = await adminTelegram({ request: getReq, env: envBase(db) });
  const getBody = await getRes.json().catch(() => null);
  ok('admin GET includes deliveryChats', getRes.status === 200 && !!getBody && Array.isArray(getBody.deliveryChats) && getBody.deliveryChats.some((c) => c.chatId === 555));
  const rmReq = new Request('https://x/api/admin/telegram', {
    method: 'POST',
    headers: { ...AH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delivery-remove', chatId: 555 }),
  });
  const rmRes = await adminTelegram({ request: rmReq, env: envBase(db) });
  const rmBody = await rmRes.json().catch(() => null);
  ok('admin delivery-remove drops chat', rmRes.status === 200 && !!rmBody && rmBody.ok === true);
  const getRes2 = await adminTelegram({ request: getReq, env: envBase(db) });
  const getBody2 = await getRes2.json().catch(() => null);
  ok('delivery chat gone after remove', !!getBody2 && Array.isArray(getBody2.deliveryChats) && !getBody2.deliveryChats.some((c) => c.chatId === 555));
  const badRmReq = new Request('https://x/api/admin/telegram', {
    method: 'POST',
    headers: { ...AH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delivery-remove', chatId: 'nope' }),
  });
  const badRmRes = await adminTelegram({ request: badRmReq, env: envBase(db) });
  ok('delivery-remove rejects bad chat id', badRmRes.status === 400);
}

// 18. Joint receipt on Telegram: one "تم التسليم" tap completes the pair.
{
  const prev = globalThis.fetch;
  const tgCalls = [];
  globalThis.fetch = async (url, init) => {
    tgCalls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  };
  const mkRow = (id, number, status, parentNumber) => ({
    id, number, status, type: 'delivery',
    customer_name: 'Karim', customer_phone: '96170', customer_address: null, customer_table: null,
    notes: null, location_lat: null, location_lng: null,
    items_json: '[]', subtotal: 100, delivery_fee: 0, total: 100, lang: 'ar',
    track_token: 't'.repeat(32), created_at: 't', updated_at: 't',
    parent_number: parentNumber ?? null,
  });
  const orders = new Map([
    ['ord-p', mkRow('ord-p', 1001, 'confirmed', null)],
    ['ord-c', mkRow('ord-c', 1002, 'confirmed', 1001)],
  ]);
  const base = mockDb(true);
  const db = {
    ledger: base.ledger,
    orders,
    prepare(sql) {
      return {
        first(...a) { return this.bind(...a).first(...a); },
        run(...a) { return this.bind(...a).run(...a); },
        all(...a) { return this.bind(...a).all(...a); },
        bind(...args) {
          return {
            async first() {
              if (sql.includes('FROM orders WHERE id')) return orders.get(args[0]) || null;
              if (sql.includes('FROM orders WHERE number')) {
                for (const r of orders.values()) if (r.number === args[0]) return { ...r };
                return null;
              }
              return base.prepare(sql).bind(...args).first();
            },
            async run() {
              if (sql.includes('UPDATE orders SET status') && !sql.includes('RETURNING')) {
                const row = orders.get(args[2]);
                if (!row) return { meta: { changes: 0 } };
                row.status = args[0];
                return { meta: { changes: 1 } };
              }
              return base.prepare(sql).bind(...args).run();
            },
            async all() {
              if (sql.includes('parent_number IN')) {
                const nums = new Set(args);
                return { results: [...orders.values()].filter((r) => nums.has(r.parent_number)) };
              }
              if (sql.includes('RETURNING')) {
                const nums = new Set(args.slice(1));
                const out = [];
                for (const r of orders.values()) {
                  if (nums.has(r.number) && (r.status === 'confirmed' || r.status === 'ready')) {
                    r.status = 'completed';
                    out.push({ number: r.number });
                  }
                }
                return { results: out };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
  const r = await handleOrderCallback(db, 'tok', { callbackId: 'cbJ1', clickerId: 12345, chatId: 12345, messageId: 11, messageText: 'parent', data: 'tg:rcv:ord-p' });
  ok('telegram joint receipt handled', r.handled === true && r.status === 'completed');
  ok('telegram joint receipt flips both rows', db.orders.get('ord-p').status === 'completed' && db.orders.get('ord-c').status === 'completed');
  const jointToast = tgCalls.find((c) => c.method === 'answerCallbackQuery' && typeof c.body.text === 'string' && c.body.text.includes('الطلبات'));
  ok('telegram joint receipt names both orders', !!jointToast && jointToast.body.text.includes('#1001') && jointToast.body.text.includes('#1002'));
  // A `new` sibling stays for the kitchen (same gate as website + admin).
  db.orders.get('ord-c').status = 'new';
  db.orders.get('ord-p').status = 'confirmed';
  tgCalls.length = 0;
  const r2 = await handleOrderCallback(db, 'tok', { callbackId: 'cbJ2', clickerId: 12345, chatId: 12345, messageId: 11, messageText: 'parent', data: 'tg:rcv:ord-p' });
  ok('new sibling not flipped by telegram receipt', r2.handled === true && db.orders.get('ord-p').status === 'completed' && db.orders.get('ord-c').status === 'new');
  globalThis.fetch = prev;
}

console.log(`telegram: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
