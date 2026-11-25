// Phone-safety tests: per-phone caps, phone blocklist, risk scoring.
// Run: node scripts/test-phone-safety.mjs (or: npm run test:phone-safety)
// Real SQL via node:sqlite behind a minimal D1-shaped adapter — ALL
// migration files are applied, so the blocklist table, risk columns,
// review dismissal and caps behavior are tested for real. No network,
// no wrangler.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { validateOrderInput, mapOrderRow } from '../functions/_shared/orders.js';
import {
  assessOrderRisk,
  beirutHour,
  isSuspiciousPhone,
  isTestLikeName,
  RISK_REASON_LABEL,
  scorePhoneHistory,
  scoreStaticRisk,
} from '../functions/_shared/order-risk.js';
import { formatNewOrderMessage, rebuildOrderMessage } from '../functions/_shared/telegram.js';
import { updateOrderStatus } from '../functions/_shared/repositories/orders.repo.js';
import { createSessionToken, getSessionSecret } from '../functions/_shared/session.js';
import { onRequest as ordersReq } from '../functions/api/orders.js';
import { onRequest as phoneBlocksReq } from '../functions/api/admin/phone-blocks.js';
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

/* ---------- env + request helpers ---------- */

const secretBytes = crypto.getRandomValues(new Uint8Array(32));
let b64 = '';
for (let i = 0; i < secretBytes.length; i++) b64 += String.fromCharCode(secretBytes[i]);
const SESSION_SECRET = btoa(b64);
const secret = getSessionSecret({ SESSION_SECRET });

const cookieFor = (token) => `__Host-admin-session=${token}`;
const ownerCookie = async () => cookieFor(await createSessionToken(secret, 'admin', 3600));
const kitchenCookie = async () =>
  cookieFor(await createSessionToken(secret, 'client:crew', 3600, { role: 'kitchen' }));

function freshEnv(db) {
  const kv = makeKV();
  const ready = kv.put('menu', JSON.stringify(MENU));
  return { env: { MENU_KV: kv, ORDERS_DB: db, SESSION_SECRET, REQUIRE_ACCOUNT_FOR_COD: '0' }, ready };
}

async function postOrder(env, body, ip = '10.9.9.9') {
  const res = await ordersReq({
    request: req('POST', 'https://x/api/orders', {
      headers: { 'Content-Type': 'application/json', Origin: 'https://x', 'CF-Connecting-IP': ip },
      body: JSON.stringify(body),
    }),
    env,
  });
  return { status: res.status, data: await json(res) };
}

const TEST_PIN = { lat: 33.9, lng: 35.5, accuracy: 30 };
const DAY_INSTANT = Date.parse('2026-01-15T10:00:00.000Z'); // 12:00 Asia/Beirut
const NIGHT_INSTANT = Date.parse('2026-01-15T00:30:00.000Z'); // 02:30 Asia/Beirut

async function insertDirect(db, { phone, status = 'new', createdAt = null, name = 'Sara Nour' } = {}) {
  const { insertOrderWithNumber, nextOrderNumber } = await import(
    '../functions/_shared/repositories/orders.repo.js'
  );
  const stamp = createdAt || new Date().toISOString();
  const num = await nextOrderNumber(db);
  const cleaned = {
    idemKey: null,
    trackToken: 't'.repeat(32),
    type: 'delivery',
    name,
    phone,
    phoneNorm: String(phone).replace(/[^0-9]/g, ''),
    email: null,
    address: 'Hamra',
    table: null,
    notes: null,
    location: null,
    items: [],
    subtotal: 100,
    deliveryFee: 0,
    total: 100,
    lang: 'en',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    parentNumber: null,
    riskScore: 0,
    riskReasons: [],
    needsReview: false,
  };
  const created = await insertOrderWithNumber(db, cleaned, num, stamp);
  if (status !== 'new') await updateOrderStatus(db, created.id, status);
  return created;
}

