// Unit tests for monthly reporting: retention guard, tokens, email
// validation and plan gating. Pure split of test-reports.mjs.
// Run: node scripts/test-reports-retention.mjs
import {
  getRetentionConfig,
  isValidReportEmail,
  newVerifyToken,
  runRetention,
  sha256Hex,
  verifyExpiryISO,
} from '../functions/_shared/reports.js';
import { featureOffResponse, hasFeature } from '../functions/_shared/plan.js';
import { createAsserts } from './_helpers/shared.mjs';
import { makeDB, makeR2 } from './_helpers/reports-cases.mjs';

const { ok, summary } = createAsserts();

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
  ok(hasFeature({ SITE_PLAN: 'pro' }, 'monthlyReports'), 'pro allowed');
ok(hasFeature({ SITE_PLAN: 'enterprise' }, 'monthlyReports') === false, 'unknown plan fails closed');
ok(featureOffResponse().status === 404, 'feature-off answers 404');

summary();
