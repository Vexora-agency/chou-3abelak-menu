// Customer order shelf: 12h window, validation, dedupe (pure logic).
// Run: node scripts/test-customer-orders.mjs
import { isStoredOrder, pruneOrders, CUSTOMER_ORDERS_TTL_MS, isSoundOff, setSoundOff, loadRememberedDetails, saveRememberedDetails, saveCustomerOrder, loadPinnedLocation, savePinnedLocation, loadRung, markRung } from '../src/utils/customerOrders.ts';

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
// THE BUG: second visit must load CHECKED, or the next submit wipes storage.
ok('second visit loads checked', loaded !== null && loaded.remember === true);
saveRememberedDetails({ name: 'Ali', phone: '70123456', remember: false });
ok('unchecking erases on purpose', loadRememberedDetails() === null);
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

// Remembered pin: a repeat order re-sends the validated pin, never none.
ok('no pin initially', loadPinnedLocation() === null);
savePinnedLocation({ lat: 33.9, lng: 35.5, accuracy: 25 });
const pin = loadPinnedLocation();
ok('pin roundtrips', pin !== null && pin.lat === 33.9 && pin.lng === 35.5 && pin.accuracy === 25);
savePinnedLocation({ lat: 999, lng: 0, accuracy: 1 });
ok('out-of-range pin rejected', loadPinnedLocation() === null);
savePinnedLocation({ lat: 33.9, lng: 35.5, accuracy: 25 });
savePinnedLocation(null);
ok('null forgets the pin', loadPinnedLocation() === null);

delete globalThis.localStorage;
delete globalThis.window;

console.log(`customer-orders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
