// Pin/address pair, session-only pins: the Telegram maps link must always
// match what the customer actually submitted this order. Pins are NEVER
// remembered, so no stale pin from another visit/city can ride along.
//   - delivery without a pin -> rejected with location_required
//   - fresh-picked good coords -> exact pin link (same lat/lng as submitted)
//   - a confirmed pin always replaces the address with the pin's own geocode
//     (typed text from a previous location never sticks to new coords)
//   - coarse fix (>250m) -> rejected as location_required (re-pin precisely)
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
  pinAddress,
} from '../src/features/cart/hooks/useMidSplitLocationMap.ts';
import {
  checkPhone,
  composeNational,
  dialFromSettings,
  nationalPart,
} from '../src/utils/phoneCountry.ts';
import { dialCodeFromNumber } from '../functions/_shared/dial-codes.js';

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
// Delivery without a pin is rejected (pin required).
{
  const m = JSON.parse(JSON.stringify(MENU));
  const noPin = validateOrderInput(orderBody({ location: undefined }), m);
  ok(noPin.ok === false && noPin.errors.includes('location_required'), 'address-only order rejected without pin');
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
  ok(coarse.ok === false && coarse.errors.includes('location_required'), 'coarse fix rejected (re-pin precisely)');
  ok(validateOrderInput(orderBody({ location: undefined }), m).errors.includes('location_required'), 'missing pin rejected');
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

/* 4. Picker re-arm: saved pin centers the map; a confirmed pin owns the address. */
{
  ok(shouldAutoLocateOnOpen(null) === true, 'no pin -> auto-locate');
  ok(shouldAutoLocateOnOpen(undefined) === true, 'undefined -> auto-locate');
  ok(shouldAutoLocateOnOpen({ lat: 33.9, lng: 35.5 }) === false, 'saved pin -> center, never auto-overwrite');
  // A new pin always writes its own address. A manual address typed at the
  // previous location must not survive a different pin.
  ok(pinAddress(33.9, 35.5, null) === '33.9, 35.5', 'no geocode -> coords fallback');
  ok(pinAddress(33.9, 35.5, '   ') === '33.9, 35.5', 'blank geocode -> coords fallback');
  ok(pinAddress(33.9, 35.5, 'Hamra, Main Rd') === 'Hamra, Main Rd', 'geocoded pin address wins');
  ok(pinAddress(33.9, 35.5, 'My home floor 3').length <= 200, 'pin address capped at 200');
}

/* 5. Phone gate: the admin WhatsApp country controls accepted numbers. */
{
  const lb = dialFromSettings({ whatsapp: '96170123456' });
  ok(lb.iso === 'LB' && lb.code === '961', 'admin WhatsApp -> Lebanon +961');
  const eg = dialFromSettings({ whatsapp: '201001234567' });
  ok(eg.iso === 'EG' && eg.code === '20', 'admin WhatsApp -> Egypt +20');
  ok(dialFromSettings({ phone: '+961 70 123 456' }).code === '961', 'restaurant phone fallback');
  ok(nationalPart('96170123456', '961') === '70123456', 'stored full -> national display');
  ok(composeNational('70 123 456', '961') === '96170123456', 'national -> full compose');
  const local = checkPhone('70 123 456', '961');
  ok(local.ok && local.normalized === '96170123456', 'national number accepted + normalized');
  const plus = checkPhone('+961 70 123 456', '961');
  ok(plus.ok && plus.normalized === '96170123456', '+961 number accepted');
  const zero = checkPhone('00961 70 123 456', '961');
  ok(zero.ok && zero.normalized === '96170123456', '00-prefixed international accepted');
  const foreign = checkPhone('+20 100 123 4567', '961');
  ok(foreign.ok === false && foreign.reason === 'country', 'other dial code rejected');
  const foreignStored = checkPhone('201001234567', '961');
  ok(foreignStored.ok === false && foreignStored.reason === 'country', 'stored foreign full number rejected');
  ok(checkPhone('', '961').reason === 'empty', 'empty phone rejected');
  ok(checkPhone('123', '961').reason === 'too_short', 'short phone rejected');
  ok(dialCodeFromNumber('96170123456') === '961', 'server derives Lebanon +961');
  ok(dialCodeFromNumber('201001234567') === '20', 'server derives Egypt +20');
  const foreignOrder = validateOrderInput(
    { ...orderBody(), customer: { ...orderBody().customer, phone: '201001234567' } },
    MENU,
  );
  ok(
    foreignOrder.ok === false && foreignOrder.errors.includes('unsupported_phone_country'),
    'server rejects a foreign full number',
  );
  const localOrder = validateOrderInput(
    { ...orderBody(), customer: { ...orderBody().customer, phone: '96170123456' } },
    MENU,
  );
  ok(localOrder.ok === true, 'server accepts the matching country full number');
}

delete globalThis.localStorage;
delete globalThis.window;

summary();
