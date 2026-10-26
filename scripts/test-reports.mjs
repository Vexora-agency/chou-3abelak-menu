// Unit tests for monthly reporting: DST month bounds, aggregation, CSV
// (BOM, escaping, Arabic, no PII), idempotency, retention guard, tokens,
// email validation and plan gating.
// Run: node scripts/test-reports.mjs
import {
  buildCSV,
  buildEmailPayload,
  currentMonthInTZ,
  dayOfMonthInTZ,
  generateMonthlyReport,
  getRetentionConfig,
  isValidMonth,
  isValidReportEmail,
  monthBoundsUTC,
  newVerifyToken,
  prevMonth,
  runRetention,
  sha256Hex,
  summarizeMonth,
  verifyExpiryISO,
} from '../functions/_shared/reports.js';
import { featureOffResponse, hasFeature } from '../functions/_shared/plan.js';

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

/* ---------------- Fake bindings ---------------- */

function makeKV(menuObj) {
  const store = new Map();
  return {
    async get(k, opts) {
      if (k === 'menu' && opts && opts.type === 'json') return menuObj;
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      store.set(k, v);
    },
  };
}

function makeR2() {
  const store = new Map();
  return {
    puts: 0,
    deletes: [],
    async put(k, v) {
      this.puts += 1;
      store.set(k, v);
    },
    async get(k) {
      if (!store.has(k)) return null;
      const v = store.get(k);
      return { text: async () => v };
    },
    async delete(k) {
      this.deletes.push(k);
      store.delete(k);
    },
  };
}

// Minimal in-memory D1 over fixture rows. Dispatches on the exact query
// shapes used by functions/_shared/reports.js (all statements use bind()).
function makeDB(orderRows, reportRows) {
  const db = {
    orders: orderRows.map((o) => ({ ...o })),
    reports: reportRows.map((r) => ({ ...r })),
    prepare(sql) {
      const st = {
        _args: [],
        bind(...args) {
          st._args = args;
          return st;
        },
        async first() {
          return dispatchFirst(sql, st._args);
        },
        async all() {
          return { results: dispatchAll(sql, st._args) };
        },
        async run() {
          return { meta: { changes: dispatchRun(sql, st._args) } };
        },
      };
      return st;
    },
  };
  function inBounds(o, from, to) {
    return o.created_at >= from && o.created_at < to;
  }
  function dispatchFirst(sql, a) {
    if (sql.includes('FROM report_settings')) return null;
    if (sql.includes('FROM monthly_reports WHERE month')) {
      return db.reports.find((r) => r.month === a[0]) || null;
    }
    if (sql.includes('COALESCE(SUM(total)')) {
      const rows = db.orders.filter((o) => inBounds(o, a[0], a[1]) && o.status !== 'cancelled');
      return { c: rows.length, rev: rows.reduce((s, o) => s + o.total, 0) };
    }
    if (sql.includes('SELECT MIN(created_at)')) {
      const ms = db.orders.map((o) => o.created_at).sort();
      return { m: ms.length ? ms[0] : null };
    }
    throw new Error(`fake-db: unhandled first(): ${sql}`);
  }
  function dispatchAll(sql, a) {
    if (sql.includes('GROUP BY status')) {
      const map = new Map();
      for (const o of db.orders.filter((o) => inBounds(o, a[0], a[1]))) {
        map.set(o.status, (map.get(o.status) || 0) + 1);
      }
      return [...map.entries()].map(([status, c]) => ({ status, c }));
    }
    if (sql.includes('ORDER BY number ASC')) {
      return db.orders.filter((o) => inBounds(o, a[0], a[1])).sort((x, y) => x.number - y.number);
    }
    if (sql.includes('SELECT month FROM monthly_reports WHERE month <')) {
      return db.reports.filter((r) => r.month < a[0]).map((r) => ({ month: r.month }));
    }
    if (sql.includes('SELECT month FROM monthly_reports')) {
      return db.reports.map((r) => ({ month: r.month }));
    }
    throw new Error(`fake-db: unhandled all(): ${sql}`);
  }
  function dispatchRun(sql, a) {
    if (sql.includes('INSERT INTO monthly_reports')) {
      if (db.reports.some((r) => r.month === a[0])) throw new Error('UNIQUE constraint');
      db.reports.push({ month: a[0], summary_json: a[1], csv_key: a[2], generated_at: a[3], emailed_at: null, email_status: null, email_attempts: 0 });
      return 1;
    }
    if (sql.includes('SET customer_name = NULL')) {
      let n = 0;
      for (const o of db.orders) {
        if (o.created_at < a[1] && (o.pii_purged_at === null || o.pii_purged_at === undefined)) {
          o.customer_name = null;
          o.customer_phone = null;
          o.customer_address = null;
          o.notes = null;
          o.pii_purged_at = a[0];
          n += 1;
        }
      }
      return n;
    }
    if (sql.includes('DELETE FROM orders')) {
      const before = db.orders.length;
      db.orders = db.orders.filter((o) => !(o.created_at < a[0] && o.pii_purged_at !== null && o.pii_purged_at !== undefined));
      return before - db.orders.length;
    }
    if (sql.includes('DELETE FROM monthly_reports')) {
      const before = db.reports.length;
      db.reports = db.reports.filter((r) => !(r.month < a[0]));
      return before - db.reports.length;
    }
    throw new Error(`fake-db: unhandled run(): ${sql}`);
  }
  return db;
}

