// Customer profile phone/address validation (server-side, shared rules).
// Usage: node scripts/test-auth-profile-policy.mjs

import {
  normalizePhoneDigits,
  validateProfileAddress,
  validateProfilePhone,
} from '../functions/_shared/validate-auth.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

check('arabic digits normalize', normalizePhoneDigits('٠١٢٣٤٥٦٧٨٩') === '0123456789');
check('phone keeps only digits', normalizePhoneDigits('+961 70-123-456') === '96170123456');
check('empty phone clears', validateProfilePhone('').ok && validateProfilePhone('').phone === null);
check('valid phone', validateProfilePhone('70123456').phone === '70123456');
check('short phone rejected', validateProfilePhone('12345').code === 'phone_invalid');
check('long phone rejected', validateProfilePhone('1234567890123456').code === 'phone_invalid');
check('non-string phone rejected', validateProfilePhone(123).code === 'phone_invalid');
check('empty address clears', validateProfileAddress('   ').ok && validateProfileAddress('   ').address === null);
check('address trims + collapses', validateProfileAddress('  Beirut   street  ').address === 'Beirut street');
check('address max 200', validateProfileAddress('x'.repeat(220)).address.length === 200);
check('null address is allowed', validateProfileAddress(null).ok);

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
