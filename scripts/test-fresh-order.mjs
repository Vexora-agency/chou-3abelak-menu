import { FRESH_ORDER_MS, isFreshOrder } from '../src/features/orders/hooks/useNewOrderSound.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ok ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

const NOW = Date.parse('2026-11-04T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

ok('window is 40min', FRESH_ORDER_MS === 40 * 60 * 1000);
ok('fresh: just placed', isFreshOrder(iso(NOW - 60 * 1000), NOW) === true);
ok('fresh: 5min old (grace)', isFreshOrder(iso(NOW - 5 * 60 * 1000), NOW) === true);
ok('fresh: 20min old (nag window)', isFreshOrder(iso(NOW - 20 * 60 * 1000), NOW) === true);
ok('stale: 3 days old stuck new', isFreshOrder(iso(NOW - 3 * 24 * 3600 * 1000), NOW) === false);
ok('stale: 29 days old', isFreshOrder(iso(NOW - 29 * 24 * 3600 * 1000), NOW) === false);
ok('boundary: exactly at window fails closed', isFreshOrder(iso(NOW - FRESH_ORDER_MS), NOW) === false);
ok('garbage fails closed', isFreshOrder('not-a-date', NOW) === false);
ok('empty fails closed', isFreshOrder('', NOW) === false);
ok('null fails closed', isFreshOrder(null, NOW) === false);
ok('undefined fails closed', isFreshOrder(undefined, NOW) === false);
ok('future fails closed', isFreshOrder(iso(NOW + 60 * 1000), NOW) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
