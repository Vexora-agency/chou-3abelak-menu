// Feature tests: pause/closed blocking, location sharing, customer-data
// tool (masking, anonymize/delete/export, password, audit, rate limit),
// privacy-info, ordering-state endpoint, pause endpoint.
// Run: node scripts/test-features.mjs
import { getOrderingState } from '../functions/_shared/status.js';
import { validateOrderInput } from '../functions/_shared/orders.js';
import { maskName, maskPhone, digitsOnly } from '../functions/_shared/customer-data.js';
import { hasFeature } from '../functions/_shared/plan.js';
import { onRequest as ordersReq } from '../functions/api/orders.js';
import { onRequest as stateReq } from '../functions/api/ordering-state.js';
import { onRequest as pauseReq } from '../functions/api/admin/ordering/pause.js';
import { onRequest as privacyReq } from '../functions/api/privacy-info.js';
import { onRequest as cdStatusReq } from '../functions/api/admin/customer-data/status.js';
import { onRequest as cdSearchReq } from '../functions/api/admin/customer-data/search.js';
import { onRequest as cdActionReq } from '../functions/api/admin/customer-data/action.js';
import { generateMonthlyReport } from '../functions/_shared/reports.js';

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

/* ---------------- fakes ---------------- */

function makeKV() {
  const store = new Map();
  return {
    __store: store,
    async get(k, o) {
      const e = store.get(k);
      if (!e) return null;
      if (e.expiresAt && Date.now() > e.expiresAt) {
        store.delete(k);
        return null;
      }
      if (o && o.type === 'json') {
        try {
          return JSON.parse(e.value);
        } catch {
          return null;
        }
      }
      return e.value;
    },
    async put(k, v, o) {
      store.set(k, { value: typeof v === 'string' ? v : String(v), metadata: o && o.metadata, expiresAt: o && o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 });
    },
    async delete(k) {
      store.delete(k);
    },
    async list(o) {
      const out = [];
      for (const [name, e] of store) {
        if (o && o.prefix && !name.startsWith(o.prefix)) continue;
        out.push({ name, metadata: e.metadata });
      }
      return { keys: out };
    },
  };
}

function makeDB(orderRows) {
  const db = {
    orders: orderRows.map((o) => ({ ...o })),
    async batch(stmts) {
      for (const s of stmts) await s.run();
    },
    prepare(sql) {
      const st = {
        _a: [],
        bind(...a) {
          st._a = a;
          return st;
        },
        async first() {
          return qFirst(sql, st._a);
        },
        async all() {
          return { results: qAll(sql, st._a) };
        },
        async run() {
          return { meta: { changes: qRun(sql, st._a) } };
        },
      };
      return st;
    },
  };
  const like = (v, pat) => String(v == null ? '' : v).includes(String(pat).replace(/%/g, ''));
  function qFirst(sql, a) {
    if (sql.includes('FROM monthly_reports WHERE month')) return null;
    if (sql.includes('COALESCE(SUM(total)')) {
      const rows = db.orders.filter((o) => o.created_at >= a[0] && o.created_at < a[1] && o.status !== 'cancelled');
      return { c: rows.length, rev: rows.reduce((s, o) => s + o.total, 0) };
    }
    if (sql.includes('SELECT MAX(number)')) {
      return { m: db.orders.reduce((m, o) => Math.max(m, o.number || 0), 1000) };
    }
    if (sql.includes('FROM orders WHERE idem_key')) return null;
    if (sql.includes('SELECT MIN(created_at)')) {
      const ms = db.orders.map((o) => o.created_at).sort();
      return { m: ms.length ? ms[0] : null };
    }
    throw new Error('fake first: ' + sql.slice(0, 60));
  }
  function qAll(sql, a) {
    if (sql.includes('GROUP BY status')) {
      const m = new Map();
      for (const o of db.orders.filter((x) => x.created_at >= a[0] && x.created_at < a[1])) m.set(o.status, (m.get(o.status) || 0) + 1);
      return [...m.entries()].map(([status, c]) => ({ status, c }));
    }
    if (sql.includes('ORDER BY number ASC')) {
      return db.orders.filter((o) => o.created_at >= a[0] && o.created_at < a[1]).sort((x, y) => x.number - y.number);
    }
    if (sql.includes('ORDER BY created_at DESC LIMIT 50')) {
      return db.orders.filter((o) => like(o.phone_norm, a[0])).slice(0, 50);
    }
    if (sql.includes('phone_norm LIKE')) {
      return db.orders.filter((o) => like(o.phone_norm, a[0] === undefined ? a[1] : a[a.length - 1])).slice(0, 50);
    }
    if (sql.includes('SELECT month FROM monthly_reports')) return [];
    throw new Error('fake all: ' + sql.slice(0, 60));
  }
  function qRun(sql, a) {
    if (sql.startsWith('INSERT INTO orders')) {
      const cols = ['id', 'number', 'idem_key', 'created_at', 'updated_at', 'status', 'type', 'customer_name', 'customer_phone', 'phone_norm', 'customer_address', 'customer_table', 'notes', 'location_lat', 'location_lng', 'items_json', 'subtotal', 'delivery_fee', 'total', 'lang'];
      const row = {};
      cols.forEach((c, i) => { row[c] = a[i] === undefined ? null : a[i]; });
      row.pii_purged_at = null;
      db.orders.push(row);
      return 1;
    }
    if (sql.startsWith('INSERT INTO monthly_reports')) return 1;
    if (sql.includes('SET customer_name = NULL')) {
      let n = 0;
      for (const o of db.orders) {
        const match = a.length === 2 ? like(o.phone_norm, a[1]) : o.created_at < a[1] && (o.pii_purged_at === null || o.pii_purged_at === undefined);
        if (match) {
          o.customer_name = null;
          o.customer_phone = null;
          o.phone_norm = null;
          o.customer_address = null;
          o.customer_table = null;
          o.notes = null;
          o.location_lat = null;
          o.location_lng = null;
          o.pii_purged_at = a[0];
          n += 1;
        }
      }
      return n;
    }
    if (sql.startsWith('DELETE FROM orders')) {
      const before = db.orders.length;
      db.orders = db.orders.filter((o) => !like(o.phone_norm, a[0]));
      return before - db.orders.length;
    }
    throw new Error('fake run: ' + sql.slice(0, 60));
  }
  return db;
}

