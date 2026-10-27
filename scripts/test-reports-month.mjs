// Unit tests for monthly reporting: DST month bounds, aggregation, CSV
// (BOM, escaping, Arabic, no PII), idempotency, pure summary, email
// payload. Pure split of test-reports.mjs.
// Run: node scripts/test-reports-month.mjs
import {
  buildCSV,
  buildEmailPayload,
  currentMonthInTZ,
  dayOfMonthInTZ,
  generateMonthlyReport,
  isValidMonth,
  monthBoundsUTC,
  prevMonth,
  summarizeMonth,
} from '../functions/_shared/reports.js';
import { createAsserts } from './_helpers/shared.mjs';
import { makeDB, makeKV, makeR2, MENU, SEP_ORDERS } from './_helpers/reports-cases.mjs';

const { ok, summary } = createAsserts();

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
const lines = csv.replace(/^\uFEFF/, '').trim().split('\n');
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

summary();
