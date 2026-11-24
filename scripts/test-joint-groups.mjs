// Joint-delivery group tests: 20-min link window, one-tap group receipt,
// batch/track group shapes, Telegram reply threading.
// Run: node scripts/test-joint-groups.mjs (or: npm run test:joint-groups)
// Real SQL via node:sqlite with ALL migrations applied. No network.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { findLinkedGroup } from '../functions/_shared/repositories/orders.repo.js';
import { updateOrderStatus } from '../functions/_shared/repositories/orders.repo.js';
import { resolveReplyToMessageId } from '../functions/_shared/telegram.js';
import { onRequest as ordersReq } from '../functions/api/orders.js';
import { onRequest as receivedReq } from '../functions/api/track/received.js';
import { onRequest as trackReq } from '../functions/api/track.js';
import { onRequest as batchReq } from '../functions/api/track/batch.js';
import { createAsserts, makeKV, makeReq, readJson } from './_helpers/shared.mjs';
import { MENU, orderBody } from './_helpers/features-cases.mjs';

const { ok, summary } = createAsserts();
const req = makeReq;
const json = readJson;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- minimal D1-shaped adapter over node:sqlite ---------- */
function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const runBound = (sql, args) => {
    const stmt = sqlite.prepare(sql);
    return {
      first: async () => stmt.get(...args) ?? null,
      all: async () => ({ results: stmt.all(...args) }),
      run: async () => {
        const r = stmt.run(...args);
        return { meta: { changes: Number(r.changes) } };
      },
    };
  };
  return {
    prepare: (sql) => ({
      bind: (...args) => runBound(sql, args),
      first: async () => runBound(sql, []).first(),
      all: async () => runBound(sql, []).all(),
      run: async () => runBound(sql, []).run(),
    }),
    batch: async (stmts) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    exec: (sql) => sqlite.exec(sql),
  };
}

function migratedDb() {
  const db = makeDb();
  const dir = join(ROOT, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) db.exec(readFileSync(join(dir, f), 'utf8'));
  return db;
}

function freshEnv(db) {
  const kv = makeKV();
  const ready = kv.put('menu', JSON.stringify(MENU));
  return { env: { MENU_KV: kv, ORDERS_DB: db, REQUIRE_ACCOUNT_FOR_COD: '0' }, ready };
}

async function postOrder(env, body, ip = '10.7.0.1') {
  const res = await ordersReq({
    request: req('POST', 'https://x/api/orders', {
      headers: { 'Content-Type': 'application/json', Origin: 'https://x', 'CF-Connecting-IP': ip },
      body: JSON.stringify(body),
    }),
    env,
  });
  return { status: res.status, data: await json(res) };
}