const H = { 'X-Requested-With': 'menu-admin', Origin: 'https://x' };
function req(method, url, { headers, body } = {}) {
  return new Request(url, { method, headers: { ...H, ...(headers || {}) }, body: body === undefined ? undefined : body });
}
async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const MENU = {
  version: 3,
  schemaVersion: 2,
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    name: { en: 'T', ar: 'م' }, tagline: { en: '', ar: '' }, address: { en: '', ar: '' },
    hoursText: { en: '', ar: '' }, currency: { en: 'LBP', ar: 'ل.ل' }, logoText: 'T',
    phone: '70123456', whatsapp: '96170123456', mapUrl: '', statusMode: 'auto',
    openTime: '00:00', closeTime: '00:00', workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'],
    timezone: 'Asia/Beirut', social: {}, socialEnabled: {}, about: { en: '', ar: '' },
    ordering: { enabled: true, types: ['delivery'], minOrder: 0, minOrderEnabled: false, deliveryFee: 0, deliveryFeeEnabled: false, note: { en: '', ar: '' }, paused: false, pausedUntil: null, pausedMessage: { en: '', ar: '' }, acceptWhenClosed: false },
    featureGroups: [], featureDefs: [], badges: { newDays: 1, topDays: 1, topCount: 1 },
    announcement: { enabled: false, text: { en: '', ar: '' }, startsAt: null, expiresAt: null },
    privacy: { extra: { en: '', ar: '' }, reviewed: false },
  },
  categories: [{ id: 'c1', name: { en: 'Pies', ar: 'فطائر' }, visible: true }],
  items: [{
    id: 'zaatar', categoryId: 'c1', name: { en: 'Zaatar', ar: 'زعتر' }, description: { en: '', ar: '' },
    pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 100000 },
    addons: [], badges: [], featured: false, available: true,
  }],
  addonGroups: [],
};

function orderBody(over = {}) {
  return {
    type: 'delivery',
    customer: { name: 'John', phone: '70123456', address: 'Hamra' },
    notes: '',
    items: [{ id: 'zaatar', qty: 1 }],
    lang: 'en',
    ...over,
  };
}
function mkOrderRow(n, created, phone, status = 'completed') {
  return {
    id: `o${n}`, number: 1000 + n, idem_key: null, created_at: created, updated_at: created,
    status, type: 'delivery', customer_name: 'John Doe', customer_phone: phone, phone_norm: String(phone).replace(/[^0-9]/g, ''),
    customer_address: 'Hamra', customer_table: null, notes: 'note', location_lat: 33.9, location_lng: 35.5,
    items_json: '[]', subtotal: 100, delivery_fee: 0, total: 100, lang: 'en', pii_purged_at: null,
  };
}

