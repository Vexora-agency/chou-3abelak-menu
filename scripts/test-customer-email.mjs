// Customer order-status email tests: validate + notify helper (no network).
// Run: node scripts/test-customer-email.mjs
import { readFileSync } from 'node:fs';
import { validateOrderInput, mapOrderRow } from '../functions/_shared/orders.js';
import { notifyCustomerOrderEvent } from '../functions/_shared/customer-email.js';
import { buildOrderEmail } from '../functions/_shared/order-emails.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();

const MENU_BASE = {
  version: 3,
  schemaVersion: 2,
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    name: { en: 'Test Store', ar: 'متجر' },
    currency: { en: 'LBP', ar: 'ل.ل' },
    ordering: { enabled: true, types: ['delivery'] },
    notifications: {
      senderName: 'My Sender',
      replyTo: '',
      events: { placed: true, confirmed: true, completed: true, cancelled: true },
    },
  },
  categories: [{ id: 'c1', name: { en: 'Pies', ar: 'فطائر' }, visible: true }],
  items: [{
    id: 'zaatar', categoryId: 'c1', name: { en: 'Zaatar', ar: 'زعتر' },
    description: { en: '', ar: '' },
    pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 100000 },
    addons: [], badges: [], featured: false, available: true,
  }],
};

function bodyWithEmail(email) {
  const customer = { name: 'John Doe', phone: '70123456', address: 'Hamra' };
  if (email !== undefined) customer.email = email;
  // Delivery requires a freshly picked pin every order (never remembered).
  return { type: 'delivery', customer, items: [{ id: 'zaatar', qty: 1 }], lang: 'en', location: { lat: 33.8938, lng: 35.5018, accuracy: 30 } };
}

function menuWithNotifications(notif) {
  const m = JSON.parse(JSON.stringify(MENU_BASE));
  if (notif === null) {
    delete m.settings.notifications;
  } else if (notif !== undefined) {
    m.settings.notifications = notif;
  }
  return m;
}

function kvWithMenu(menu) {
  return { async get(k, opts) { return k === 'menu' ? menu : null; } };
}

function envWithMenu(menu, extra) {
  return {
    MENU_KV: kvWithMenu(menu),
    RESEND_API_KEY: 'test-key',
    MAIL_FROM_DOMAIN_EMAIL: 'orders@example.com',
    ...(extra || {}),
  };
}

function orderRow(num, email, extra) {
  return {
    id: `o${num}`, number: num, created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z', status: 'new', type: 'delivery',
    customer_name: 'John', customer_phone: '70123456', customer_email: email,
    customer_address: 'Hamra', customer_table: null, notes: null,
    location_lat: null, location_lng: null, items_json: '[]',
    subtotal: 100, delivery_fee: 0, total: 100, lang: 'en',
    track_token: 'a'.repeat(32), parent_number: null,
    ...(extra || {}),
  };
}

/* ---------------- (0) migration file ---------------- */
{
  const sql = readFileSync(new URL('../migrations/0024_customer_email.sql', import.meta.url), 'utf8');
  ok(sql.includes('ALTER TABLE orders ADD COLUMN customer_email TEXT'), 'migration adds customer_email');
}

/* ---------------- (a) validate accepts / rejects / normalizes ---------------- */
{
  const good = validateOrderInput(bodyWithEmail('  Mina@Example.COM  '), MENU_BASE);
  ok(good.ok === true, 'valid email keeps order ok');
  ok(good.cleaned && good.cleaned.email === 'mina@example.com', 'email trimmed + lowercased');

  const bad = validateOrderInput(bodyWithEmail('not-an-email'), MENU_BASE);
  ok(bad.ok === true, 'invalid email does not fail the order');
  ok(bad.cleaned && bad.cleaned.email === '', 'invalid email reads as empty');

  const missing = validateOrderInput(bodyWithEmail(undefined), MENU_BASE);
  ok(missing.ok === true, 'missing email does not fail the order');
  ok(missing.cleaned && missing.cleaned.email === '', 'missing email reads as empty');

  const badTld = validateOrderInput(bodyWithEmail('a@b.c'), MENU_BASE);
  ok(badTld.ok === true && badTld.cleaned.email === '', 'single-char TLD rejected');

  const spaced = validateOrderInput(bodyWithEmail('a @b.com'), MENU_BASE);
  ok(spaced.ok === true && spaced.cleaned.email === '', 'space rejected');

  const empty = validateOrderInput(bodyWithEmail(''), MENU_BASE);
  ok(empty.ok === true && empty.cleaned.email === '', 'empty string reads as empty');

  const nonStr = validateOrderInput({ type: 'delivery', customer: { name: 'John Doe', phone: '70123456', address: 'Hamra', email: 123 }, items: [{ id: 'zaatar', qty: 1 }], lang: 'en', location: { lat: 33.8938, lng: 35.5018, accuracy: 30 } }, MENU_BASE);
  ok(nonStr.ok === true && nonStr.cleaned.email === '', 'non-string email reads as empty');

  const longLocal = `a@${'b'.repeat(300)}.com`;
  const longRes = validateOrderInput(bodyWithEmail(longLocal), MENU_BASE);
  ok(longRes.ok === true && typeof longRes.cleaned.email === 'string' && longRes.cleaned.email.length <= 254, 'long email capped at 254 and never fails');
}

