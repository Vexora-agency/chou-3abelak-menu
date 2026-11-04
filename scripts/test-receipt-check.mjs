// Receipt-check sweep tests: past-ETA confirmed/ready orders created within
// 24h that were never asked get exactly one `receipt_check` email claim.
// Future-ETA, terminal, already-asked, and stale (>24h) orders are skipped.
// Run: node scripts/test-receipt-check.mjs
import {
  RECEIPT_CHECK_BATCH,
  RECEIPT_CHECK_MAX_AGE_MS,
  findDueForReceiptCheck,
  claimReceiptCheck,
} from '../functions/_shared/repositories/orders.repo.js';
import { mapOrderRow } from '../functions/_shared/orders.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// In-memory D1 stand-in: only the two receipt-check statements are supported.
function mockOrdersDb(rows) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes('receipt_asked_at IS NULL')) {
                const [etaCutoff, recentCutoff, lim] = args;
                const n = Number.isInteger(lim) ? Math.min(50, Math.max(1, lim)) : 20;
                const out = rows
                  .filter(
                    (r) =>
                      (r.status === 'confirmed' || r.status === 'ready') &&
                      r.eta_at !== null &&
                      r.eta_at !== undefined &&
                      r.eta_at <= etaCutoff &&
                      (r.receipt_asked_at === null || r.receipt_asked_at === undefined) &&
                      r.created_at >= recentCutoff
                  )
                  .sort((a, b) => (a.eta_at < b.eta_at ? -1 : 1))
                  .slice(0, n);
                return { results: out };
              }
              return { results: [] };
            },
            async run() {
              if (sql.includes('SET receipt_asked_at')) {
                const [id, stamp] = args;
                const r = rows.find(
                  (x) => x.id === id && (x.receipt_asked_at === null || x.receipt_asked_at === undefined)
                );
                if (!r) return { meta: { changes: 0 } };
                r.receipt_asked_at = stamp;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
            async first() {
              return null;
            },
          };
        },
      };
    },
  };
}

const T0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
let seq = 3000;
const row = (id, status, etaAgeMin, createdAgeMin, asked) => ({
  id,
  number: (seq += 1),
  status,
  eta_at: etaAgeMin === null ? null : iso(T0 - etaAgeMin * MIN),
  created_at: iso(T0 - createdAgeMin * MIN),
  updated_at: iso(T0 - createdAgeMin * MIN),
  receipt_asked_at: asked ? iso(T0 - MIN) : null,
  customer_name: 'Sara',
  customer_phone: '70123456',
  customer_email: 'sara@example.com',
  customer_address: null,
  customer_table: null,
  notes: null,
  location_lat: null,
  location_lng: null,
  items_json: '[]',
  subtotal: 100,
  delivery_fee: 0,
  total: 100,
  lang: 'ar',
});

// 1. Sweep bounds.
ok(RECEIPT_CHECK_BATCH === 20, 'receipt-check batch is 20');
ok(RECEIPT_CHECK_MAX_AGE_MS === 24 * HOUR, 'receipt-check window is 24h');

// 2. Selection: only past-ETA confirmed/ready, unasked, fresh.
const db = mockOrdersDb([
  row('a', 'confirmed', 5, 60, false), // due (ETA passed 5 min ago, created 1h ago)
  row('b', 'ready', 10, 120, false), // due (earlier ETA → sorts first)
  row('c', 'confirmed', -10, 60, false), // future ETA — skipped
  row('d', 'completed', 30, 60, false), // terminal — skipped
  row('e', 'cancelled', 30, 60, false), // terminal — skipped
  row('f', 'new', 30, 60, false), // wrong status — skipped
  row('g', 'confirmed', 5, 60, true), // already asked — skipped
  row('h', 'confirmed', 5, 25 * 60, false), // created >24h ago — skipped
  row('i', 'ready', null, 60, false), // null ETA — skipped
]);
const due = await findDueForReceiptCheck(db, iso(T0), iso(T0 - RECEIPT_CHECK_MAX_AGE_MS), 20);
ok(
  due.length === 2 && due[0].id === 'b' && due[1].id === 'a',
  'only past-ETA unasked fresh confirmed/ready selected, earliest ETA first'
);

// 3. Limit clamp mirrors findDueForRelease (1..50, default 20).
{
  const many = [];
  for (let k = 0; k < 60; k += 1) {
    many.push(row(`m${k}`, 'confirmed', 5, 60, false));
  }
  const d = mockOrdersDb(many);
  const capped = await findDueForReceiptCheck(d, iso(T0), iso(T0 - RECEIPT_CHECK_MAX_AGE_MS), 500);
  ok(capped.length === 50, 'limit clamps to 50');
  const floored = await findDueForReceiptCheck(d, iso(T0), iso(T0 - RECEIPT_CHECK_MAX_AGE_MS), 0);
  ok(floored.length === 1, 'limit clamps to 1');
  const def = await findDueForReceiptCheck(d, iso(T0), iso(T0 - RECEIPT_CHECK_MAX_AGE_MS), 'x');
  ok(def.length === 20, 'non-integer limit defaults to 20');
}

// 4. Atomic claim: first wins, repeats + strangers fail.
ok((await claimReceiptCheck(db, 'a', iso(T0))) === true, 'first claim wins');
ok((await claimReceiptCheck(db, 'a', iso(T0))) === false, 'second claim fails');
ok((await claimReceiptCheck(db, 'nope', iso(T0))) === false, 'unknown id fails');
const dueAfter = await findDueForReceiptCheck(db, iso(T0), iso(T0 - RECEIPT_CHECK_MAX_AGE_MS), 20);
ok(dueAfter.length === 1 && dueAfter[0].id === 'b', 'claimed order leaves the due set');

// 5. Column-absent tolerance: legacy rows without the key map with no receiptAskedAt.
{
  const legacy = row('l', 'confirmed', 5, 60, false);
  delete legacy.receipt_asked_at;
  const mapped = mapOrderRow(legacy);
  ok(!('receiptAskedAt' in mapped), 'absent column maps with no receiptAskedAt key');
  const asked = mapOrderRow({ ...legacy, receipt_asked_at: iso(T0 - MIN) });
  ok(asked.receiptAskedAt === iso(T0 - MIN), 'set stamp maps to receiptAskedAt');
  const nulled = mapOrderRow({ ...legacy, receipt_asked_at: null });
  ok(!('receiptAskedAt' in nulled), 'null stamp maps with no receiptAskedAt key');
}

summary();