/* ---------------- 1. location validation ---------------- */
{
  const m = JSON.parse(JSON.stringify(MENU));
  const good = validateOrderInput(orderBody({ location: { lat: 33.89352, lng: 35.50161, accuracy: 25 } }), m);
  ok(good.ok && good.cleaned.location && good.cleaned.location.lat === 33.89352, 'valid location accepted + kept');
  ok(validateOrderInput(orderBody({ location: { lat: 91, lng: 0 } }), m).errors.includes('invalid_location'), 'lat > 90 rejected');
  ok(validateOrderInput(orderBody({ location: { lat: 0, lng: -181 } }), m).errors.includes('invalid_location'), 'lng < -180 rejected');
  ok(validateOrderInput(orderBody({ location: { lat: NaN, lng: 0 } }), m).errors.includes('invalid_location'), 'NaN rejected');
  const rounded = validateOrderInput(orderBody({ location: { lat: 33.8935249, lng: 35.5016151 } }), m);
  ok(rounded.ok && rounded.cleaned.location.lat === 33.89352 && rounded.cleaned.location.lng === 35.50162, 'rounded to 5 decimals');
  const pickup = validateOrderInput(orderBody({ type: 'pickup', location: { lat: 10, lng: 10 } }), { ...m, settings: { ...m.settings, ordering: { ...m.settings.ordering, types: ['delivery', 'pickup'] } } });
  ok(pickup.ok && pickup.cleaned.location === null, 'location ignored for non-delivery');
  ok(validateOrderInput(orderBody(), m).cleaned.location === null, 'absent location is null');
  ok(validateOrderInput(orderBody(), m).cleaned.phoneNorm === '70123456', 'phone_norm filled');
}

/* ---------------- 2. POST /api/orders gating + insert ---------------- */
async function postOrder(env, body) {
  const res = await ordersReq({
    request: req('POST', 'https://x/api/orders', { headers: { 'Content-Type': 'application/json', Origin: 'https://x' }, body: JSON.stringify(body) }),
    env,
  });
  return { status: res.status, data: await json(res) };
}
{
  // paused -> 403, nothing recorded
  const kv = makeKV();
  await kv.put('menu', JSON.stringify({ ...MENU, settings: { ...MENU.settings, ordering: { ...MENU.settings.ordering, paused: true } } }));
  const db = makeDB([]);
  const r = await postOrder({ MENU_KV: kv, ORDERS_DB: db }, orderBody());
  ok(r.status === 403 && r.data.error === 'paused' && r.data.message && r.data.message.en.length > 0, 'POST 403 when paused with message');
  ok(db.orders.length === 0, 'paused order not recorded');
  // disabled -> 403 disabled
  const kv2 = makeKV();
  await kv2.put('menu', JSON.stringify({ ...MENU, settings: { ...MENU.settings, ordering: { ...MENU.settings.ordering, enabled: false } } }));
  const r2 = await postOrder({ MENU_KV: kv2, ORDERS_DB: makeDB([]) }, orderBody());
  ok(r2.status === 403 && r2.data.error === 'disabled', 'POST 403 when disabled');
  // closed (statusMode) -> 403 closed
  const kv3 = makeKV();
  await kv3.put('menu', JSON.stringify({ ...MENU, settings: { ...MENU.settings, statusMode: 'closed' } }));
  const r3 = await postOrder({ MENU_KV: kv3, ORDERS_DB: makeDB([]) }, orderBody());
  ok(r3.status === 403 && r3.data.error === 'closed', 'POST 403 when closed');
  // open -> 200 with location + phone_norm stored
  const kv4 = makeKV();
  await kv4.put('menu', JSON.stringify(MENU));
  const db4 = makeDB([]);
  const r4 = await postOrder({ MENU_KV: kv4, ORDERS_DB: db4 }, orderBody({ location: { lat: 33.9, lng: 35.5, accuracy: 30 } }));
  if (r4.status !== 200) console.log('DBG open:', r4.status, JSON.stringify(r4.data));
  ok(r4.status === 200 && db4.orders.length === 1, 'open order recorded');
  ok(db4.orders[0].location_lat === 33.9 && db4.orders[0].location_lng === 35.5 && db4.orders[0].phone_norm === '70123456', 'location + phone_norm stored');
  // invalid location -> 400, nothing stored
  const r5 = await postOrder({ MENU_KV: kv4, ORDERS_DB: db4 }, orderBody({ location: { lat: 200, lng: 0 } }));
  ok(r5.status === 400 && db4.orders.length === 1, 'invalid location rejected');
}

