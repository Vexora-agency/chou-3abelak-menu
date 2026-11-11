/** Smart delivery-fee parity test: server resolver + sample order math. */
import { resolveDeliveryFeeJs, normalizeDeliveryFeeTiersJs } from '../functions/_shared/delivery-fees.js';
import { validateOrderInput } from '../functions/_shared/orders.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.log(`FAIL - ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

const tiers = [
  { upToKm: 2, fee: 20000 },
  { upToKm: 5, fee: 35000 },
  { upToKm: 10, fee: 50000 },
];
const ordDist = { deliveryFeeEnabled: true, deliveryFeeMode: 'distance', deliveryFeeTiers: tiers, deliveryFee: 20000 };

// tier matching
eq('0.5km -> first tier', resolveDeliveryFeeJs(ordDist, 0.5, 0).fee, 20000);
eq('2km boundary -> first tier', resolveDeliveryFeeJs(ordDist, 2, 0).fee, 20000);
eq('2.1km -> second tier', resolveDeliveryFeeJs(ordDist, 2.1, 0).fee, 35000);
eq('5km boundary -> second', resolveDeliveryFeeJs(ordDist, 5, 0).fee, 35000);
eq('9.9km -> third', resolveDeliveryFeeJs(ordDist, 9.9, 0).fee, 50000);
eq('beyond last -> last tier', resolveDeliveryFeeJs(ordDist, 45, 0).fee, 50000);
eq('unknown distance -> highest (fail-closed)', resolveDeliveryFeeJs(ordDist, null, 0).fee, 50000);

// free threshold
eq('free over threshold', resolveDeliveryFeeJs({ ...ordDist, freeDeliveryEnabled: true, freeDeliveryMin: 500000 }, 1, 600000).fee, 0);
eq('below threshold pays', resolveDeliveryFeeJs({ ...ordDist, freeDeliveryEnabled: true, freeDeliveryMin: 500000 }, 1, 100000).fee, 20000);

// flat fallback + disabled
eq('flat mode ignores distance', resolveDeliveryFeeJs({ deliveryFeeEnabled: true, deliveryFee: 15000 }, 9, 0).fee, 15000);
eq('empty tiers fall back to flat', resolveDeliveryFeeJs({ deliveryFeeEnabled: true, deliveryFeeMode: 'distance', deliveryFeeTiers: [], deliveryFee: 15000 }, 9, 0).fee, 15000);
eq('disabled -> 0', resolveDeliveryFeeJs({ deliveryFeeEnabled: false, deliveryFeeMode: 'distance', deliveryFeeTiers: tiers }, 1, 0).fee, 0);

// normalization: unsorted + dupes + garbage
eq('normalize sorts+dedupes', normalizeDeliveryFeeTiersJs([
  { upToKm: 5, fee: 35 }, { upToKm: 2, fee: 20 }, { upToKm: 2, fee: 99 }, { upToKm: 'x', fee: 1 }, null,
]), [{ upToKm: 2, fee: 20 }, { upToKm: 5, fee: 35 }]);

// end-to-end: order fee comes from distance, not client input
const menu = {
  settings: {
    mapUrl: '33.8938, 35.5018',
    ordering: { ...ordDist, enabled: true, types: ['delivery'] },
  },
  items: [{ id: 'i1', available: true, pricing: { unit: 'pc', price: 100000, minQty: 1, step: 1, maxQty: 50, showUnit: false } }],
};
const near = validateOrderInput({
  type: 'delivery',
  customer: { name: 'Roni', phone: '70123456', address: 'Hamra' },
  items: [{ id: 'i1', qty: 1 }],
  location: { lat: 33.8938, lng: 35.5018 },
  lang: 'en',
}, menu);
eq('order at 0km pays first tier', near.ok && near.cleaned.deliveryFee, 20000);
eq('order total includes fee', near.ok && near.cleaned.total, 120000);

const far = validateOrderInput({
  type: 'delivery',
  customer: { name: 'Roni', phone: '70123456', address: 'Far' },
  items: [{ id: 'i1', qty: 1 }],
  location: { lat: 33.95, lng: 35.6 },
  lang: 'en',
}, menu);
eq('far order pays more than near', far.ok && far.cleaned.deliveryFee > 20000, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
