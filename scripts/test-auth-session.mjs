// Customer session gate + CSRF header twin of the admin gate.
// Usage: node scripts/test-auth-session.mjs

import {
  checkCustomerApiHeaders,
  getCustomerSession,
  requireCustomer,
} from '../functions/_shared/auth-session.js';

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

const url = 'http://localhost:3000/api/account/orders';
const req = (method, headers = {}) => new Request(url, { method, headers });

check('GET with customer header passes', checkCustomerApiHeaders(req('GET', {
  'X-Requested-With': 'menu-customer',
})).ok === true);

check('GET with admin header is rejected', (() => {
  const gate = checkCustomerApiHeaders(req('GET', { 'X-Requested-With': 'menu-admin' }));
  return gate.ok === false && gate.status === 400;
})());

check('POST without Origin is rejected', (() => {
  const gate = checkCustomerApiHeaders(req('POST', { 'X-Requested-With': 'menu-customer' }));
  return gate.ok === false && gate.status === 400;
})());

check('POST cross-origin is rejected', (() => {
  const gate = checkCustomerApiHeaders(req('POST', {
    'X-Requested-With': 'menu-customer',
    Origin: 'https://evil.example',
  }));
  return gate.ok === false && gate.status === 403;
})());

check('POST same-origin passes', checkCustomerApiHeaders(req('POST', {
  'X-Requested-With': 'menu-customer',
  Origin: 'http://localhost:3000',
})).ok === true);

check('loopback origin mismatch is allowed', (() => {
  const request = new Request('http://127.0.0.1:3000/api/account/orders', {
    method: 'POST',
    headers: { 'X-Requested-With': 'menu-customer', Origin: 'http://localhost:3000' },
  });
  return checkCustomerApiHeaders(request).ok === true;
})());

const noSession = () => ({ api: { getSession: async () => null } });
const withSession = () => ({
  api: {
    getSession: async () => ({
      user: { id: 'user-1', email: 'mina@example.com', name: 'Mina' },
      session: { id: 'session-1', userId: 'user-1' },
    }),
  },
});
const broken = () => {
  throw new Error('d1 down');
};

// Async checks are resolved below (a bare Promise is always truthy).
const asyncChecks = [
  ['no session -> 401', async () => {
    const result = await requireCustomer(req('GET', { 'X-Requested-With': 'menu-customer' }), {}, noSession);
    return result.ok === false && result.response.status === 401;
  }],
  ['valid session -> user + session', async () => {
    const result = await requireCustomer(req('GET', { 'X-Requested-With': 'menu-customer' }), {}, withSession);
    return result.ok === true && result.user.id === 'user-1' && result.session.id === 'session-1';
  }],
  ['infra failure -> 503 (never 401)', async () => {
    const result = await requireCustomer(req('GET', { 'X-Requested-With': 'menu-customer' }), {}, broken);
    return result.ok === false && result.response.status === 503;
  }],
  ['getCustomerSession returns null without a session', async () => {
    const result = await getCustomerSession(req('GET', {}), {}, noSession);
    return result === null;
  }],
];

for (const [name, fn] of asyncChecks) {
  check(name, await fn());
}

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