const daysAgo = (n) => new Date(Date.now() - n * 86400 * 1000).toISOString();

/* ---------------- 1. static risk rules (pure, deterministic) ---------------- */
{
  ok(isTestLikeName('test'), 'test-like: exact test');
  ok(isTestLikeName('ABC'), 'test-like: exact abc case-insensitive');
  ok(isTestLikeName('xxx'), 'test-like: exact xxx');
  ok(isTestLikeName('x'), 'test-like: single char');
  ok(isTestLikeName('12345'), 'test-like: digits-only');
  ok(!isTestLikeName('Mohammed'), 'real name Mohammed not flagged');
  ok(!isTestLikeName('Ali'), 'real name Ali not flagged');
  ok(!isTestLikeName('John Doe'), 'real name John Doe not flagged');
  ok(!isTestLikeName('Test User'), 'Test User (not exact) not flagged');
  ok(!isTestLikeName(''), 'empty name not flagged');

  ok(isSuspiciousPhone('77777777'), 'repeated digits flagged');
  ok(isSuspiciousPhone('111111'), 'repeated 6-digit flagged');
  ok(isSuspiciousPhone('12345678'), 'ascending 12345678 flagged');
  ok(isSuspiciousPhone('87654321'), 'descending 87654321 flagged');
  ok(!isSuspiciousPhone('70123456'), 'real 70123456 NOT flagged (substring run ok)');
  ok(!isSuspiciousPhone('70987654'), 'real 70987654 NOT flagged');
  ok(!isSuspiciousPhone('03123456'), 'real 03123456 NOT flagged');
  ok(!isSuspiciousPhone('123'), 'short digits not flagged');

  ok(beirutHour(DAY_INSTANT) === 12, 'beirut noon reads 12');
  ok(beirutHour(NIGHT_INSTANT) === 2, 'beirut night reads 2');

  const s1 = scoreStaticRisk({ name: 'test', phoneNorm: '70123456', nowMs: DAY_INSTANT });
  ok(s1.score === 40 && s1.reasons.length === 1, 'test name alone = 40');
  const s2 = scoreStaticRisk({ name: 'Sara', phoneNorm: '12345678', nowMs: DAY_INSTANT });
  ok(s2.score === 30, 'sequential phone alone = 30');
  const s3 = scoreStaticRisk({ name: 'Sara', phoneNorm: '70123456', nowMs: NIGHT_INSTANT });
  ok(s3.score === 15, 'night order alone = +15');
  const s4 = scoreStaticRisk({ name: 'Sara', phoneNorm: '70123456', nowMs: DAY_INSTANT });
  ok(s4.score === 0 && s4.reasons.length === 0, 'clean daytime order = 0');
  const s5 = scoreStaticRisk({ name: 'test', phoneNorm: '12345678', nowMs: NIGHT_INSTANT });
  ok(s5.score === 85, 'stacked static signals = 85');
  // Reasons are STABLE CODES (never display strings): every renderer
  // localizes from RISK_REASON_LABEL, so codes and labels stay in sync.
  const CODE_RE = /^[a-z_]+$/;
  for (const r of [...s1.reasons, ...s2.reasons, ...s3.reasons, ...s5.reasons]) {
    ok(CODE_RE.test(r) && RISK_REASON_LABEL[r] && typeof RISK_REASON_LABEL[r].ar === 'string' && typeof RISK_REASON_LABEL[r].en === 'string', `reason code '${r}' has bilingual label`);
  }
  ok(s1.reasons.includes('test_name') && s2.reasons.includes('repeated_digits') && s3.reasons.includes('night_order'), 'static reasons are stable codes');
}