const MENU = {
  settings: {
    timezone: 'Asia/Beirut',
    name: { en: 'Chou 3abelak', ar: 'شو عبالك' },
    currency: { en: 'LBP', ar: 'ل.ل' },
  },
  items: [],
};

function item(id, en, ar, qty, unitPrice, extra) {
  return { id, name: { en, ar }, qty, unitPrice, ...(extra || {}) };
}
// Sep 2026 in Beirut is UTC+3: 20:00 local == 17:00Z.
function mkOrder(number, created_at, status, type, items, subtotal, fee, total) {
  return {
    id: `o${number}`,
    number,
    created_at,
    updated_at: created_at,
    status,
    type,
    customer_name: 'John Doe',
    customer_phone: '70123456',
    customer_address: 'Beirut, Hamra',
    customer_table: null,
    notes: 'no onions please',
    items_json: JSON.stringify(items),
    subtotal,
    delivery_fee: fee,
    total,
    lang: 'en',
    pii_purged_at: null,
  };
}

const SEP_ORDERS = [
  mkOrder(1001, '2026-09-12T17:05:00.000Z', 'completed', 'delivery',
    [item('zaatar', 'Plain Zaatar', 'زعتر سادة', 2, 150000)], 300000, 20000, 320000),
  mkOrder(1002, '2026-09-12T17:40:00.000Z', 'completed', 'delivery',
    [item('zaatar', 'Plain Zaatar', 'زعتر سادة', 1, 150000), item('pepsi', 'Pepsi', 'بيبسي', 2, 30000)], 210000, 20000, 230000),
  mkOrder(1003, '2026-09-05T10:00:00.000Z', 'completed', 'pickup',
    [item('pizza', 'Veggie Pizza, Large "Special"', 'بيتزا', 1, 400000, { variantName: { en: 'Large', ar: 'كبير' } })], 400000, 0, 400000),
  mkOrder(1004, '2026-09-12T09:00:00.000Z', 'cancelled', 'delivery',
    [item('zaatar', 'Plain Zaatar', 'زعتر سادة', 1, 100000)], 100000, 0, 100000),
  mkOrder(1005, '2026-08-15T12:00:00.000Z', 'completed', 'dinein',
    [item('pepsi', 'Pepsi', 'بيبسي', 4, 30000)], 120000, 0, 120000),
];

/* ---------------- 1. Month math ---------------- */

ok(isValidMonth('2026-09') && !isValidMonth('2026-13') && !isValidMonth('sep') && !isValidMonth('2026-9'), 'month validation');
ok(prevMonth('2026-09') === '2026-08', 'prev month simple');
ok(prevMonth('2026-01') === '2025-12', 'prev month year wrap');

const mar = monthBoundsUTC('Asia/Beirut', '2026-03');
ok(mar.start === '2026-02-28T22:00:00.000Z', `mar start across STD (+02:00), got ${mar.start}`);
ok(mar.end === '2026-03-31T21:00:00.000Z', `mar end across DST (+03:00 from Mar 29), got ${mar.end}`);

