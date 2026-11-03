// Location auto-fix gate: center on saved pin, else one silent attempt.
// Run: npx tsx scripts/test-location-autofix.mjs
import { AUTO_LOCATE_OPTIONS, shouldAutoLocateOnOpen } from '../src/features/cart/hooks/useMidSplitLocationMap.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
};

ok('no pin -> auto-locate', shouldAutoLocateOnOpen(null) === true);
ok('undefined -> auto-locate', shouldAutoLocateOnOpen(undefined) === true);
ok('saved pin -> skip auto (center on it)', shouldAutoLocateOnOpen({ lat: 33.87476, lng: 35.545704 }) === false);
ok('high accuracy', AUTO_LOCATE_OPTIONS.enableHighAccuracy === true);
ok('~8s timeout', AUTO_LOCATE_OPTIONS.timeout === 8000);
ok('fresh fix', AUTO_LOCATE_OPTIONS.maximumAge === 0);

console.log(`location-autofix: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
