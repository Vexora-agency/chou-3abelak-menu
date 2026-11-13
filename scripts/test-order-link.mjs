// Order-to-account link: written only from the server-side cleaned value,
// omitted for guests, and dropped safely on an unmigrated DB.
// Usage: node scripts/test-order-link.mjs

import { insertOrderWithNumber } from '../functions/_shared/repositories/orders.repo.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

function fakeDb({ failFirst = false } = {}) {
  let attempts = 0;
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          return { sql, values };
        },
      };
    },
    async batch(statements) {
      attempts += 1;
      calls.push(statements[0]);
      if (failFirst && attempts === 1) throw new Error('no such column: customer_user_id');
      return [];
    },
  };
}

const base = {
  type: 'delivery',
  name: 'Mina',
  phone: '70123456',
  phoneNorm: '70123456',
  email: null,
  address: 'Beirut',
  table: null,
  notes: null,
  location: null,
  items: [{ id: 'x', name: { en: 'X', ar: 'X' }, qty: 1, unitPrice: 10, unit: 'pc' }],
  subtotal: 10,
  deliveryFee: 0,
  total: 10,
  lang: 'en',
  idemKey: 'test-key',
  trackToken: 'a'.repeat(32),
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  riskScore: 0,
  riskReasons: [],
};

{
  const db = fakeDb();
  await insertOrderWithNumber(db, { ...base, customerUserId: 'user-1' }, 1001, new Date().toISOString());
  const call = db.calls[0];
  check('registered order includes customer_user_id', call.sql.includes('customer_user_id'));
  check('registered order binds the user id', call.values.includes('user-1'));
}

{
  const db = fakeDb();
  await insertOrderWithNumber(db, base, 1002, new Date().toISOString());
  const call = db.calls[0];
  check('guest order omits customer_user_id', !call.sql.includes('customer_user_id'));
}

{
  const db = fakeDb({ failFirst: true });
  await insertOrderWithNumber(db, { ...base, customerUserId: 'user-2' }, 1003, new Date().toISOString());
  check('unmigrated DB drops the link and retries', db.calls.length === 2);
  check('retry omits customer_user_id', !db.calls[1].sql.includes('customer_user_id'));
  check('retry keeps the order payload', db.calls[1].sql.includes('items_json'));
}

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