const oct = monthBoundsUTC('Asia/Beirut', '2026-10');
ok(oct.start === '2026-09-30T21:00:00.000Z', `oct start in DST (+03:00), got ${oct.start}`);
ok(oct.end === '2026-10-31T22:00:00.000Z', `oct end after DST ends Oct 25 (+02:00), got ${oct.end}`);

ok(currentMonthInTZ('Asia/Beirut', Date.UTC(2026, 8, 30, 21, 30)) === '2026-10', 'TZ month rolls at local midnight (Sep 30 21:30Z == Oct 1 00:30+03)');
ok(dayOfMonthInTZ('Asia/Beirut', Date.UTC(2026, 8, 30, 20, 59)) === 30, 'TZ day before midnight');
ok(dayOfMonthInTZ('Asia/Beirut', Date.UTC(2026, 8, 30, 21, 30)) === 1, 'TZ day after midnight');

/* ---------------- 2. Aggregation ---------------- */

const env = { ORDERS_DB: makeDB(SEP_ORDERS, []), REPORTS: makeR2(), MENU_KV: makeKV(MENU) };
const gen = await generateMonthlyReport(env, '2026-09');
const s = gen.summary;
ok(gen.reused === false && gen.month === '2026-09', 'first generate stores');
ok(s.totals.orders === 3, `orders excl. cancelled (got ${s.totals.orders})`);
ok(s.totals.revenue === 950000, `revenue (got ${s.totals.revenue})`);
ok(Math.abs(s.totals.avg - 950000 / 3) < 0.01, `avg (got ${s.totals.avg})`);
ok(s.totals.completed === 3 && s.totals.cancelled === 1, 'completed/cancelled counts');
ok(s.types.delivery === 2 && s.types.pickup === 1 && s.types.dinein === 0, `type split ${JSON.stringify(s.types)}`);
ok(s.prev.orders === 1 && s.prev.revenue === 120000 && s.prev.avg === 120000, `prev month ${JSON.stringify(s.prev)}`);
ok(s.busiestDay && s.busiestDay.date === '2026-09-12' && s.busiestDay.orders === 2, `busiest day ${JSON.stringify(s.busiestDay)}`);
ok(s.peakHour === 20, `peak hour Beirut time (got ${s.peakHour})`);
ok(s.topItems.length >= 1 && s.topItems[0].qty === 3 && s.topItems[0].name.en === 'Plain Zaatar', `top item ${JSON.stringify(s.topItems[0])}`);
ok(gen.csvKey === 'reports/2026-09.csv', 'R2 key shape');

/* ---------------- 3. CSV ---------------- */

const rows = [
  { number: 1001, createdAt: '2026-09-12T17:05:00.000Z', type: 'delivery', status: 'completed', items: [{ id: 'z', name: { en: 'Plain Zaatar', ar: 'زعتر سادة' }, qty: 2 }], subtotal: 300000, deliveryFee: 20000, total: 320000 },
  { number: 1003, createdAt: '2026-09-05T10:00:00.000Z', type: 'pickup', status: 'completed', items: [{ id: 'p', name: { en: 'Veggie Pizza, Large "Special"', ar: 'بيتزا' }, qty: 1, variantName: { en: 'Large', ar: 'كبير' } }], subtotal: 400000, deliveryFee: 0, total: 400000 },
];
const csv = buildCSV(rows, 'Asia/Beirut');
ok(csv.charCodeAt(0) === 0xfeff, 'CSV starts with UTF-8 BOM');
const lines = csv.replace(/^﻿/, '').trim().split('\n');
ok(lines[0] === 'order_number,date,time,type,status,items,subtotal,delivery_fee,total', 'CSV header columns');
ok(lines[1].startsWith('1001,2026-09-12,20:05,'), `CSV Beirut date/time, got ${lines[1].slice(0, 24)}`);
ok(lines[2].includes('"Veggie Pizza, Large ""Special"" / بيتزا (Large / كبير) x 1"'), `CSV escaping + variant + both languages, got ${lines[2]}`);
ok(csv.includes('زعتر سادة') && csv.includes('بيتزا'), 'CSV keeps Arabic text');
for (const pii of ['John Doe', '70123456', 'Hamra', 'no onions', 'customer', 'phone', 'address', 'notes']) {
  ok(!csv.toLowerCase().includes(pii.toLowerCase()), `CSV has no PII (${pii})`);
}