async function receive(env, body) {
  const res = await receivedReq({
    request: req('POST', 'https://x/api/track/received', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  });
  return { status: res.status, data: await json(res) };
}

const TEST_PIN = { lat: 33.9, lng: 35.5, accuracy: 30 };
const PAST_ETA = () => new Date(Date.now() - 60 * 60000).toISOString();
// Unlock helper: force eta into the past so the receive gate opens
// (unlock = etaAt + 5 min buffer). Mirrors real post-delivery taps.
async function forceUnlockable(db, numbers) {
  for (const n of numbers) {
    await db.prepare('UPDATE orders SET eta_at = ?2 WHERE number = ?1').bind(n, PAST_ETA()).run();
  }
}
const agoMin = (m) => new Date(Date.now() - m * 60000).toISOString();
async function insertDirect(db, { phone, status = 'new', createdAt = null, parentNumber = null } = {}) {
  const { insertOrderWithNumber, nextOrderNumber } = await import(
    '../functions/_shared/repositories/orders.repo.js'
  );
  const stamp = createdAt || new Date().toISOString();
  const num = await nextOrderNumber(db);
  const cleaned = {
    idemKey: null,
    trackToken: 'g'.repeat(32),
    type: 'delivery',
    name: 'Karim Haddad',
    phone,
    phoneNorm: String(phone).replace(/[^0-9]/g, ''),
    email: null,
    address: 'Hamra',
    table: null,
    notes: null,
    location: TEST_PIN,
    items: [],
    subtotal: 100,
    deliveryFee: 0,
    total: 100,
    lang: 'en',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    parentNumber,
    riskScore: 0,
    riskReasons: [],
    needsReview: false,
  };
  const created = await insertOrderWithNumber(db, cleaned, num, stamp);
  if (status !== 'new') await updateOrderStatus(db, created.id, status);
  return { ...created, number: created.num };
}

/* ---------------- 1. 20-minute link window ---------------- */
{
  const db = migratedDb();
  const { env, ready } = freshEnv(db);
  await ready;
  const P = '71550011';
  // Active order 19 min ago -> inside the 20-min window -> links.
  const a = await insertDirect(db, { phone: P, status: 'confirmed', createdAt: agoMin(19) });
  const b = await postOrder(env, orderBody({ customer: { name: 'Karim H', phone: P, address: 'Hamra' }, location: TEST_PIN, idemKey: 'w1' }), '10.7.0.2');
  ok(b.status === 200 && b.data.parentNumber === a.number, 'order 19 min after links to active parent');
  // Active order 25 min ago -> outside the window -> standalone.
  const db2 = migratedDb();
  const e2 = freshEnv(db2);
  await e2.ready;
  const a2 = await insertDirect(db2, { phone: P, status: 'confirmed', createdAt: agoMin(25) });
  ok(a2.number > 1000, 'old parent seeded');
  const b2 = await postOrder(e2.env, orderBody({ customer: { name: 'Karim H', phone: P, address: 'Hamra' }, location: TEST_PIN, idemKey: 'w2' }), '10.7.0.3');
  ok(b2.status === 200 && (b2.data.parentNumber === null || b2.data.parentNumber === undefined), 'order 25 min after stays standalone');
}

/* ---------------- 2. one-tap group receipt ---------------- */
{
  const db = migratedDb();
  const { env, ready } = freshEnv(db);
  await ready;
  const P = '71550022';
  const a = await postOrder(env, orderBody({ customer: { name: 'Lina K', phone: P, address: 'Hamra' }, location: TEST_PIN, idemKey: 'g1' }), '10.7.1.1');
  const b = await postOrder(env, orderBody({ customer: { name: 'Lina K', phone: P, address: 'Hamra' }, location: TEST_PIN, idemKey: 'g2' }), '10.7.1.1');
  ok(a.status === 200 && b.status === 200 && b.data.parentNumber === a.data.orderNumber, 'pair links (child -> parent)');
  for (const n of [a.data.orderNumber, b.data.orderNumber]) {
    const r = await db.prepare('SELECT id FROM orders WHERE number = ?1').bind(n).first();
    await updateOrderStatus(db, r.id, 'confirmed');
  }
  await forceUnlockable(db, [a.data.orderNumber, b.data.orderNumber]);
  const r = await receive(env, { number: a.data.orderNumber, t: a.data.trackToken, group: true });
  ok(r.status === 200 && r.data.ok === true, 'group receive ok');
  ok(
    Array.isArray(r.data.completedNumbers) &&
      r.data.completedNumbers.includes(a.data.orderNumber) &&
      r.data.completedNumbers.includes(b.data.orderNumber),
    'group receive flips both members'
  );
  const s1 = await db.prepare('SELECT status FROM orders WHERE number = ?1').bind(a.data.orderNumber).first();
  const s2 = await db.prepare('SELECT status FROM orders WHERE number = ?1').bind(b.data.orderNumber).first();
  ok(s1.status === 'completed' && s2.status === 'completed', 'both rows completed in DB');
  // Idempotent retry.
  const r2 = await receive(env, { number: a.data.orderNumber, t: a.data.trackToken, group: true });
  ok(r2.status === 200 && r2.data.ok === true, 'group retry idempotent');
  // Wrong token -> 404, nothing flips.
  const r3 = await receive(env, { number: a.data.orderNumber, t: '0'.repeat(32), group: true });
  ok(r3.status === 404, 'wrong token rejected even with group flag');
}

/* ---------------- 3. group skips non-receivable members ---------------- */
{
  const db = migratedDb();
  const { env, ready } = freshEnv(db);
  await ready;
  const P = '71550033';
  const a = await postOrder(env, orderBody({ customer: { name: 'Omar S', phone: P, address: 'Hamra' }, location: TEST_PIN, idemKey: 'h1' }), '10.7.2.1');
  const b = await postOrder(env, orderBody({ customer: { name: 'Omar S', phone: P, address: 'Hamra' }, location: TEST_PIN, idemKey: 'h2' }), '10.7.2.1');
  // Parent confirmed, child still new (kitchen hasn't started it).
  const ra = await db.prepare('SELECT id FROM orders WHERE number = ?1').bind(a.data.orderNumber).first();
  await updateOrderStatus(db, ra.id, 'confirmed');
  await forceUnlockable(db, [a.data.orderNumber]);
  const r = await receive(env, { number: a.data.orderNumber, t: a.data.trackToken, group: true });
  ok(r.status === 200 && r.data.ok === true, 'group receive with new child ok');
  ok(r.data.completedNumbers.includes(a.data.orderNumber) && !r.data.completedNumbers.includes(b.data.orderNumber), 'new child not flipped');
  const sb = await db.prepare('SELECT status FROM orders WHERE number = ?1').bind(b.data.orderNumber).first();
  ok(sb.status === 'new', 'new child stays new');
  // Cancelled sibling skipped.
  const rb = await db.prepare('SELECT id FROM orders WHERE number = ?1').bind(b.data.orderNumber).first();
  await updateOrderStatus(db, rb.id, 'confirmed');
  await updateOrderStatus(db, rb.id, 'cancelled');
  const r2 = await receive(env, { number: b.data.orderNumber, t: b.data.trackToken, group: true });
  ok(r2.status === 200 && r2.data.ok === true && r2.data.status === 'cancelled', 'cancelled request short-circuits idempotent ok');
  // Cancelled sibling skipped: fresh pair, both confirmed, then child
  // cancelled -> group receive from the parent flips ONLY the parent.
  const db2 = migratedDb();
  const e2 = freshEnv(db2);
  await e2.ready;
  const P2 = '71550036';
  const a2 = await postOrder(e2.env, orderBody({ customer: { name: 'Omar S', phone: P2, address: 'Hamra' }, location: TEST_PIN, idemKey: 'h3' }), '10.7.2.2');
  const b2 = await postOrder(e2.env, orderBody({ customer: { name: 'Omar S', phone: P2, address: 'Hamra' }, location: TEST_PIN, idemKey: 'h4' }), '10.7.2.2');
  ok(b2.data.parentNumber === a2.data.orderNumber, 'second pair links');
  for (const n of [a2.data.orderNumber, b2.data.orderNumber]) {
    const rr = await db2.prepare('SELECT id FROM orders WHERE number = ?1').bind(n).first();
    await updateOrderStatus(db2, rr.id, 'confirmed');
  }
  const rb2 = await db2.prepare('SELECT id FROM orders WHERE number = ?1').bind(b2.data.orderNumber).first();
  await updateOrderStatus(db2, rb2.id, 'cancelled');
  await db2.prepare('UPDATE orders SET eta_at = ?2 WHERE number = ?1').bind(a2.data.orderNumber, new Date(Date.now() - 60 * 60000).toISOString()).run();
  const r3 = await receive(e2.env, { number: a2.data.orderNumber, t: a2.data.trackToken, group: true });
  ok(
    r3.status === 200 && r3.data.ok === true &&
      r3.data.completedNumbers.includes(a2.data.orderNumber) &&
      !r3.data.completedNumbers.includes(b2.data.orderNumber),
    'cancelled sibling skipped, parent flipped'
  );
}

/* ---------------- 4. solo order keeps single shape ---------------- */
{
  const db = migratedDb();
  const { env, ready } = freshEnv(db);
  await ready;
  const a = await postOrder(env, orderBody({ customer: { name: 'Solo S', phone: '71550044', address: 'Hamra' }, location: TEST_PIN, idemKey: 's1' }), '10.7.3.1');
  const ra = await db.prepare('SELECT id FROM orders WHERE number = ?1').bind(a.data.orderNumber).first();
  await updateOrderStatus(db, ra.id, 'confirmed');
  await forceUnlockable(db, [a.data.orderNumber]);
  const r = await receive(env, { number: a.data.orderNumber, t: a.data.trackToken, group: true });
  ok(r.status === 200 && r.data.ok === true && !('completedNumbers' in (r.data || {})), 'solo group flag falls back to single shape');
}

/* ---------------- 5. batch + track expose the group ---------------- */
{
  const db = migratedDb();
  const { env, ready } = freshEnv(db);
  await ready;
  const P = '71550055';
  const a = await postOrder(env, orderBody({ customer: { name: 'Batch B', phone: P, address: 'Hamra' }, location: TEST_PIN, idemKey: 't1' }), '10.7.4.1');
  const b = await postOrder(env, orderBody({ customer: { name: 'Batch B', phone: P, address: 'Hamra' }, location: TEST_PIN, idemKey: 't2' }), '10.7.4.1');
  const { onRequest: batchReq } = await import('../functions/api/track/batch.js');
  const br = await batchReq({
    request: req('POST', 'https://x/api/track/batch', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: [{ number: a.data.orderNumber, t: a.data.trackToken }, { number: b.data.orderNumber, t: b.data.trackToken }] }),
    }),
    env,
  });
  const bd = await json(br);
  const ra = bd.results.find((x) => x.number === a.data.orderNumber);
  const rb = bd.results.find((x) => x.number === b.data.orderNumber);
  ok(Array.isArray(ra.groupNumbers) && ra.groupNumbers.includes(b.data.orderNumber), 'batch names sibling for parent');
  ok(Array.isArray(rb.groupNumbers) && rb.groupNumbers.includes(a.data.orderNumber), 'batch names parent for child');
  const tr = await trackReq({
    request: req('GET', `https://x/api/track?number=${b.data.orderNumber}&t=${b.data.trackToken}`, {}),
    env,
  });
  const td = await json(tr);
  ok(td.linked && Array.isArray(td.linked.numbers) && td.linked.numbers.includes(a.data.orderNumber), 'track GET exposes linked group');
}