/* ---------------- 3. ordering-state + pause endpoints ---------------- */
{
  const kv = makeKV();
  await kv.put('menu', JSON.stringify(MENU));
  const res = await stateReq({ request: req('GET', 'https://x/api/ordering-state'), env: { MENU_KV: kv } });
  const d = await json(res);
  ok(res.status === 200 && d.state === 'open' && typeof d.serverTime === 'string', 'ordering-state open shape');
  const kv2 = makeKV();
  await kv2.put('menu', JSON.stringify({ ...MENU, settings: { ...MENU.settings, ordering: { ...MENU.settings.ordering, paused: true, pausedUntil: null } } }));
  const res2 = await stateReq({ request: req('GET', 'https://x/api/ordering-state'), env: { MENU_KV: kv2 } });
  const d2 = await json(res2);
  ok(d2.state === 'paused' && d2.message.en.length > 0 && !d2.reopensAt, 'ordering-state paused indefinite');
  // pause endpoint validation
  const bad = await pauseReq({ request: req('POST', 'https://x/api/admin/ordering/pause', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 45 }) }), env: { MENU_KV: kv } });
  ok(bad.status === 400, 'pause rejects bad minutes');
  const p1 = await pauseReq({ request: req('POST', 'https://x/api/admin/ordering/pause', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 30 }) }), env: { MENU_KV: kv } });
  const p1d = await json(p1);
  ok(p1.status === 200 && p1d.ok && p1d.paused === true && typeof p1d.pausedUntil === 'string', 'pause 30m works');
  const afterPause = await kv.get('menu', { type: 'json' });
  ok(afterPause.settings.ordering.paused === true && afterPause.version === 4, 'only pause fields change + version bump');
  const pr = await pauseReq({ request: req('POST', 'https://x/api/admin/ordering/pause', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: true }) }), env: { MENU_KV: kv } });
  const prd = await json(pr);
  ok(prd.ok && prd.paused === false && prd.pausedUntil === null, 'resume clears pause');
}