/* ---------------- 4. Idempotency ---------------- */

const putsBefore = env.REPORTS.puts;
const gen2 = await generateMonthlyReport(env, '2026-09');
ok(gen2.reused === true, 'second generate reuses stored report');
ok(JSON.stringify(gen2.summary) === JSON.stringify(gen.summary), 'reused summary identical');
ok(env.REPORTS.puts === putsBefore, 'no second R2 put on reuse');

/* ---------------- 5. Retention ---------------- */

function mkRow(iso, withPII, n) {
  return {
    id: `old-${n}-${Math.random().toString(36).slice(2)}`,
    number: 1000 + n,
    created_at: iso,
    updated_at: iso,
    status: 'completed',
    type: 'delivery',
    customer_name: withPII ? 'Jane' : null,
    customer_phone: withPII ? '70000000' : null,
    customer_address: withPII ? 'Somewhere' : null,
    customer_table: null,
    notes: withPII ? 'note' : null,
    items_json: '[]',
    subtotal: 100,
    delivery_fee: 0,
    total: 100,
    lang: 'en',
    pii_purged_at: withPII ? null : new Date().toISOString(),
  };
}
function utcMonthOf(iso) {
  return iso.slice(0, 7);
}
// Deterministic old order: noon on the 15th, 3 UTC months ago — always
// older than a 30-day PII window and mid-month (never on a guard boundary).
function midMonthOrder(withPII) {
  const now = new Date();
  const iso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 15, 12, 0, 0)).toISOString();
  return mkRow(iso, withPII, 100);
}
// Recent order: 10 days ago (always inside the PII window).
function recentOrder(withPII) {
  const iso = new Date(Date.now() - 10 * 86400000).toISOString();
  return mkRow(iso, withPII, 10);
}