/* ---------------- mapOrderRow email shape ---------------- */
{
  const withEmail = mapOrderRow(orderRow(1001, 'mina@example.com'));
  ok(withEmail.customer && withEmail.customer.email === 'mina@example.com', 'mapRow keeps email when present');
  const withoutEmail = mapOrderRow(orderRow(1002, null));
  ok(withoutEmail.customer && !('email' in withoutEmail.customer), 'mapRow omits email key when empty (legacy shape)');
  const legacy = mapOrderRow({ ...orderRow(1003, null), customer_email: undefined });
  ok(legacy.customer && !('email' in legacy.customer), 'mapRow tolerates missing column');
}

/* ---------------- fetch stub ---------------- */
const realFetch = globalThis.fetch;
let calls = [];
function stubFetchOk() {
  calls = [];
  globalThis.fetch = async (url, init) => {
    let parsed = null;
    try { parsed = JSON.parse(init && init.body ? init.body : '{}'); } catch { parsed = {}; }
    calls.push({ url: String(url), headers: (init && init.headers) || {}, body: parsed });
    return { ok: true, status: 200, json: async () => ({ id: 'mail_123' }) };
  };
}
function restoreFetch() { globalThis.fetch = realFetch; }

/* ---------------- (b) no send when missing/disabled ---------------- */
{
  stubFetchOk();
  const env = envWithMenu(MENU_BASE);
  const noEmailOrder = mapOrderRow(orderRow(1001, null));
  const r1 = await notifyCustomerOrderEvent(null, env, { order: noEmailOrder, event: 'placed', origin: 'https://x' });
  ok(r1 && r1.sent === false, 'no email -> not sent');
  ok(calls.length === 0, 'no network when email missing');

  const withEmail = mapOrderRow(orderRow(1002, 'mina@example.com'));
  const disabledMenu = menuWithNotifications({ senderName: '', replyTo: '', events: { placed: false, confirmed: true, completed: true, cancelled: true } });
  const r2 = await notifyCustomerOrderEvent(null, envWithMenu(disabledMenu), { order: withEmail, event: 'placed', origin: 'https://x' });
  ok(r2 && r2.sent === false, 'disabled event -> not sent');
  ok(calls.length === 0, 'no network when event disabled');
  restoreFetch();
}

