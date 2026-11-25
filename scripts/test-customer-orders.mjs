// Customer order shelf: 12h window, validation, dedupe (pure logic).
// Run: node scripts/test-customer-orders.mjs
import { isStoredOrder, pruneOrders, CUSTOMER_ORDERS_TTL_MS, isSoundOff, setSoundOff, loadRememberedDetails, saveRememberedDetails, saveCustomerOrder, loadRung, markRung } from '../src/utils/customerOrders.ts';

// In-memory localStorage stub (node has none).
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};
// saveCustomerOrder talks to window.localStorage + window.dispatchEvent.
globalThis.window = { localStorage: globalThis.localStorage, dispatchEvent: () => true };

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

ok('sound defaults on', isSoundOff() === false);
setSoundOff(true);
ok('sound switch persists off', isSoundOff() === true);
setSoundOff(false);
ok('sound switch persists on', isSoundOff() === false);

ok('no saved details initially', loadRememberedDetails() === null);
saveRememberedDetails({ name: 'Ali', phone: '70123456', remember: false });
ok('unchecked erases details', loadRememberedDetails() === null);
saveRememberedDetails({ name: 'Ali', phone: '70123456', remember: true });
const loaded = loadRememberedDetails();
ok('checked persists details', loaded !== null && loaded.name === 'Ali');
// A real opt-in stores remember:true, so the next visit keeps it checked.
ok('explicit opt-in loads checked', loaded !== null && loaded.remember === true);
ok('opt-in record is the v2 key', mem.has('customer_details_v2') && !mem.has('customer_details_v1'));
saveRememberedDetails({ name: 'Ali', phone: '70123456', remember: false });
ok('unchecking erases on purpose', loadRememberedDetails() === null);

// Regression: a legacy record must NEVER check the box on its own. It may
// still prefill name/phone, but the customer must opt in again explicitly.
mem.set('customer_details_v1', JSON.stringify({ name: 'Old Ali', phone: '70111222', remember: true }));
const legacy = loadRememberedDetails();
ok('legacy record still prefills', legacy !== null && legacy.name === 'Old Ali');
ok('legacy record never checks the box', legacy !== null && legacy.remember === false);
ok('legacy record is cleared after one read', !mem.has('customer_details_v1'));
saveRememberedDetails({ ...legacy, remember: false });
ok('unchecked submit leaves nothing', loadRememberedDetails() === null);

// A current record without the literal flag is also not consent.
mem.set('customer_details_v2', JSON.stringify({ name: 'No Flag', phone: '70123456' }));
const noFlag = loadRememberedDetails();
ok('missing remember flag stays unchecked', noFlag !== null && noFlag.remember === false);
mem.delete('customer_details_v2');
ok('rung starts empty', loadRung().length === 0);
markRung([1001, 1002, -5, 1001]);
const rung = loadRung();
ok('rung roundtrips deduped + valid only', rung.length === 2 && rung.includes(1001) && rung.includes(1002));

// A muted bell re-arms on every brand-new order: each order rings fresh.
setSoundOff(true);
saveCustomerOrder(2001, T, NOW);
ok('new order unmutes the bell', isSoundOff() === false);
setSoundOff(true);
saveCustomerOrder(2001, T, NOW + 1000); // same order re-saved (retry)
ok('re-save of the same order keeps the mute', isSoundOff() === true);
setSoundOff(false);
saveCustomerOrder(2002, T, NOW + 2000);
ok('next new order rings again', isSoundOff() === false);

// Pins are session-only and never remembered: a remembered record carries
// no location, so no stale pin from another visit/city can hide inside it.
// (Name, phone and the pin-derived address ARE stored — see withoutNotes +
// the hook; per-order special instructions are stripped instead. This
// raw-util check only covers the pin-shaped keys.)
saveRememberedDetails({ name: 'Ali', phone: '70123456', address: 'Hamra', remember: true });
const det = loadRememberedDetails();
ok('remembered details carry no pin', det !== null && !('location' in det) && !('lat' in det) && !('lng' in det));

delete globalThis.localStorage;
delete globalThis.window;

console.log(`customer-orders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