/* ---------------- 6. Telegram reply threading ---------------- */
{
  const db = migratedDb();
  // Parent order + owner ledger message in chat 777.
  await db.prepare("INSERT INTO orders (id, number, created_at, updated_at, status, type, customer_name, customer_phone, phone_norm, customer_address, items_json, subtotal, delivery_fee, total, lang) VALUES ('p1', 2001, '2026-11-13T10:00:00.000Z', '2026-11-13T10:00:00.000Z', 'confirmed', 'delivery', 'T', '70123456', '70123456', 'Hamra', '[]', 100, 0, 100, 'en')").run();
  await db.prepare("INSERT INTO telegram_notifications (order_id, order_number, status, message_id, chat_id, created_at, updated_at) VALUES ('p1', 2001, 'sent', 999, 777, '2026-11-13T10:00:00.000Z', '2026-11-13T10:00:00.000Z')").run();
  ok((await resolveReplyToMessageId(db, 2001, 777)) === 999, 'parent message resolved in same chat');
  ok((await resolveReplyToMessageId(db, 2001, 888)) === null, 'other chat gets no reply id');
  ok((await resolveReplyToMessageId(db, 4242, 777)) === null, 'unknown order gets no reply id');
}

/* ---------------- 7. customer surfaces hide the joint messaging ---------------- */
{
  const track = readFileSync(join(ROOT, 'src/features/track/TrackView.tsx'), 'utf8');
  const bell = readFileSync(join(ROOT, 'src/features/track/components/OrdersBell.tsx'), 'utf8');
  const dash = readFileSync(join(ROOT, 'src/features/orders/components/orders/OrdersDashList.tsx'), 'utf8');
  for (const [name, src] of [['TrackView', track], ['OrdersBell', bell]]) {
    ok(!src.includes('سيصل مع الطلب') && !src.includes('ستصل مع'), `${name} shows no joint-delivery banner to the customer (ar)`);
    ok(!src.includes('Arriving with order') && !src.includes('arrive together'), `${name} shows no joint-delivery banner to the customer (en)`);
  }
  // The joint receipt still completes the whole group in one tap (server +
  // button behavior unchanged); only the explanatory banners are gone.
  ok(track.includes('groupCount={data.linked') && bell.includes('groupCount={'), 'joint receipt still completes the group in one tap');
  ok(dash.includes('inGroup') && dash.includes('{!inGroup && o.status'), 'group members hide their own advance buttons; the GroupCard owns the single one');
  ok(dash.includes('basis-full sm:basis-auto') && !dash.includes('shortCustomerName'), 'customer name stacks below the number on phones, inline on sm+');
}

summary();
