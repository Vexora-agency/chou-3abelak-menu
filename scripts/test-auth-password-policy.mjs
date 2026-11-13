// Server-side password policy: 10–128, letter + number, common-password block.
// Usage: node scripts/test-auth-password-policy.mjs

import {
  AUTH_PASSWORD_MAX,
  AUTH_PASSWORD_MIN,
  authErrorMessage,
  validateAuthPassword,
} from '../functions/_shared/validate-auth.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

const code = (password, context) => {
  const result = validateAuthPassword(password, context);
  return result.ok ? 'ok' : result.code;
};

check('minimum and maximum are the approved values', AUTH_PASSWORD_MIN === 10 && AUTH_PASSWORD_MAX === 128);
check('valid ascii password', code('Menu2026Safe') === 'ok');
check('valid arabic password + digit', code('كلمةالسر12') === 'ok');
check('too short', code('Abcdefg1') === 'password_too_short');
check('too long', code(`A1${'x'.repeat(127)}`) === 'password_too_long');
check('letters only', code('abcdefghij') === 'password_number_required');
check('digits only', code('1234567890') === 'password_letter_required');
check('common password', code('password123') === 'password_too_common');
check('site name password', code('chou3abelak') === 'password_too_common');
check('password equal to email', code('owner1@example.com', { email: 'owner1@example.com' }) === 'password_too_common');
check('non-string rejected', code(null) === 'password_too_short');
check('unknown code has a safe fallback', authErrorMessage('nope') === 'Invalid input.');
check('known code has a message', authErrorMessage('password_too_short').includes('10'));

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