// T1: purge old reported month, keep recent unreported month.
{
  const a = midMonthOrder(true);
  const b = recentOrder(true);
  const db = makeDB([a, b], [{ month: utcMonthOf(a.created_at), summary_json: '{}', csv_key: null, generated_at: a.created_at, emailed_at: a.created_at, email_status: 'sent', email_attempts: 1 }]);
  const r = await runRetention({ ORDERS_DB: db, PII_RETENTION_DAYS: 30, ORDER_RETENTION_MONTHS: 120, REPORT_RETENTION_MONTHS: 36 });
  const kept = db.orders;
  const ra = kept.find((o) => o.id === a.id);
  const rb = kept.find((o) => o.id === b.id);
  ok(r.purged === 1, `purges old reported month (got ${r.purged})`);
  ok(ra && ra.customer_name === null && ra.pii_purged_at !== null, 'purged row NULLed + marked');
  ok(rb && rb.customer_name === 'Jane', 'recent unreported month untouched');
}
// T2: hard rule — unreported old month is never touched.
{
  const a = midMonthOrder(true);
  const b = recentOrder(true);
  const db = makeDB([a, b], []);
  const r = await runRetention({ ORDERS_DB: db, PII_RETENTION_DAYS: 30, ORDER_RETENTION_MONTHS: 120, REPORT_RETENTION_MONTHS: 36 });
  const ra = db.orders.find((o) => o.id === a.id);
  ok(r.purged === 0 && ra && ra.customer_name === 'Jane', 'unreported month keeps PII');
}
// T3: anonymized old rows are deleted; recent kept.
{
  const a = midMonthOrder(true);
  const b = recentOrder(true);
  const db = makeDB([a, b], [{ month: utcMonthOf(a.created_at), summary_json: '{}', csv_key: null, generated_at: a.created_at, emailed_at: a.created_at, email_status: 'sent', email_attempts: 1 }]);
  const r = await runRetention({ ORDERS_DB: db, PII_RETENTION_DAYS: 30, ORDER_RETENTION_MONTHS: 1, REPORT_RETENTION_MONTHS: 36 });
  ok(r.deletedOrders === 1, `deletes old anonymized row (got ${r.deletedOrders})`);
  ok(!db.orders.some((o) => o.id === a.id) && db.orders.some((o) => o.id === b.id), 'only the old row deleted');
}
// T4: old report rows + R2 CSVs are deleted past the window.
{
  const d = new Date();
  const oldYm = `${d.getUTCFullYear() - 4}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const r2 = makeR2();
  await r2.put(`reports/${oldYm}.csv`, 'x');
  const db = makeDB([], [{ month: oldYm, summary_json: '{}', csv_key: `reports/${oldYm}.csv`, generated_at: oldYm, emailed_at: oldYm, email_status: 'sent', email_attempts: 1 }]);
  const r = await runRetention({ ORDERS_DB: db, REPORTS: r2, PII_RETENTION_DAYS: 30, ORDER_RETENTION_MONTHS: 120, REPORT_RETENTION_MONTHS: 36 });
  ok(r.deletedReports === 1 && db.reports.length === 0, 'old report row deleted');
  ok(r2.deletes.includes(`reports/${oldYm}.csv`), 'old R2 CSV deleted');
}
ok(JSON.stringify(getRetentionConfig({})) === JSON.stringify({ piiDays: 90, orderMonths: 13, reportMonths: 36 }), 'retention defaults');
ok(getRetentionConfig({ PII_RETENTION_DAYS: 'x', ORDER_RETENTION_MONTHS: -5 }).orderMonths === 1, 'retention sanitizes bad input');

/* ---------------- 6. Tokens, email, plans ---------------- */

{
  const { token, hash } = await newVerifyToken();
  ok(/^[0-9a-f]{64}$/.test(token) && /^[0-9a-f]{64}$/.test(hash), 'token + hash shape');
  ok((await sha256Hex(token)) === hash, 'hash verifies');
  ok(Date.parse(verifyExpiryISO()) - Date.now() > 47 * 3600 * 1000, 'token valid ~48h');
}
ok(isValidReportEmail('owner@restaurant.com') && !isValidReportEmail('not-an-email') && !isValidReportEmail('a@b') && !isValidReportEmail(''), 'email validation');
ok(hasFeature({}, 'monthlyReports') === false, 'starter (default) has no monthlyReports');
ok(hasFeature({ SITE_PLAN: 'pro' }, 'monthlyReports') && hasFeature({ SITE_PLAN: 'signature' }, 'monthlyReports'), 'pro + signature allowed');
ok(hasFeature({ SITE_PLAN: 'enterprise' }, 'monthlyReports') === false, 'unknown plan fails closed');
ok(featureOffResponse().status === 404, 'feature-off answers 404');

/* ---------------- 7. Pure summary ---------------- */

{
  const mapped = [
    { createdAt: '2026-09-12T17:05:00.000Z', status: 'completed', type: 'delivery', total: 100, items: [{ id: 'x', name: { en: 'X', ar: 'Y' }, qty: 1 }] },
    { createdAt: '2026-09-12T18:05:00.000Z', status: 'cancelled', type: 'delivery', total: 999, items: [] },
  ];
  const p = summarizeMonth(mapped, 'Asia/Beirut', { orders: 0, revenue: 0 });
  ok(p.totals.orders === 1 && p.totals.revenue === 100 && p.totals.cancelled === 1, 'summarize excludes cancelled from totals');
  const empty = summarizeMonth([], 'Asia/Beirut', { orders: 0, revenue: 0 });
  ok(empty.totals.orders === 0 && empty.busiestDay === null && empty.peakHour === null && empty.topItems.length === 0, 'empty month summary');
}

/* ---------------- 8. Email payload ---------------- */

{
  const payload = await buildEmailPayload(
    { MENU_KV: makeKV(MENU), SITE_URL: 'https://example.com/' },
    { month: '2026-09', totals: s.totals, prev: s.prev, busiestDay: s.busiestDay, peakHour: s.peakHour, topItems: s.topItems, types: s.types },
    true
  );
  ok(payload.logoUrl === 'https://example.com/assets/email-logo.png', 'logo URL from SITE_URL');
  ok(payload.retention.piiDays === 90 && payload.csvAttached === true, 'payload retention + csv flag');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
