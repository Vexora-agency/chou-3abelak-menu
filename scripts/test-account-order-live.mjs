// Account-order live state: the same unlock/group facts the guest bell gets
// from /api/track/batch, computed for the signed-in owner's orders.
// Run: node scripts/test-account-order-live.mjs

import { attachOrderLiveState } from '../functions/_shared/order-live-state.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

const MIN = 60 * 1000;
const T0 = Date.parse('2026-11-14T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

const parentRows = [
  {
    number: 101,
    status: 'confirmed',
    type: 'delivery',
    created_at: iso(T0 - 30 * MIN),
    confirmed_at: iso(T0 - 20 * MIN),
    eta_at: iso(T0 + 20 * MIN),
    parent_number: null,
  },
];
const childRows = [
  { number: 102, parent_number: 101 },
  { number: 103, parent_number: 101 },
];

function mockDb(rows = [], children = [], touched = { parent: 0, child: 0 }) {
  return {
    touched,
    prepare(sql) {
      if (sql.includes('FROM orders WHERE number IN (')) {
        return {
          bind(...nums) {
            touched.parent += 1;
            return {
              async all() { return { results: rows.filter((r) => nums.includes(r.number)) }; },
              async first() { return null; },
            };
          },
        };
      }
      if (sql.includes('WHERE parent_number IN (')) {
        return {
          bind(...nums) {
            touched.child += 1;
            return {
              async all() { return { results: children.filter((r) => nums.includes(r.parent_number)) }; },
              async first() { return null; },
            };
          },
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

function mockKv(reads = { count: 0 }) {
  return {
    reads,
    async get() { reads.count += 1; return null; },
    async put() {},
  };
}

const baseOrder = (patch) => ({
  number: 0,
  status: 'new',
  type: 'delivery',
  createdAt: iso(T0 - 5 * MIN),
  confirmedAt: null,
  etaAt: null,
  parentNumber: null,
  trackToken: 'a'.repeat(32),
  ...patch,
});

// 1. History-only page: no DB or KV work, stable shape.
{
  const touched = { parent: 0, child: 0 };
  const db = mockDb([], [], touched);
  const kv = mockKv();
  const out = await attachOrderLiveState(db, { MENU_KV: kv }, [
    baseOrder({ number: 90, status: 'completed', parentNumber: null }),
  ]);
  check('history-only keeps shape', out[0].receivableAt === null && Array.isArray(out[0].groupNumbers) && out[0].groupNumbers.length === 0);
  check('history-only skips D1', touched.parent === 0 && touched.child === 0);
  check('history-only skips KV', kv.reads.count === 0);
}

// 2. Active order with no parent: unlock = eta + 5 min buffer.
{
  const touched = { parent: 0, child: 0 };
  const db = mockDb([], [], touched);
  const kv = mockKv();
  const eta = iso(T0 + 15 * MIN);
  const out = await attachOrderLiveState(db, { MENU_KV: kv }, [
    baseOrder({ number: 101, status: 'confirmed', etaAt: eta, confirmedAt: iso(T0 - 2 * MIN) }),
  ]);
  check('confirmed order gets unlock instant', out[0].receivableAt === iso(Date.parse(eta) + 5 * MIN));
  check('solo order has no group', out[0].groupNumbers.length === 0);
}

// 3. Joint delivery: child unlocks with the earlier parent instant and the
//    group lists parent + siblings, never itself.
{
  const touched = { parent: 0, child: 0 };
  const db = mockDb(parentRows, childRows, touched);
  const kv = mockKv();
  const out = await attachOrderLiveState(db, { MENU_KV: kv }, [
    baseOrder({
      number: 102,
      status: 'confirmed',
      parentNumber: 101,
      etaAt: iso(T0 + 40 * MIN),
      confirmedAt: iso(T0 - 2 * MIN),
    }),
  ]);
  // Parent eta + buffer (T0+25m) is earlier than own eta + buffer (T0+45m).
  check('child unlocks with the earlier parent instant', out[0].receivableAt === iso(T0 + 25 * MIN));
  check('group includes parent and sibling only', JSON.stringify(out[0].groupNumbers) === JSON.stringify([101, 103]));
  check('parent and children queries ran once', touched.parent === 1 && touched.child === 1);
}

// 4. New order: no unlock instant, but still carries the group link.
{
  const db = mockDb(parentRows, childRows);
  const out = await attachOrderLiveState(db, { MENU_KV: mockKv() }, [
    baseOrder({ number: 102, status: 'new', parentNumber: 101 }),
  ]);
  check('new order never gets a receivable instant', out[0].receivableAt === null);
  check('new order still shows the joint hint', JSON.stringify(out[0].groupNumbers) === JSON.stringify([101, 103]));
}

// 5. KV outage degrades to defaults without failing the account response.
{
  const db = mockDb([], []);
  const kvDown = { async get() { throw new Error('down'); }, async put() {} };
  const out = await attachOrderLiveState(db, { MENU_KV: kvDown }, [
    baseOrder({ number: 201, status: 'confirmed', confirmedAt: iso(T0 - 60 * MIN) }),
  ]);
  check('KV outage still returns an unlock instant', typeof out[0].receivableAt === 'string');
}

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
