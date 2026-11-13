// Server-side display-name validation (signup + profile update).
// Usage: node scripts/test-auth-name-policy.mjs

import {
  AUTH_NAME_MAX,
  normalizeAuthName,
  validateAuthName,
} from '../functions/_shared/validate-auth.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

check('max is 80', AUTH_NAME_MAX === 80);
check('trims and collapses spaces', normalizeAuthName('  Mina   Adel  ') === 'Mina Adel');
check('non-string becomes empty', normalizeAuthName(null) === '');
check('valid name returns normalized value', (() => {
  const result = validateAuthName('  Mina   Adel ');
  return result.ok && result.name === 'Mina Adel';
})());
check('empty rejected', validateAuthName('   ').code === 'name_required');
check('81 chars rejected', validateAuthName('x'.repeat(81)).code === 'name_too_long');
check('80 chars accepted', validateAuthName('x'.repeat(80)).ok === true);
check('arabic name accepted', validateAuthName('مينا عادل').ok === true);

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
