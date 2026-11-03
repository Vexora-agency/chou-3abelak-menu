// Remember-my-details pin/address pair: the Telegram maps link must always
// match what the customer actually submitted this order.
//   - fresh-picked good coords -> exact pin link (same lat/lng as submitted)
//   - hand-edited address (pin cleared) -> address-query fallback, never stale pin
//   - coarse fix (>250m) -> dropped before store, fallback (never fake "exact")
//   - saved pin re-arms the picker (no silent auto-locate overwrite)
// Run: node scripts/test-remember-pin.mjs
import { createAsserts } from './_helpers/shared.mjs';
import { MENU, orderBody } from './_helpers/features-cases.mjs';
import { validateOrderInput } from '../functions/_shared/orders.js';
import {
  buildMapsLink,
  formatNewOrderMessage,
  orderRowToCleaned,
  rebuildOrderMessage,
  MAPS_ACCURACY_OK_M,
} from '../functions/_shared/telegram.js';
import {
  loadRememberedDetails,
  saveRememberedDetails,
  loadPinnedLocation,
  savePinnedLocation,
} from '../src/utils/customerOrders.ts';
import {
  shouldAutoLocateOnOpen,
  shouldOverwriteAddress,
} from '../src/features/cart/hooks/useMidSplitLocationMap.ts';

const { ok, summary } = createAsserts();

// In-memory localStorage stub (node has none).
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};
globalThis.window = { localStorage: globalThis.localStorage, dispatchEvent: () => true };

/* 1. Remembered pair round-trips as a pair (no silent drift). */
mem.clear();
ok(loadRememberedDetails() === null, 'no details initially');
ok(loadPinnedLocation() === null, 'no pin initially');
saveRememberedDetails({ name: 'Ali', phone: '70123456', address: 'Hamra, Main Rd', remember: true });
savePinnedLocation({ lat: 33.8938, lng: 35.5018, accuracy: 25 });
const d1 = loadRememberedDetails();
const p1 = loadPinnedLocation();
ok(d1 && d1.address === 'Hamra, Main Rd' && d1.remember === true, 'details roundtrip with address');
ok(p1 && p1.lat === 33.8938 && p1.lng === 35.5018, 'pin roundtrips with coords');
// Hand-edit clears the pin (CustomerFormFields onChange -> onClearLocation);
// the next submit must then carry NO pin (fallback), never the stale one.
savePinnedLocation(null);
ok(loadPinnedLocation() === null, 'hand-edit forgets the pin');
// Unchecked forgets both together.
saveRememberedDetails({ name: 'Ali', phone: '70123456', address: 'Hamra', remember: true });
savePinnedLocation({ lat: 33.9, lng: 35.5, accuracy: 25 });
saveRememberedDetails({ name: 'Ali', phone: '70123456', address: 'Hamra', remember: false });
savePinnedLocation(null);
ok(loadRememberedDetails() === null && loadPinnedLocation() === null, 'unchecked forgets pair');

/* 2. Server validation: good kept, coarse dropped (fallback), bad rejected. */
{
  const m = JSON.parse(JSON.stringify(MENU));
  ok(MAPS_ACCURACY_OK_M === 250, 'accuracy gate is 250m');
  const good = validateOrderInput(orderBody({ location: { lat: 33.8938, lng: 35.5018, accuracy: 30 } }), m);
  ok(good.ok && good.cleaned.location && good.cleaned.location.lat === 33.8938, 'good fix kept');
  const coarse = validateOrderInput(
    orderBody({ address: 'Hamra', location: { lat: 33.9, lng: 35.5, accuracy: 3000 } }),
    m
  );
  ok(coarse.ok && coarse.cleaned.location === null, 'coarse fix dropped to null (fallback, order still ok)');
  ok(coarse.cleaned.address === 'Hamra', 'coarse keeps address text for fallback');
  const noAcc = validateOrderInput(orderBody({ location: { lat: 33.9, lng: 35.5 } }), m);
  ok(noAcc.ok && noAcc.cleaned.location && noAcc.cleaned.location.lat === 33.9, 'missing accuracy kept (legacy clients assumed good)');
  ok(validateOrderInput(orderBody({ location: { lat: 500, lng: 0 } }), m).errors.includes('invalid_location'), 'out-of-range rejected');
}