/* ---------------- (c) send with correct To / key / fromName ---------------- */
{
  stubFetchOk();
  const env = envWithMenu(MENU_BASE);
  const ord = mapOrderRow(orderRow(1001, 'mina@example.com'));
  const r = await notifyCustomerOrderEvent(null, env, { order: ord, event: 'placed', origin: 'https://shop.example' });
  ok(r && r.sent === true, 'enabled event sends');
  ok(calls.length === 1, 'exactly one send');
  ok(calls[0] && calls[0].body && Array.isArray(calls[0].body.to) && calls[0].body.to[0] === 'mina@example.com', 'To is the customer email');
  ok(calls[0].headers['Idempotency-Key'] === 'order/1001/placed', `Idempotency-Key order/number/event (got ${calls[0].headers['Idempotency-Key']})`);
  ok(typeof calls[0].body.from === 'string' && calls[0].body.from.includes('My Sender'), 'fromName prefers senderName');
  ok(typeof calls[0].body.subject === 'string' && calls[0].body.subject.length > 0, 'subject present');
  ok(typeof calls[0].body.html === 'string' && typeof calls[0].body.text === 'string', 'html+text present');
  restoreFetch();
}
{
  // senderName empty -> falls back to store name
  stubFetchOk();
  const menu = menuWithNotifications({ senderName: '', replyTo: '', events: { placed: true, confirmed: true, completed: true, cancelled: true } });
  const env = envWithMenu(menu);
  const ord = mapOrderRow(orderRow(1002, 'a@b.co'));
  await notifyCustomerOrderEvent(null, env, { order: ord, event: 'confirmed', origin: 'https://shop.example' });
  ok(calls.length === 1 && String(calls[0].body.from).includes('Test Store'), 'fromName falls back to store name');
  ok(calls[0].headers['Idempotency-Key'] === 'order/1002/confirmed', 'key uses number+event');
  restoreFetch();
}

/* ---------------- (d) fail-soft without RESEND_API_KEY ---------------- */
{
  stubFetchOk();
  const menu = MENU_BASE;
  const env = { MENU_KV: kvWithMenu(menu), MAIL_FROM_DOMAIN_EMAIL: 'orders@example.com' };
  const ord = mapOrderRow(orderRow(1003, 'mina@example.com'));
  let threw = false;
  let out = null;
  try {
    out = await notifyCustomerOrderEvent(null, env, { order: ord, event: 'placed', origin: 'https://x' });
  } catch {
    threw = true;
  }
  ok(threw === false, 'missing key never throws');
  ok(out && out.sent === false, 'missing key returns sent:false');
  restoreFetch();
}

/* ---------------- (e) all four events ---------------- */
{
  for (const ev of ['placed', 'confirmed', 'completed', 'cancelled']) {
    stubFetchOk();
    const env = envWithMenu(MENU_BASE);
    const ord = mapOrderRow(orderRow(2000 + ev.length, 'mina@example.com'));
    const r = await notifyCustomerOrderEvent(null, env, { order: ord, event: ev, origin: 'https://shop.example' });
    ok(r && r.sent === true, `event ${ev} sends`);
    ok(calls.length === 1, `event ${ev} one network call`);
    ok(calls[0].headers['Idempotency-Key'] === `order/${ord.number}/${ev}`, `event ${ev} key correct`);
    ok(typeof calls[0].body.subject === 'string' && calls[0].body.subject.includes(String(ord.number)), `event ${ev} subject carries order number`);
    restoreFetch();
    stubFetchOk();  }
}

/* ---------------- bad event never sends ---------------- */
{
  stubFetchOk();
  const env = envWithMenu(MENU_BASE);
  const ord = mapOrderRow(orderRow(1001, 'mina@example.com'));
  const r = await notifyCustomerOrderEvent(null, env, { order: ord, event: 'shipped', origin: 'https://x' });
  ok(r && r.sent === false && calls.length === 0, 'unknown event never sends');
  restoreFetch();
}

/* ---------------- templates: 4 events x ar/en ---------------- */
{
  const trk = 'https://shop.example/?track=42&t=' + 'd'.repeat(32);
  const events = ['placed', 'confirmed', 'completed', 'cancelled'];
  for (const ev of events) {
    const html_ar = buildOrderEmail({ event: ev, order: { number: 42, total: 100000 }, storeName: 'متجر الاختبار', currency: 'ل.ل', lang: 'ar', trackUrl: trk }).html;
    const txt_ar = buildOrderEmail({ event: ev, order: { number: 42, total: 100000 }, storeName: 'متجر الاختبار', currency: 'ل.ل', lang: 'ar', trackUrl: trk }).text;
    ok(html_ar.includes('dir="rtl"'), `ar ${ev}: rtl root`);
    ok(/[\u0600-\u06FF]/.test(txt_ar), `ar ${ev}: Arabic body text`);
    ok(txt_ar.length > 0 && txt_ar.includes('42'), `ar ${ev}: plain-text fallback`);
    const o_en = buildOrderEmail({ event: ev, order: { number: 42, total: 100000 }, storeName: 'Test Store', currency: 'LBP', lang: 'en', trackUrl: trk });
    ok(o_en.html.includes('dir="ltr"'), `en ${ev}: ltr root`);
    ok(o_en.text.includes('42'), `en ${ev}: plain-text fallback`);
    ok(o_en.html.includes('https://shop.example/?track=42&amp;t='), `en ${ev}: track button links the order (& correctly HTML-escaped)`);
  }
  const arNoTrack = buildOrderEmail({ event: 'placed', order: { number: 7 }, storeName: 'س', currency: '', lang: 'ar', trackUrl: '' });
  ok(!arNoTrack.html.includes('<a '), 'no CTA link rendered without a track URL');
  ok(arNoTrack.text.length > 0, 'text version exists without track URL');
}