/* ---------------- 2. history rules + threshold ---------------- */
{
  const db = migratedDb();
  // Phone with a cancelled order 2d ago + 2 orders in the last 24h.
  await insertDirect(db, { phone: '71110011', status: 'cancelled', createdAt: daysAgo(2) });
  await insertDirect(db, { phone: '71110011', status: 'completed', createdAt: daysAgo(20) }); // too old, ignored
  const h1 = await scorePhoneHistory(db, '71110011', Date.now());
  ok(h1.score === 25 && h1.reasons.length === 1, 'cancelled-in-7d = +25 (old cancelled ignored)');
  await insertDirect(db, { phone: '71110022', status: 'completed' });
  await insertDirect(db, { phone: '71110022', status: 'completed' });
  const h2 = await scorePhoneHistory(db, '71110022', Date.now());
  ok(h2.score === 25, 'two orders in 24h = +25');
  const h3 = await scorePhoneHistory(db, '71110033', Date.now());
  ok(h3.score === 0, 'unknown phone = 0');
  // Exactly 50 (25 + 25) hits the threshold.
  await insertDirect(db, { phone: '71110044', status: 'cancelled' });
  await insertDirect(db, { phone: '71110044', status: 'completed' });
  await insertDirect(db, { phone: '71110044', status: 'completed' });
  const a50 = await assessOrderRisk({ name: 'Sara Nour', phoneNorm: '71110044' }, { db, nowMs: DAY_INSTANT });
  ok(a50.riskScore === 50 && a50.needsReview === true, 'score 50 needs review (boundary, pinned daytime)');
  // 40 alone stays below.
  const a40 = await assessOrderRisk(
    { name: 'test', phoneNorm: '70123456' },
    { db, nowMs: DAY_INSTANT }
  );
  ok(a40.riskScore === 40 && a40.needsReview === false, 'score 40 no review');
  // Fail-open on a dead DB.
  const dead = { prepare: () => { throw new Error('d1 down'); } };
  const hDead = await scorePhoneHistory(dead, '71110011', Date.now());
  ok(hDead.score === 0, 'history fails open on DB error');
}

