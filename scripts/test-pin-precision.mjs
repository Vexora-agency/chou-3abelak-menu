// Exact-delivery address composer (Talabat-style details with the pin).
// Run: npx tsx scripts/test-pin-precision.mjs
import { composePreciseAddress } from '../src/features/cart/hooks/useMidSplitLocationMap.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
};

const empty = { building: '', floor: '', apt: '', landmark: '' };

ok('base alone passes through',
  composePreciseAddress('Hamra Street, Beirut', empty, 33.9, 35.5, 'en') === 'Hamra Street, Beirut');
ok('coords fallback when base is null',
  composePreciseAddress(null, empty, 33.9, 35.5, 'en') === '33.9, 35.5');
ok('en details compose in order',
  composePreciseAddress('Hamra Street, Beirut', { building: '5', floor: '2', apt: '3', landmark: 'Near the pharmacy' }, 33.9, 35.5, 'en')
  === 'Hamra Street, Beirut — Bldg 5, Floor 2, Apt 3, Landmark: Near the pharmacy');
ok('ar details compose with arabic labels',
  composePreciseAddress('شارع الحمرا، بيروت', { building: '5', floor: '2', apt: '3', landmark: 'بجوار الصيدلية' }, 33.9, 35.5, 'ar')
  === 'شارع الحمرا، بيروت — مبنى 5، الدور 2، شقة 3، علامة: بجوار الصيدلية');
ok('blank details are skipped',
  composePreciseAddress('Base', { building: '  ', floor: '', apt: '7', landmark: '' }, 1, 2, 'en') === 'Base — Apt 7');
ok('details ride on the coords fallback too',
  composePreciseAddress(null, { building: '5', floor: '', apt: '', landmark: '' }, 31.2, 29.95, 'ar') === '31.2, 29.95 — مبنى 5');
ok('output capped at 200 chars',
  composePreciseAddress('x'.repeat(190), { building: 'y'.repeat(60), floor: '', apt: '', landmark: '' }, 1, 2, 'en').length === 200);
ok('fields capped at 60 chars each',
  composePreciseAddress('Base', { building: 'z'.repeat(100), floor: '', apt: '', landmark: '' }, 1, 2, 'en').includes('z'.repeat(60))
  && !composePreciseAddress('Base', { building: 'z'.repeat(100), floor: '', apt: '', landmark: '' }, 1, 2, 'en').includes('z'.repeat(61)));

console.log(`pin-precision: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
