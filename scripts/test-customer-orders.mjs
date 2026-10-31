// Customer order shelf: 12h window, validation, dedupe (pure logic).
// Run: node scripts/test-customer-orders.mjs
import { isStoredOrder, pruneOrders, CUSTOMER_ORDERS_TTL_MS, toggleOrderMuted, isOrderMuted, loadRememberedDetails, saveRememberedDetails, loadRung, markRung } from '../src/utils/customerOrders.ts';

// In-memory localStorage stub (node has none).
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
};

const T = 'a'.repeat(32);
const NOW = Date.parse('2026-02-01T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

ok('valid entry', isStoredOrder({ n: 1001, t: T, at: iso(NOW) }));
ok('reject bad number', !isStoredOrder({ n: -5, t: T, at: iso(NOW) }));
ok('reject bad token', !isStoredOrder({ n: 1, t: 'xyz', at: iso(NOW) }));
ok('reject bad date', !isStoredOrder({ n: 1, t: T, at: 'nope' }));
ok('reject null', !isStoredOrder(null));

const list = [
  { n: 1, t: T, at: iso(NOW - 1000) },
  { n: 2, t: T, at: iso(NOW - CUSTOMER_ORDERS_TTL_MS - 1000) }, // expired
  { n: 1, t: T, at: iso(NOW) }, // dup number
  { n: 3, t: 'bad', at: iso(NOW) }, // malformed
  { n: 4, t: T, at: iso(NOW - 3600000) },
];
const pruned = pruneOrders(list, NOW);
ok('keeps valid, drops expired/malformed/dupes', pruned.length === 2 && pruned[0].n === 1 && pruned[1].n === 4);
ok('12h ttl constant', CUSTOMER_ORDERS_TTL_MS === 12 * 3600 * 1000);
ok('non-array safe', pruneOrders(null).length === 0 && pruneOrders('x').length === 0);

ok('mute toggle guards bad input', toggleOrderMuted(-3) === false && toggleOrderMuted(0) === false);
ok('mute toggle never crashes without storage', toggleOrderMuted(1001) === true);
ok('isOrderMuted explicit list', isOrderMuted(7, [7, 9]) === true && isOrderMuted(8, [7, 9]) === false);

ok('no saved details initially', loadRememberedDetails() === null);
saveRememberedDetails({ name: 'Ali', phone: '70123456', remember: false });
ok('unchecked erases details', loadRememberedDetails() === null);
saveRememberedDetails({ name: 'Ali', phone: '70123456', remember: true });
const loaded = loadRememberedDetails();
ok('checked persists details', loaded !== null && loaded.name === 'Ali');
// THE BUG: second visit must load CHECKED, or the next submit wipes storage.
ok('second visit loads checked', loaded !== null && loaded.remember === true);
saveRememberedDetails({ name: 'Ali', phone: '70123456', remember: false });
ok('unchecking erases on purpose', loadRememberedDetails() === null);
ok('rung starts empty', loadRung().length === 0);
markRung([1001, 1002, -5, 1001]);
const rung = loadRung();
ok('rung roundtrips deduped + valid only', rung.length === 2 && rung.includes(1001) && rung.includes(1002));
delete globalThis.localStorage;

console.log(`customer-orders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
