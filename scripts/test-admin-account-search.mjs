// Registered-account admin search: name/email/phone, with phone normalization
// and an order-phone fallback. Run: node scripts/test-admin-account-search.mjs

import { listRegisteredCustomers } from '../functions/_shared/repositories/customers.repo.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

function fakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            all: async () => ({ results: [] }),
            first: async () => null,
          };
        },
      };
    },
  };
}

{
  const db = fakeDb();
  await listRegisteredCustomers(db, '70 123', 200);
  const { sql, values } = db.calls[0];
  check('search keeps name/email matching', sql.includes('u.name LIKE ?2') && sql.includes('u.email LIKE ?2'));
  check('search keeps raw phone matching', sql.includes("COALESCE(p.phone, '') LIKE ?2"));
  check('phone digits normalized for search', values[2] === '%70123%');
  check('profile phone separators normalized', sql.includes("REPLACE(REPLACE(REPLACE(COALESCE(p.phone, ''), ' ', ''), '-', ''), '+', '')"));
  check('profile pin columns selected', sql.includes('p.location_lat') && sql.includes('p.location_lng'));
  check('order phone fallback present', sql.includes('o2.phone_norm LIKE ?3'));
  check('limit is capped at 200', values[3] === 200);
}

{
  const db = fakeDb();
  await listRegisteredCustomers(db, '٧٠١٢٣', 200);
  check('Arabic-Indic digits normalize', db.calls[0].values[2] === '%70123%');
}

{
  const db = fakeDb();
  await listRegisteredCustomers(db, '+961 70 123 456', 200);
  check('formatted international phone normalizes', db.calls[0].values[2] === '%96170123456%');
}

{
  const db = fakeDb();
  await listRegisteredCustomers(db, 'real.up60@gmail.com', 200);
  check('email query never triggers phone fallback', db.calls[0].values[2] === '');
}

{
  const db = fakeDb();
  await listRegisteredCustomers(db, 'Mina', 500);
  check('name query never triggers phone fallback', db.calls[0].values[2] === '');
  check('oversized limit clamps to 200', db.calls[0].values[3] === 200);
}

{
  const db = fakeDb();
  await listRegisteredCustomers(db, '12', 50);
  check('short digit run is not treated as a phone', db.calls[0].values[2] === '');
}

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
