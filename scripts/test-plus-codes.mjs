// Open Location Code (plus codes) encoder — offline, quota-free.
// Run: npx tsx scripts/test-plus-codes.mjs
import { encodePlusCode } from '../src/utils/plusCodes.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
};

ok('encodes a grid-aligned point exactly', encodePlusCode(20.5, 2.75) === '7FG4GQ22+22');
ok('encodes a second grid-aligned point', encodePlusCode(47.0000625, 8.0000625) === '8FVC2222+22');
ok('grid refinement appends one char for length 11', encodePlusCode(20.5, 2.75, 11) === '7FG4GQ22+222');
ok('separator sits at position 8', encodePlusCode(31.205, 29.945).indexOf('+') === 8);
ok('alexandria code starts with 8G', encodePlusCode(31.205, 29.945).startsWith('8G'));
ok('nearby points share a prefix, distant ones do not', (() => {
  const a = encodePlusCode(31.205, 29.945);
  const b = encodePlusCode(31.2051, 29.9451);
  const c = encodePlusCode(33.8938, 35.5018);
  return a.slice(0, 6) === b.slice(0, 6) && a.slice(0, 4) !== c.slice(0, 4);
})());
ok('rejects garbage', encodePlusCode(NaN, 1) === '' && encodePlusCode(1, Infinity) === '');
ok('clamps the poles', encodePlusCode(90, 0).length > 8 && encodePlusCode(-91, 0).startsWith('2'));

console.log(`plus-codes: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
