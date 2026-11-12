// Pin/address pair, session-only pins: the Telegram maps link must always
// match what the customer actually submitted this order. Pins are NEVER
// remembered, so no stale pin from another visit/city can ride along.
//   - delivery without a pin -> allowed (address-only order, fallback link)
//   - fresh-picked good coords -> exact pin link (same lat/lng as submitted)
//   - hand-edited address keeps the pin -> best pair (precise + detailed)
//   - coarse fix (>250m) -> dropped before store, fallback (never fake "exact")
//   - no saved pin -> picker auto-locates every time (fresh fix, never silent)
// Run: node scripts/test-remember-pin.mjs
import { createAsserts } from './_helpers/shared.mjs';
import { MENU, orderBody } from './_helpers/features-cases.mjs';
import { validateOrderInput } from '../functions/_shared/orders.js';
import {
  buildMapsLink,
  formatNewOrderMessage,
  orderRowToCleaned,
  rebuildOrderMessage,
  storeCountry,
  MAPS_ACCURACY_OK_M,
} from '../functions/_shared/telegram.js';
import {
  loadRememberedDetails,
  saveRememberedDetails,
  withoutAddress,
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

/* 1. Remember-me persists details, NEVER the pin (no pin storage exists). */
mem.clear();
ok(loadRememberedDetails() === null, 'no details initially');
saveRememberedDetails({ name: 'Ali', phone: '70123456', address: 'Hamra, Main Rd', remember: true });
const d1 = loadRememberedDetails();
ok(d1 && d1.address === 'Hamra, Main Rd' && d1.remember === true, 'details roundtrip with address');
// Unchecked forgets the details. Pins live in session state only.
saveRememberedDetails({ name: 'Ali', phone: '70123456', address: 'Hamra', remember: false });
ok(loadRememberedDetails() === null, 'unchecked forgets details');
// Delivery without a pin is allowed (address-only order).
{
  const m = JSON.parse(JSON.stringify(MENU));
  const noPin = validateOrderInput(orderBody(), m);
  ok(noPin.ok === true && noPin.cleaned.location === null, 'address-only order allowed without pin');
}
// The address is never stored: withoutAddress drops it, keeps the rest.
{
  const saved = withoutAddress({ name: 'Ali', phone: '70123456', address: 'Hamra, Main Rd', email: 'a@b.co', remember: true });
  ok(!('address' in saved), 'withoutAddress drops the address key');
  ok(saved.name === 'Ali' && saved.phone === '70123456' && saved.email === 'a@b.co' && saved.remember === true, 'withoutAddress keeps everything else');
}

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
  // Country suffix: bare local text gets ", Lebanon" so Google Maps lands
  // in-country instead of "no result"; an existing suffix is not doubled.
  ok(decodeURIComponent(link2.url).includes('Tripoli, Azmi St 12, Lebanon'), 'fallback query suffixed with Lebanon');
  const arNoPin = { ...cleaned, address: 'الحمرا، بناية 5', location: null };
  const linkAr = buildMapsLink(arNoPin);
  ok(linkAr && linkAr.precise === false && decodeURIComponent(linkAr.url).includes('الحمرا، بناية 5, Lebanon'), 'arabic fallback query suffixed too');
  const already = buildMapsLink({ ...cleaned, address: 'Beirut, Hamra, Lebanon', location: null });
  const decAlready = decodeURIComponent(already.url);
  ok(decAlready.includes('Hamra, Lebanon') && (decAlready.match(/Lebanon/g) || []).length === 1, 'existing Lebanon suffix not duplicated');

  // Store country is automatic per client (white-label): selected delivery
  // zones win, then the store timezone, then Lebanon as the last resort.
  ok(storeCountry({ ordering: { deliveryZones: { mode: 'selected', countries: [{ cc: 'AE', subdivisions: 'ALL' }] } }, timezone: 'Asia/Beirut' }).en === 'United Arab Emirates', 'selected zone country wins over timezone');
  ok(storeCountry({ ordering: { deliveryZones: { mode: 'all', countries: [] } }, timezone: 'Asia/Dubai' }).en === 'United Arab Emirates', 'timezone resolves UAE');
  ok(storeCountry({ ordering: { deliveryZones: { mode: 'all', countries: [] } }, timezone: 'Africa/Cairo' }).ar === 'مصر', 'timezone resolves Egypt with Arabic name');
  ok(storeCountry(null).en === 'Lebanon' && storeCountry({}).ar === 'لبنان', 'missing settings fall back to Lebanon');
  const aeLink = buildMapsLink({ ...cleaned, address: 'Marina Walk', location: null }, { en: 'United Arab Emirates', ar: 'الإمارات' });
  ok(aeLink && decodeURIComponent(aeLink.url).includes('Marina Walk, United Arab Emirates'), 'fallback query suffixed with the store country');
  const aeDup = buildMapsLink({ ...cleaned, address: 'دبي مارينا، الإمارات', location: null }, { en: 'United Arab Emirates', ar: 'الإمارات' });
  ok((decodeURIComponent(aeDup.url).match(/الإمارات/g) || []).length === 1, 'existing Arabic country suffix not duplicated');

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