/* ---------------- templates: XSS escaping ---------------- */
{
  const evil = '<script>alert(1)</script>';
  const o = buildOrderEmail({ event: 'placed', order: { number: 9 }, storeName: evil, currency: 'ل.ل', lang: 'ar', trackUrl: 'https://s.example/?track=9&t=' + 'e'.repeat(32) });
  ok(!o.html.includes('<script>'), 'store name is escaped (no raw script tag)');
  ok(o.html.includes('&lt;script&gt;'), 'escaped payload present');
  ok(!o.html.includes('className'), 'no react-isms leak into raw HTML');
}

/* ---------------- templates: no tracking pixels/beacons ---------------- */
{
  const o = buildOrderEmail({ event: 'completed', order: { number: 3, total: 100 }, storeName: 'S', currency: 'LBP', lang: 'en', trackUrl: 'https://s.example/?track=3&t=' + 'f'.repeat(32) });
  ok(!/pixel|beacon|utm_|open\?|track\/open/i.test(o.html), 'no tracking pixels or open beacons');
}

/* ---------------- templates: brand shell + store timezone ---------------- */
{
  const o = buildOrderEmail({ event: 'placed', order: { number: 1 }, storeName: 'S', currency: 'ل.ل', lang: 'ar', trackUrl: '' });
  for (const cls of ['em-dark-keep', 'em-bgw', 'em-tink', 'em-ylb']) {
    ok(o.html.includes(cls), `brand class present: ${cls}`);
  }
  ok(o.html.includes('[data-ogsc]'), 'Gmail app dark-mode wrapper present');
  // January in Beirut is UTC+2 for sure (no DST ambiguity in tests).
  const winter = buildOrderEmail({ event: 'confirmed', order: { number: 5, etaAt: '2026-01-15T12:00:00.000Z' }, storeName: 'S', currency: 'ل.ل', lang: 'ar', trackUrl: '' });
  ok(winter.html.includes('2:00'), 'Beirut wall-clock used by default (12:00Z -> 2:00)');
  const winterUtc = buildOrderEmail({ event: 'confirmed', order: { number: 5, etaAt: '2026-01-15T12:00:00.000Z' }, storeName: 'S', currency: 'LBP', lang: 'en', timezone: 'UTC', trackUrl: '' });
  ok(winterUtc.html.includes('12:00'), 'explicit timezone override respected');
  const winterBadTz = buildOrderEmail({ event: 'confirmed', order: { number: 5, etaAt: '2026-01-15T12:00:00.000Z' }, storeName: 'S', currency: 'ل.ل', lang: 'ar', timezone: 'Nope/Zone', trackUrl: '' });
  ok(winterBadTz.text.includes('2026-01-15'), 'garbage timezone falls back to raw ISO, never throws');
}

/* ---------------- helper: per-language store/currency + itemsCount ---------------- */
{
  stubFetchOk();
  const menuAr = menuWithNotifications({ senderName: '', replyTo: '', events: { placed: true, confirmed: true, completed: true, cancelled: true } });
  const env = envWithMenu(menuAr);
  const ord = { number: 4001, total: 250000, lang: 'ar', track_token: 'c'.repeat(32), customer: { email: 'ar@example.com', name: 'A', phone: '1' }, items: [{}, {}, {}] };
  const r = await notifyCustomerOrderEvent(null, env, { order: ord, event: 'confirmed', origin: 'https://shop.example' });
  ok(r && r.sent === true, 'ar order sends');
  ok(calls[0].body.subject.includes('4001'), 'ar subject carries number');
  ok(typeof calls[0].body.html === 'string' && calls[0].body.html.includes('ل.ل'), 'ar email uses Arabic currency');
  ok(calls[0].body.html.includes('عدد الأصناف') && calls[0].body.html.includes('>3<'), 'items array counted into items row');
  restoreFetch();

  stubFetchOk();
  const env2 = envWithMenu(menuAr);
  const ordEn = { number: 4002, total: 250000, lang: 'en', track_token: 'c'.repeat(32), customer: { email: 'en@example.com', name: 'A', phone: '1' }, items: [] };
  const r2 = await notifyCustomerOrderEvent(null, env2, { order: ordEn, event: 'placed', origin: 'https://shop.example' });
  ok(r2 && r2.sent === true, 'en order sends');
  ok(calls[0].body.html.includes('LBP') && !calls[0].body.html.includes('عدد الأصناف'), 'en email uses Latin currency, empty items hidden');
  restoreFetch();
}