/* ---------------- 4. masking + customer tool ---------------- */
{
  ok(maskName('John Doe') === 'J*** D***', 'name masked to initials');
  ok(maskName('') === '', 'empty name stays empty');
  ok(maskPhone('70123456') === '70****56', 'phone middle hidden');
  ok(digitsOnly('+961 70-123 456') === '96170123456', 'digits extraction');

  const db = makeDB([
    mkOrderRow(1, '2026-09-01T10:00:00.000Z', '70123456'),
    mkOrderRow(2, '2026-09-02T10:00:00.000Z', '70123456'),
    mkOrderRow(3, '2026-09-03T10:00:00.000Z', '70999999'),
  ]);
  const env = { MENU_KV: makeKV(), ORDERS_DB: db, SITE_PLAN: 'signature', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: 'x', AUDIT_SECRET: 'audit-secret-12345678901234567890' };
  // need a real hash for password checks
  const { execSync } = await import('node:child_process');
  const hash = execSync('node scripts/hash-password.mjs "test-pass-9"', { cwd: process.cwd() }).toString().trim().split('\n').pop();
  env.ADMIN_PASSWORD_HASH = hash;
  const search = async (phone) => {
    const res = await cdSearchReq({ request: req('GET', `https://x/api/admin/customer-data/search?phone=${phone}`), env });
    return { status: res.status, data: await json(res) };
  };
  const action = async (payload) => {
    const res = await cdActionReq({ request: req('POST', 'https://x/api/admin/customer-data/action', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), env });
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/csv')) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, csv: new TextDecoder().decode(buf), csvBytes: buf };
    }
    return { status: res.status, data: await json(res) };
  };
  const s1 = await search('123456');
  ok(s1.status === 200 && s1.data.count === 2, 'partial phone matches 2');
  ok(s1.data.results[0].name === 'J*** D***' && s1.data.results[0].phone === '70****56', 'results masked');
  ok(!JSON.stringify(s1.data).includes('70123456'), 'no raw phone in results');
  ok((await search('123')).status === 400, 'min 6 digits enforced');
  // wrong password
  const w = await action({ phone: '70123456', mode: 'anonymize', password: 'nope', confirm: 'DELETE' });
  ok(w.status === 403 && w.data.error === 'invalid_password', 'wrong password rejected');
  // missing confirmation word
  const w2 = await action({ phone: '70123456', mode: 'anonymize', password: 'test-pass-9', confirm: 'yes' });
  ok(w2.status === 400, 'confirmation word required');
  // anonymize
  const a = await action({ phone: '70123456', mode: 'anonymize', password: 'test-pass-9', confirm: 'DELETE' });
  ok(a.status === 200 && a.data.ok && a.data.count === 2, 'anonymize works');
  const o1 = db.orders.find((o) => o.id === 'o1');
  ok(o1.customer_name === null && o1.phone_norm === null && o1.location_lat === null && o1.pii_purged_at !== null, 'anonymize NULLs PII + location + marks');
  ok(db.orders.find((o) => o.id === 'o3').customer_name === 'John Doe', 'other numbers untouched');
  // export CSV (on remaining number)
  const e = await action({ phone: '70999999', mode: 'export', password: 'test-pass-9', confirm: 'حذف' });
  ok(e.status === 200 && e.csvBytes[0] === 0xef && e.csvBytes[1] === 0xbb && e.csvBytes[2] === 0xbf, 'export CSV with BOM bytes');
  ok(e.csv.includes('70999999') && e.csv.split('\n')[0].startsWith('order_id,'), 'export has full fields');
  // delete
  const d = await action({ phone: '70999999', mode: 'delete', password: 'test-pass-9', confirm: 'DELETE' });
  ok(d.status === 200 && d.data.count === 1 && !db.orders.some((o) => o.id === 'o3'), 'delete removes rows');
  // audit: no PII, hashed phone
  const audits = [...env.MENU_KV.__store.entries()].filter(([k]) => k.startsWith('audit:'));
  ok(audits.length === 3, `3 audit entries (${audits.length})`);
  const bodies = audits.map(([, v]) => v.value).join(' ');
  ok(!bodies.includes('70123456') && !bodies.includes('70999999') && !bodies.includes('John'), 'audit holds no PII');
  ok(audits.every(([, v]) => /"phoneHash":"[0-9a-f]{12}"/.test(v.value)), 'audit has 12-hex phone hash');
  // rate limit: 10/hour — burn through then expect 429
  for (let i = 0; i < 7; i++) {
    await action({ phone: '70000000', mode: 'anonymize', password: 'test-pass-9', confirm: 'DELETE' });
  }
  const rl = await action({ phone: '70000000', mode: 'anonymize', password: 'test-pass-9', confirm: 'DELETE' });
  ok(rl.status === 429, 'rate limited at 10/hour');
  // feature off -> 404s
  const off = { MENU_KV: makeKV(), ORDERS_DB: makeDB([]) };
  const sOff = await cdStatusReq({ request: req('GET', 'https://x/api/admin/customer-data/status'), env: off });
  ok(sOff.status === 404, 'tool hidden without orderLogging');
  const sOn = await cdStatusReq({ request: req('GET', 'https://x/api/admin/customer-data/status'), env });
  ok(sOn.status === 200, 'tool visible with orderLogging');
}

/* ---------------- 5. privacy-info + report CSV exclusion ---------------- */
{
  const r = await privacyReq({ request: req('GET', 'https://x/api/privacy-info'), env: { SITE_PLAN: 'signature' } });
  const d = await json(r);
  ok(r.status === 200 && d.piiDays === 90 && d.orderMonths === 13 && d.reportMonths === 36 && d.hasOrderRecords === false, 'privacy-info defaults (no D1 bound here)');
  // monthly CSV never includes location columns
  const db = makeDB([mkOrderRow(1, '2026-09-12T17:05:00.000Z', '70123456')]);
  const kv = makeKV();
  await kv.put('menu', JSON.stringify(MENU));
  const gen = await generateMonthlyReport({ ORDERS_DB: db, MENU_KV: kv }, '2026-09');
  ok(gen.summary.totals.orders === 1, 'report aggregates with location rows present');
  const { getMonthCSV } = await import('../functions/_shared/reports.js');
  const got = await getMonthCSV({ ORDERS_DB: db, MENU_KV: kv }, '2026-09');
  ok(got && !got.csv.includes('location') && !got.csv.includes('35.5'), 'report CSV excludes location');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
