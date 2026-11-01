// Feature tests: customer-data tool (masking, anonymize/delete/export,
// password, audit, rate limit), privacy-info, ordering-state report CSV
// exclusion. Pure split of test-features.mjs.
// Run: node scripts/test-features-customer.mjs
import { maskName, maskPhone, digitsOnly } from '../functions/_shared/customer-data.js';
import { onRequest as privacyReq } from '../functions/api/privacy-info.js';
import { onRequest as cdStatusReq } from '../functions/api/admin/customer-data/status.js';
import { onRequest as cdSearchReq } from '../functions/api/admin/customer-data/search.js';
import { onRequest as cdActionReq } from '../functions/api/admin/customer-data/action.js';
import { generateMonthlyReport } from '../functions/_shared/reports.js';
import { createAsserts, makeKV, makeReq, readJson } from './_helpers/shared.mjs';
import { makeDB, MENU, mkOrderRow } from './_helpers/features-cases.mjs';

const { ok, summary } = createAsserts();
const req = makeReq;
const json = readJson;

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
  const env = { MENU_KV: makeKV(), ORDERS_DB: db, SITE_PLAN: 'pro', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: 'x', AUDIT_SECRET: 'audit-secret-12345678901234567890' };
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
  // anonymize (per-action words since ff29759: ANONYMIZE, not DELETE)
  const a = await action({ phone: '70123456', mode: 'anonymize', password: 'test-pass-9', confirm: 'ANONYMIZE' });
  ok(a.status === 200 && a.data.ok && a.data.count === 2, 'anonymize works');
  const o1 = db.orders.find((o) => o.id === 'o1');
  ok(o1.customer_name === null && o1.phone_norm === null && o1.location_lat === null && o1.pii_purged_at !== null, 'anonymize NULLs PII + location + marks');
  ok(db.orders.find((o) => o.id === 'o3').customer_name === 'John Doe', 'other numbers untouched');
  // export CSV (on remaining number)
  const e = await action({ phone: '70999999', mode: 'export', password: 'test-pass-9', confirm: 'تصدير' });
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
  const r = await privacyReq({ request: req('GET', 'https://x/api/privacy-info'), env: { SITE_PLAN: 'pro' } });
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

summary();