/* ---------------- helper: reply-to from settings ---------------- */
{
  stubFetchOk();
  const menu = menuWithNotifications({ senderName: 'My Sender', replyTo: 'owner@shop.example', events: { placed: true, confirmed: true, completed: true, cancelled: true } });
  const env = envWithMenu(menu);
  const ord = mapOrderRow(orderRow(5001, 'rt@example.com'));
  const r = await notifyCustomerOrderEvent(null, env, { order: ord, event: 'cancelled', origin: 'https://shop.example' });
  ok(r && r.sent === true, 'cancelled sends with reply-to set');
  ok(calls[0].body.reply_to === 'owner@shop.example', 'Reply-To header carries the admin address');
  restoreFetch();
}

/* ---------------- receipt_check event ---------------- */
{
  const trk = 'https://shop.example/?track=77&t=' + 'd'.repeat(32);
  const ar = buildOrderEmail({ event: 'receipt_check', order: { number: 77, total: 100000 }, storeName: 'متجر الاختبار', currency: 'ل.ل', lang: 'ar', trackUrl: trk });
  ok(ar.html.includes('dir="rtl"'), 'receipt_check ar: rtl root');
  ok(ar.html.includes('هل استلمت طلبك؟'), 'receipt_check ar: Arabic title');
  ok(ar.text.includes('77'), 'receipt_check ar: plain-text fallback');
  ok(ar.html.includes('https://shop.example/?track=77&amp;t='), 'receipt_check ar: track button links the order');
  const en = buildOrderEmail({ event: 'receipt_check', order: { number: 77, total: 100000 }, storeName: 'Test Store', currency: 'LBP', lang: 'en', trackUrl: trk });
  ok(en.html.includes('dir="ltr"'), 'receipt_check en: ltr root');
  ok(en.html.includes('Did your order arrive?'), 'receipt_check en: English title');
  ok(en.text.includes('77'), 'receipt_check en: plain-text fallback');

  stubFetchOk();
  const disMenu = menuWithNotifications({ senderName: '', replyTo: '', events: { placed: true, confirmed: true, completed: true, cancelled: true, receipt_check: false } });
  const disOrd = mapOrderRow(orderRow(7701, 'rc@example.com'));
  const rDis = await notifyCustomerOrderEvent(null, envWithMenu(disMenu), { order: disOrd, event: 'receipt_check', origin: 'https://shop.example' });
  ok(rDis && rDis.sent === false, 'receipt_check disabled -> not sent');
  ok(calls.length === 0, 'receipt_check disabled -> no network');
  restoreFetch();

  stubFetchOk();
  const askedOrd = { ...mapOrderRow(orderRow(7702, 'rc2@example.com')), receiptAskedAt: new Date().toISOString() };
  const rSup = await notifyCustomerOrderEvent(null, envWithMenu(MENU_BASE), { order: askedOrd, event: 'completed', origin: 'https://shop.example' });
  ok(rSup && rSup.sent === false, 'completed suppressed when receiptAskedAt present');
  restoreFetch();

  stubFetchOk();
  const rBad = await notifyCustomerOrderEvent(null, envWithMenu(MENU_BASE), { order: mapOrderRow(orderRow(7703, 'rc3@example.com')), event: 'shipped', origin: 'https://x' });
  ok(rBad && rBad.sent === false && rBad.reason === 'bad_event', 'unknown event still bad_event');
  restoreFetch();
}

summary();