/* ---------------- 3. per-phone caps via the route ---------------- */
{
  const db = migratedDb();
  const { env, ready } = freshEnv(db);
  await ready;

  // Daily cap: 5 new orders/day ok, 6th capped. Completing older orders
  // keeps the ACTIVE cap out of the way so the daily cap is what fires.
  const P1 = '71345678';
  const r1 = await postOrder(env, orderBody({ customer: { name: 'Sara Nour', phone: P1, address: 'Hamra' }, location: TEST_PIN, idemKey: 'd1' }), '10.1.0.1');
  ok(r1.status === 200, 'daily 1/5 accepted');
  await updateOrderStatus(db, (await db.prepare('SELECT id FROM orders WHERE number = ?1').bind(r1.data.orderNumber).first()).id, 'completed');
  const r2 = await postOrder(env, orderBody({ customer: { name: 'Sara Nour', phone: P1, address: 'Hamra' }, location: TEST_PIN, idemKey: 'd2' }), '10.1.0.1');
  ok(r2.status === 200, 'daily 2/5 accepted');
  await updateOrderStatus(db, (await db.prepare('SELECT id FROM orders WHERE number = ?1').bind(r2.data.orderNumber).first()).id, 'completed');
  const r3 = await postOrder(env, orderBody({ customer: { name: 'Sara Nour', phone: P1, address: 'Hamra' }, location: TEST_PIN, idemKey: 'd3' }), '10.1.0.1');
  ok(r3.status === 200, 'daily 3/5 accepted');
  await updateOrderStatus(db, (await db.prepare('SELECT id FROM orders WHERE number = ?1').bind(r3.data.orderNumber).first()).id, 'completed');
  const r4 = await postOrder(env, orderBody({ customer: { name: 'Sara Nour', phone: P1, address: 'Hamra' }, location: TEST_PIN, idemKey: 'd4' }), '10.1.0.1');
  ok(r4.status === 200, 'daily 4/5 accepted');
  await updateOrderStatus(db, (await db.prepare('SELECT id FROM orders WHERE number = ?1').bind(r4.data.orderNumber).first()).id, 'completed');
  const r5 = await postOrder(env, orderBody({ customer: { name: 'Sara Nour', phone: P1, address: 'Hamra' }, location: TEST_PIN, idemKey: 'd5' }), '10.1.0.1');
  ok(r5.status === 200, 'daily 5/5 accepted');
  const r6 = await postOrder(env, orderBody({ customer: { name: 'Sara Nour', phone: P1, address: 'Hamra' }, location: TEST_PIN, idemKey: 'd6' }), '10.1.0.1');
  ok(r6.status === 403 && r6.data.error === 'rejected', 'daily 6th rejected 403 (single code)');
  ok(r6.data.message && typeof r6.data.message.ar === 'string' && r6.data.message.ar.length > 0, 'rejected message is generic Arabic-first');
  const p1rows = await db.prepare('SELECT COUNT(*) AS c FROM orders WHERE phone_norm = ?1').bind(P1).first();
  ok(p1rows.c === 5, 'capped order stored nothing');
  // Same-key retry after the cap is still free (dedupe returns the original).
  const retry = await postOrder(env, orderBody({ customer: { name: 'Sara Nour', phone: P1, address: 'Hamra' }, location: TEST_PIN, idemKey: 'd1' }), '10.1.0.1');
  ok(retry.status === 200 && retry.data.orderNumber === r1.data.orderNumber, 'retry after cap free, same number');
  const p1rows2 = await db.prepare('SELECT COUNT(*) AS c FROM orders WHERE phone_norm = ?1').bind(P1).first();
  ok(p1rows2.c === 5, 'retry stored nothing new');
  // Phone budget row: 6 reserves (5 allowed + 1 rejected), window = UTC midnight.
  const rate = await db.prepare('SELECT hits, window_reset FROM rate_counters WHERE "key" = ?1').bind('order:phone:' + P1).first();
  const nowSec = Math.floor(Date.now() / 1000);
  const d = new Date(nowSec * 1000);
  const midnight = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000);
  ok(rate && rate.hits === 6 && rate.window_reset === midnight, 'phone daily budget reuses rate_counters, midnight window');

  // Active cap: 2 non-terminal ok, 3rd capped; completing one frees a slot.
  const P2 = '71456789';
  const a1 = await postOrder(env, orderBody({ customer: { name: 'Omar Haddad', phone: P2, address: 'Hamra' }, location: TEST_PIN, idemKey: 'a1' }), '10.1.0.2');
  const a2 = await postOrder(env, orderBody({ customer: { name: 'Omar Haddad', phone: P2, address: 'Hamra' }, location: TEST_PIN, idemKey: 'a2' }), '10.1.0.2');
  ok(a1.status === 200 && a2.status === 200, 'active 2/2 accepted');
  const a3 = await postOrder(env, orderBody({ customer: { name: 'Omar Haddad', phone: P2, address: 'Hamra' }, location: TEST_PIN, idemKey: 'a3' }), '10.1.0.2');
  ok(a3.status === 403 && a3.data.error === 'rejected', 'active 3rd rejected 403 (single code)');
  await updateOrderStatus(db, (await db.prepare('SELECT id FROM orders WHERE number = ?1').bind(a1.data.orderNumber).first()).id, 'completed');
  const a4 = await postOrder(env, orderBody({ customer: { name: 'Omar Haddad', phone: P2, address: 'Hamra' }, location: TEST_PIN, idemKey: 'a4' }), '10.1.0.2');
  ok(a4.status === 200, 'slot freed after completion');
  // Active rejection consumes no daily budget (checked before the reserve).
  const rate2 = await db.prepare('SELECT hits FROM rate_counters WHERE "key" = ?1').bind('order:phone:' + P2).first();
  ok(rate2 && rate2.hits === 3, 'active-capped order consumed no daily budget');

  // Stored risk columns + contract shape on the admin feed rows.
  const stored = await db.prepare('SELECT risk_score, risk_reasons FROM orders WHERE number = ?1').bind(r1.data.orderNumber).first();
  ok(typeof stored.risk_score === 'number', 'risk_score column stored');
  const mapped = mapOrderRow(await db.prepare('SELECT * FROM orders WHERE number = ?1').bind(r1.data.orderNumber).first());
  ok(typeof mapped.riskScore === 'number' && Array.isArray(mapped.riskReasons) && typeof mapped.needsReview === 'boolean' && typeof mapped.reviewCleared === 'boolean', 'mapOrderRow contract fields present');
  // Legacy row without risk columns still reads as unscored.
  const legacy = mapOrderRow({ id: 'x', number: 1, created_at: 't', status: 'new', type: 'delivery', customer_name: 'A', customer_phone: '1', items_json: '[]', subtotal: 1, delivery_fee: 0, total: 1 });
  ok(legacy.riskScore === 0 && legacy.riskReasons.length === 0 && legacy.needsReview === false && legacy.reviewCleared === false, 'legacy row unscored defaults');
}

