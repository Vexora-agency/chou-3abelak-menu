// Account order queries must always be scoped by the session user id.
// Usage: node scripts/test-account-orders-scope.mjs

import {
  findOrderForCustomer,
  listOrdersForCustomer,
} from '../functions/_shared/repositories/orders.repo.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

function fakeDb(seed = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            all: async () => ({ results: seed }),
            first: async () => null,
          };
        },
      };
    },
  };
}

{
  const db = fakeDb();
  await listOrdersForCustomer(db, 'user-1', '2025-01-01T00:00:00.000Z', 50);
  const call = db.calls[0];
  check('list scopes by customer_user_id', call.sql.includes('customer_user_id = ?1'));
  check('list scopes by creation window', call.sql.includes('created_at >= ?2'));
  check('list binds user id first', call.values[0] === 'user-1');
  check('list caps at 50', call.values[2] === 50);
}

{
  const db = fakeDb();
  await findOrderForCustomer(db, 'user-2', 1001);
  const call = db.calls[0];
  check('detail scopes by customer_user_id', call.sql.includes('customer_user_id = ?1'));
  check('detail scopes by order number', call.sql.includes('number = ?2'));
  check('detail binds user id + number', call.values[0] === 'user-2' && call.values[1] === 1001);
}

{
  const row = {
    id: 'order-1',
    number: 1001,
    track_token: 'f'.repeat(32),
    status: 'new',
    type: 'delivery',
    created_at: '2025-01-01T00:00:00.000Z',
    items_json: '[]',
    subtotal: 0,
    delivery_fee: 0,
    total: 0,
  };
  const db = fakeDb([row]);
  const orders = await listOrdersForCustomer(db, 'user-3', '2025-01-01T00:00:00.000Z', 50);
  check('account list keeps the owner track token', orders[0]?.trackToken === row.track_token);
}

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
