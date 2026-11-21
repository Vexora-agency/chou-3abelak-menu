// Customer profile phone/address validation (server-side, shared rules).
// Usage: node scripts/test-auth-profile-policy.mjs

import {
  isProfileComplete,
  normalizePhoneDigits,
  validateProfileAddress,
  validateProfileLocation,
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
check('valid default pin', validateProfileLocation({ lat: 33.8938, lng: 35.5018, accuracy: 25 }).location?.lat === 33.8938);
check('null pin allowed', validateProfileLocation(null).ok && validateProfileLocation(null).location === null);
check('pin without lng rejected', validateProfileLocation({ lat: 33.89 }).code === 'location_invalid');
check('null coordinates rejected', validateProfileLocation({ lat: null, lng: null }).code === 'location_invalid');
check('empty coordinates rejected', validateProfileLocation({ lat: '', lng: '' }).code === 'location_invalid');
check('pin out of range rejected', validateProfileLocation({ lat: 200, lng: 35 }).code === 'location_invalid');
check('pin accuracy clamped', validateProfileLocation({ lat: 33.89, lng: 35.5, accuracy: 999999 }).location?.accuracy === 100000);
check('pin accuracy defaults to zero', validateProfileLocation({ lat: 33.89, lng: 35.5 }).location?.accuracy === 0);

// Order-readiness gate: phone + address are mandatory; the map pin is optional.
const complete = { phone: '70123456', address: 'Beirut, Hamra', location: { lat: 33.8938, lng: 35.5018 } };
check('complete profile accepted', isProfileComplete(complete));
check('null profile incomplete', !isProfileComplete(null));
check('missing phone incomplete', !isProfileComplete({ ...complete, phone: null }));
check('missing address incomplete', !isProfileComplete({ ...complete, address: '' }));
check('missing pin still complete', isProfileComplete({ ...complete, location: null }));
check('malformed pin ignored', isProfileComplete({ ...complete, location: { lat: NaN, lng: 35.5 } }));

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
