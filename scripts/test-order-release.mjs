// Order release (kitchen grace period) tests: a fresh `new` order stays
// hidden from admin surfaces for 5 minutes; the order-nag sweep releases
// it after the window lapses (exactly once via atomic claim). A customer
// cancel inside the window is visible immediately (never grace-hidden).
// Run: node scripts/test-order-release.mjs
import {
  ORDER_GRACE_MS,
  CUSTOMER_CANCEL_WINDOW_MS,
  hasUnackedOrders,
  isOrderInGrace,
  findDueForRelease,
  claimOrderRelease,
} from '../functions/_shared/repositories/orders.repo.js';
import { orderRowToCleaned } from '../functions/_shared/telegram.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const MIN = 60 * 1000;

// In-memory D1 stand-in: only the two release statements are supported.
function mockOrdersDb(rows) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes('released_at IS NULL AND created_at <=')) {
                const [cutoff, recent, lim] = args;
                const out = rows
                  .filter(
                    (r) =>
                      r.status === 'new' &&
                      (r.released_at === null || r.released_at === undefined) &&
                      r.created_at <= cutoff &&
                      r.created_at >= recent
                  )
                  .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
                  .slice(0, lim);
                return { results: out };
              }
              return { results: [] };
            },
            async run() {
              if (sql.includes('SET released_at')) {
                const [id, stamp] = args;
                const r = rows.find((x) => x.id === id && (x.released_at === null || x.released_at === undefined));
                if (!r) return { meta: { changes: 0 } };
                r.released_at = stamp;
                r.updated_at = stamp;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
            async first() {
              if (sql.includes('SELECT 1 AS x FROM orders')) {
                const [cutoff, recent] = args;
                const found = rows.some(
                  (r) => r.status === 'new' && r.created_at <= cutoff && r.created_at >= recent
                );
                return found ? { x: 1 } : null;
              }
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
const row = (id, status, ageMin, released) => ({
  id,
  number: 1000 + Number(id.slice(-1)),
  status,
  created_at: iso(T0 - ageMin * MIN),
  updated_at: iso(T0 - ageMin * MIN),
  released_at: released ? iso(T0 - ageMin * MIN) : null,
  customer_name: 'Ali',
  customer_phone: '70123456',
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

// 1. Window constants: single 5-minute grace = cancel window.
ok(ORDER_GRACE_MS === 5 * MIN, 'grace is 5 minutes');
ok(CUSTOMER_CANCEL_WINDOW_MS === ORDER_GRACE_MS, 'cancel window equals grace');

// 2. Grace check.
ok(isOrderInGrace('new', iso(T0 - MIN), T0) === true, 'fresh new is grace-hidden');
ok(isOrderInGrace('new', iso(T0 - 6 * MIN), T0) === false, '6-min new is visible');
ok(isOrderInGrace('new', iso(T0 - 5 * MIN), T0) === false, 'window lapses exactly at 5 min');
ok(isOrderInGrace('cancelled', iso(T0 - MIN), T0) === false, 'fresh cancelled is visible at once');
ok(isOrderInGrace('confirmed', iso(T0 - MIN), T0) === false, 'confirmed never grace-hidden');
ok(isOrderInGrace('ready', iso(T0 - MIN), T0) === false, 'legacy ready never grace-hidden');
ok(isOrderInGrace('completed', iso(T0 - MIN), T0) === false, 'completed never grace-hidden');
ok(isOrderInGrace('new', 'not-a-date', T0) === false, 'bad date is visible (fail open)');
ok(isOrderInGrace('new', null, T0) === false, 'missing date is visible (fail open)');

// 3. Release candidates: only past-window, unreleased, recent `new`.
const db = mockOrdersDb([
  row('a', 'new', 6, false), // due
  row('b', 'new', 2, false), // grace — not yet
  row('c', 'new', 40, false), // too old — never resurrected
  row('d', 'cancelled', 10, false), // cancelled — never released
  row('e', 'new', 10, true), // already released
]);
const due = await findDueForRelease(db, iso(T0 - ORDER_GRACE_MS), iso(T0 - 30 * MIN), 20);
ok(due.length === 1 && due[0].id === 'a', 'only the due order is selected');

// 4. Atomic claim: first wins, repeats + strangers fail.
ok((await claimOrderRelease(db, 'a', iso(T0))) === true, 'first claim wins');
ok((await claimOrderRelease(db, 'a', iso(T0))) === false, 'second claim fails');
ok((await claimOrderRelease(db, 'nope', iso(T0))) === false, 'unknown id fails');
const dueAfter = await findDueForRelease(db, iso(T0 - ORDER_GRACE_MS), iso(T0 - 30 * MIN), 20);
ok(dueAfter.length === 0, 'claimed order leaves the due set');

// 5. Row -> cleaned mapping (release sweep reuses the Telegram shape).
const mapped = orderRowToCleaned({
  type: 'delivery',
  customer_name: 'Layla',
  customer_phone: '70111',
  customer_address: null,
  customer_table: null,
  notes: 'x',
  items_json: JSON.stringify([{ id: 'i1', qty: 2, unitPrice: 50 }]),
  subtotal: 100,
  delivery_fee: 30,
  total: 130,
  lang: 'ar',
  location_lat: 33.9,
  location_lng: 35.5,
});
ok(mapped.deliveryFee === 30 && !('delivery_fee' in mapped), 'delivery fee is camelCase');
ok(mapped.location && mapped.location.lat === 33.9, 'location mapped');
ok(Array.isArray(mapped.items) && mapped.items.length === 1, 'items parsed');
const noLoc = orderRowToCleaned({ items_json: '[]', location_lat: null, location_lng: null });
ok(noLoc.location === null, 'missing location stays null');

// 6. Admin-list filter shape: grace `new` hidden, everything else kept.
const feed = [
  { status: 'new', createdAt: iso(T0 - MIN) },
  { status: 'new', createdAt: iso(T0 - 10 * MIN) },
  { status: 'cancelled', createdAt: iso(T0 - MIN) },
  { status: 'confirmed', createdAt: iso(T0 - MIN) },
].filter((o) => !isOrderInGrace(o.status, o.createdAt, T0));
ok(
  feed.length === 3 && feed.every((o) => o.status !== 'new' || o.createdAt !== iso(T0 - MIN)),
  'admin feed hides only the grace order'
);

// 7. Nag existence probe: true only when an unacked order sits in window.
const probeDb = mockOrdersDb([row('p', 'new', 10, true)]);
ok((await hasUnackedOrders(probeDb, iso(T0 - ORDER_GRACE_MS), iso(T0 - 30 * MIN))) === true, 'probe finds windowed unacked order');
const emptyDb = mockOrdersDb([
  row('q', 'new', 2, false), // grace — not yet
  row('r', 'confirmed', 10, true), // not new
]);
ok((await hasUnackedOrders(emptyDb, iso(T0 - ORDER_GRACE_MS), iso(T0 - 30 * MIN))) === false, 'probe is false on idle minutes');
const failingDb = { prepare() { throw new Error('down'); } };
ok((await hasUnackedOrders(failingDb, iso(T0 - ORDER_GRACE_MS), iso(T0 - 30 * MIN))) === true, 'probe fails open (nag runs) when D1 errors');

summary();