/* 3. Telegram link matches submitted data (never stale pin + new address). */
{
  // Fresh good pin + its address -> exact pin with the SAME coords.
  const cleaned = {
    type: 'delivery', name: 'Ali', phone: '70123456', address: 'Hamra, Main Rd',
    table: null, notes: null, lang: 'en',
    location: { lat: 33.8938, lng: 35.5018, accuracy: 30 },
    items: [], subtotal: 0, deliveryFee: 0, total: 0,
  };
  const link = buildMapsLink(cleaned);
  ok(link && link.precise === true && link.url.includes('33.8938,35.5018') && link.url.includes('maps?q='), 'fresh pin -> exact pin link');
  const msg = formatNewOrderMessage(cleaned, 1001, '');
  ok(msg.includes('33.8938,35.5018') && msg.includes('الموقع الدقيق'), 'message shows exact pin for submitted coords');

  // Edited address with pin cleared -> address-query fallback naming the NEW text.
  const edited = { ...cleaned, address: 'Tripoli, Azmi St 12', location: null };
  const link2 = buildMapsLink(edited);
  ok(link2 && link2.precise === false && link2.url.includes('query=') && decodeURIComponent(link2.url).includes('Tripoli'), 'edited address without pin -> address-query fallback');
  const msg2 = formatNewOrderMessage(edited, 1002, '');
  ok(msg2.includes('بحث تقريبي') && !msg2.includes('الموقع الدقيق'), 'fallback message never claims exact');
  ok(!msg2.includes('33.8938'), 'fallback message carries no stale coords');

  // Release-sweep round-trip (DB drops accuracy, keeps lat/lng): good pin stays exact.
  const row = {
    type: 'delivery', customer_name: 'Ali', customer_phone: '70123456',
    customer_address: 'Hamra, Main Rd', customer_table: null, notes: null,
    location_lat: 33.8938, location_lng: 35.5018,
    items_json: '[]', subtotal: 0, delivery_fee: 0, total: 0, lang: 'en', number: 1003,
  };
  const rebuilt = await rebuildOrderMessage({ prepare: () => { throw new Error('no db'); } }, undefined, row);
  ok(!!rebuilt && rebuilt.includes('33.8938,35.5018') && rebuilt.includes('الموقع الدقيق'), 'rebuild keeps exact pin for stored good coords');
  const rowNoLoc = { ...row, location_lat: null, location_lng: null, customer_address: 'Tripoli, Azmi St 12', number: 1004 };
  const rebuilt2 = await rebuildOrderMessage({ prepare: () => { throw new Error('no db'); } }, undefined, rowNoLoc);
  ok(!!rebuilt2 && rebuilt2.includes('Tripoli') && !rebuilt2.includes('الموقع الدقيق'), 'rebuild falls back when no coords stored');
}

/* 4. Picker re-arm: saved pin centers the map (no silent overwrite); address merge. */
{
  ok(shouldAutoLocateOnOpen(null) === true, 'no pin -> auto-locate');
  ok(shouldAutoLocateOnOpen(undefined) === true, 'undefined -> auto-locate');
  ok(shouldAutoLocateOnOpen({ lat: 33.9, lng: 35.5 }) === false, 'saved pin -> center, never auto-overwrite');
  // Seeded remembered auto-fill overwrites on re-pin (stale street cannot stick).
  ok(shouldOverwriteAddress('', null) === true, 'empty overwrites');
  ok(shouldOverwriteAddress('33.90000, 35.50000', null) === true, 'coords fallback overwrites');
  ok(shouldOverwriteAddress('Hamra, Main Rd', 'Hamra, Main Rd') === true, 'seeded remembered auto-fill overwrites on re-pin');
  ok(shouldOverwriteAddress('My home floor 3', null) === false, 'genuinely typed text preserved');
  ok(shouldOverwriteAddress('Hamra, Main Rd', null) === false, 'unseeded remembered text would wrongly stick (the bug)');
}

delete globalThis.localStorage;
delete globalThis.window;

summary();
