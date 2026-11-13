// Callback/redirect safety: relative paths and explicitly trusted origins only.
// Usage: node scripts/test-auth-redirect.mjs

import { isSafeCallbackTarget } from '../functions/_shared/validate-auth.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

const trusted = ['https://menu.example.com', 'http://localhost:3000'];

check('relative path allowed', isSafeCallbackTarget('/account', trusted));
check('relative path with query allowed', isSafeCallbackTarget('/?track=123&t=abc', trusted));
check('absolute trusted origin allowed', isSafeCallbackTarget('https://menu.example.com/account', trusted));
check('localhost trusted origin allowed', isSafeCallbackTarget('http://localhost:3000/account', trusted));
check('foreign origin rejected', !isSafeCallbackTarget('https://evil.example/account', trusted));
check('protocol-relative rejected', !isSafeCallbackTarget('//evil.example/account', trusted));
check('backslash rejected', !isSafeCallbackTarget('/\\evil.example/account', trusted));
check('javascript scheme rejected', !isSafeCallbackTarget('javascript:alert(1)', trusted));
check('data scheme rejected', !isSafeCallbackTarget('data:text/html,<script>alert(1)</script>', trusted));
check('credentials rejected', !isSafeCallbackTarget('https://user:pass@menu.example.com/account', trusted));
check('empty rejected', !isSafeCallbackTarget('', trusted));
check('non-string rejected', !isSafeCallbackTarget(null, trusted));
check('control chars rejected', !isSafeCallbackTarget('/account\nX: y', trusted));

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