/* ---------------- 4. blocklist: route + admin CRUD ---------------- */
{
  const db = migratedDb();
  const { env, ready } = freshEnv(db);
  await ready;
  const P3 = '71567890';
  const first = await postOrder(env, orderBody({ customer: { name: 'Layla Khoury', phone: P3, address: 'Hamra' }, location: TEST_PIN, idemKey: 'b0' }), '10.2.0.1');
  ok(first.status === 200, 'unblocked phone orders fine');

  const oc = await ownerCookie();
  const adminHdrs = (cookie) => ({
    'X-Requested-With': 'menu-admin',
    Origin: 'https://x',
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  });
  const adminCall = (method, body, cookie) =>
    phoneBlocksReq({
      request: new Request('https://x/api/admin/phone-blocks', {
        method,
        headers: adminHdrs(cookie),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    });

  // Auth: anonymous + kitchen fail closed.
  const noAuth = await adminCall('GET', undefined, null);
  ok(noAuth.status === 403, 'blocklist GET without session 403');
  const kc = await kitchenCookie();
  const kitchenGet = await adminCall('GET', undefined, kc);
  ok(kitchenGet.status === 403, 'blocklist GET as kitchen 403');

  // Validation.
  const badPhone = await adminCall('POST', { phone: '12', reason: 'spam' }, oc);
  ok(badPhone.status === 400 && (await json(badPhone)).error === 'invalid_phone', 'block rejects short phone');
  const badReason = await adminCall('POST', { phone: P3, reason: 'x'.repeat(141) }, oc);
  ok(badReason.status === 400 && (await json(badReason)).error === 'invalid_reason', 'block rejects long reason');

  // Block -> route 403 blocked with a generic message.
  const add = await adminCall('POST', { phone: `+${P3}`, reason: 'fake orders' }, oc);
  const added = await json(add);
  ok(add.status === 200 && added.ok === true && added.block.phone_norm === P3, 'block created (normalized)');
  const blocked = await postOrder(env, orderBody({ customer: { name: 'Layla Khoury', phone: P3, address: 'Hamra' }, location: TEST_PIN, idemKey: 'b1' }), '10.2.0.2');
  ok(blocked.status === 403 && blocked.data.error === 'rejected', 'blocked phone 403 rejected (same code as caps — no oracle)');
  ok(blocked.data.message && typeof blocked.data.message.ar === 'string' && blocked.data.message.ar.length > 0, 'blocked message generic Arabic-first');
  const bRows = await db.prepare('SELECT COUNT(*) AS c FROM orders WHERE phone_norm = ?1').bind(P3).first();
  ok(bRows.c === 1, 'blocked order stored nothing');

  // GET round-trip (contract: { ok, blocked: [{ phone_norm, reason, created_at }]}).
  const list = await adminCall('GET', undefined, oc);
  const listed = await json(list);
  ok(list.status === 200 && Array.isArray(listed.blocked) && listed.blocked.some((b) => b.phone_norm === P3), 'blocklist GET lists the block');

  // Unblock -> ordering works again.
  const del = await adminCall('DELETE', { phone: P3 }, oc);
  const deleted = await json(del);
  ok(del.status === 200 && deleted.ok === true && deleted.removed === true, 'unblock removes');
  const after = await postOrder(env, orderBody({ customer: { name: 'Layla Khoury', phone: P3, address: 'Hamra' }, location: TEST_PIN, idemKey: 'b2' }), '10.2.0.3');
  ok(after.status === 200, 'unblocked phone orders again');

  // Validator stays a pure function of body + menu: blocklist enforcement
  // lives in the route (single 'rejected' 403), never in validation.
  const v2 = validateOrderInput(orderBody(), MENU);
  ok(v2.ok === true, 'validator unaffected by blocklist (route-level concern)');
}

/* ---------------- 5. risk stored at insert + Telegram review line ---------------- */
{
  const db = migratedDb();
  const { env, ready } = freshEnv(db);
  await ready;
  // Flagged order: test-like name + 2 recent history orders = 65+ -> review.
  const PF = '71678901';
  await insertDirect(db, { phone: PF, status: 'completed' });
  await insertDirect(db, { phone: PF, status: 'completed' });
  const flagged = await postOrder(env, orderBody({ customer: { name: 'test', phone: PF, address: 'Hamra' }, location: TEST_PIN, idemKey: 'f1' }), '10.3.0.1');
  ok(flagged.status === 200, 'flagged order still accepted (flag, never block)');
  ok(!('riskScore' in (flagged.data || {})) && !('needsReview' in (flagged.data || {})), 'public response leaks no risk');
  const frow = await db.prepare('SELECT * FROM orders WHERE number = ?1').bind(flagged.data.orderNumber).first();
  ok(frow.risk_score >= 65, `risk stored at insert (${frow.risk_score})`);
  const fmapped = mapOrderRow(frow);
  ok(fmapped.needsReview === true && fmapped.riskReasons.length >= 2, 'stored flag reads needsReview with reasons');

  // Telegram first message carries the review line with human reasons only.
  const { orderRowToCleaned } = await import('../functions/_shared/telegram.js');
  const cleaned = orderRowToCleaned(frow);
  ok(cleaned.needsReview === true, 'cleaned shape carries needsReview');
  const msg = formatNewOrderMessage(cleaned, frow.number, 'ل.ل');
  ok(msg.includes('⚠️') && msg.includes('طلب يحتاج مراجعة'), 'Telegram review line present');
  ok(msg.includes('اسم تجريبي') && !msg.includes('test_name'), 'Telegram localizes codes, never leaks them');
  ok(!msg.includes('riskScore') && !msg.includes('risk_score'), 'Telegram leaks no score internals');
  // Rebuild path (status taps re-render from the DB row).
  const rebuilt = await rebuildOrderMessage(db, undefined, frow);
  ok(!!rebuilt && rebuilt.includes('⚠️') && rebuilt.includes('طلب يحتاج مراجعة'), 'rebuildOrderMessage keeps review line');

  // Clean order: no line anywhere.
  const PC = '71789012';
  const clean = await postOrder(env, orderBody({ customer: { name: 'Sara Nour', phone: PC, address: 'Hamra' }, location: TEST_PIN, idemKey: 'c1' }), '10.3.0.2');
  ok(clean.status === 200, 'clean order accepted');
  const crow = await db.prepare('SELECT * FROM orders WHERE number = ?1').bind(clean.data.orderNumber).first();
  const cmsg = formatNewOrderMessage(orderRowToCleaned(crow), crow.number, 'ل.ل');
  ok(!cmsg.includes('⚠️'), 'clean order has no review line');
  const crebuilt = await rebuildOrderMessage(db, undefined, crow);
  ok(!!crebuilt && !crebuilt.includes('⚠️'), 'clean rebuild has no review line');
}

/* ---------------- 5b. review dismissal: trust clears the badge ---------------- */
{
  const db = migratedDb();
  const { env, ready } = freshEnv(db);
  await ready;
  const { onRequest: orderPatchReq } = await import('../functions/api/admin/orders/[id].js');
  const PF = '71890123';
  await insertDirect(db, { phone: PF, status: 'completed' });
  await insertDirect(db, { phone: PF, status: 'completed' });
  const flagged = await postOrder(env, orderBody({ customer: { name: 'test', phone: PF, address: 'Hamra' }, location: TEST_PIN, idemKey: 'f9' }), '10.3.0.9');
  ok(flagged.status === 200, 'flagged order accepted for dismissal test');
  const frow = await db.prepare('SELECT * FROM orders WHERE number = ?1').bind(flagged.data.orderNumber).first();
  const oid = frow.id;
  ok(mapOrderRow(frow).needsReview === true, 'flagged order raises the badge');

  const oc = await ownerCookie();
  const kc = await kitchenCookie();
  // Admin order routes are plan-gated (pro); mirror a pro account here.
  const proEnv = { ...env, SITE_PLAN: 'pro' };
  const patchHdrs = (cookie) => ({
    'X-Requested-With': 'menu-admin',
    Origin: 'https://x',
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  });
  const patchCall = (body, cookie) =>
    orderPatchReq({
      request: new Request('https://x/api/admin/orders/x', {
        method: 'PATCH',
        headers: patchHdrs(cookie),
        body: JSON.stringify(body),
      }),
      env: proEnv,
      params: { id: oid },
    });

  // Bad body still rejected as before.
  const bad = await patchCall({ nope: 1 }, oc);
  ok(bad.status === 400 && (await json(bad)).error === 'invalid_status', 'review PATCH rejects unknown body');
  // Kitchen/client sessions fail closed on trust decisions.
  const denied = await patchCall({ reviewCleared: true }, kc);
  ok(denied.status === 403, 'review dismissal as kitchen 403');
  // Owner clears: badge gone, score/reasons kept as audit trail.
  const cleared = await patchCall({ reviewCleared: true }, oc);
  const clearedBody = await json(cleared);
  ok(cleared.status === 200 && clearedBody.order && clearedBody.order.needsReview === false, 'owner clears the badge');
  const after = mapOrderRow(await db.prepare('SELECT * FROM orders WHERE id = ?1').bind(oid).first());
  ok(after.needsReview === false && after.reviewCleared === true && after.riskScore >= 50 && after.riskReasons.length > 0, 'cleared row keeps score/reasons, drops the flag');
  const { orderRowToCleaned: cleaned2 } = await import('../functions/_shared/telegram.js');
  ok(cleaned2(await db.prepare('SELECT * FROM orders WHERE id = ?1').bind(oid).first()).needsReview === false, 'Telegram shape honors the dismissal');
}

/* ---------------- 6. migration 0032 ships the schema ---------------- */
{
  const sql = readFileSync(join(ROOT, 'migrations', '0032_phone_safety.sql'), 'utf8');
  ok(sql.includes('CREATE TABLE') && sql.includes('phone_blocks'), '0032 creates phone_blocks');
  ok(sql.includes('risk_score') && sql.includes('risk_reasons'), '0032 adds risk columns');
  const db = migratedDb();
  const t = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'phone_blocks'").first();
  ok(!!t, 'phone_blocks table applied');
  const cols = await db.prepare('SELECT name FROM pragma_table_info(?)').bind('orders').all();
  const names = cols.results.map((c) => c.name);
  ok(names.includes('risk_score') && names.includes('risk_reasons'), 'risk columns applied');
  const sql43 = readFileSync(join(ROOT, 'migrations', '0043_review_cleared.sql'), 'utf8');
  ok(sql43.includes('review_cleared'), '0043 adds review_cleared');
  ok(names.includes('review_cleared'), 'review_cleared column applied');
}

summary();
