// Kitchen-role server gates: central policy + route defense-in-depth.
// Usage: node scripts/test-kitchen-gate.mjs
// Covers: kitchen reads orders (GET) + updates status (PATCH) via middleware
// AND through the real route handlers; kitchen PUT menu / POST+DELETE images
// -> 403 at both layers; owner + client behavior unchanged; anonymous stays
// 403. No infra: fake KV + fake D1, WebCrypto sessions minted locally.
import { getRequestRole, isKitchenAllowed } from '../functions/_shared/kitchen-gate.js';
import { createSessionToken } from '../functions/_shared/session.js';
import { onRequest as middleware } from '../functions/api/admin/_middleware.js';
import { onRequest as menuReq } from '../functions/api/admin/menu.js';
import { onRequest as imagesReq } from '../functions/api/admin/images.js';
import { onRequest as ordersReq } from '../functions/api/admin/orders.js';
import { onRequest as orderByIdReq } from '../functions/api/admin/orders/[id].js';

let fails = 0;
const check = (name, cond) => {
  if (!cond) {
    fails++;
    console.error(`  FAIL ${name}`);
  } else {
    console.log(`  ok ${name}`);
  }
};

// ---- fake environment ----
const secretBytes = crypto.getRandomValues(new Uint8Array(32));
let s = '';
for (let i = 0; i < secretBytes.length; i++) s += String.fromCharCode(secretBytes[i]);
const store = new Map();
const kv = {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  put: async (k, v) => { store.set(k, v); },
  delete: async (k) => { store.delete(k); },
};
const ORDER_ROW = {
  id: 'o1',
  number: 7,
  created_at: new Date().toISOString(),
  status: 'ready',
  type: 'delivery',
  customer_name: 't',
  customer_phone: '0',
  items_json: '[]',
  subtotal: 1,
  delivery_fee: 0,
  total: 1,
};
const fakeDb = {
  prepare: () => ({
    bind: () => ({
      all: async () => ({ results: [] }),
      first: async () => ({ ...ORDER_ROW }),
      run: async () => ({ meta: { changes: 1 } }),
    }),
  }),
};
const env = { SESSION_SECRET: btoa(s), MENU_KV: kv, SITE_PLAN: 'pro', ORDERS_DB: fakeDb };

const ownerTok = await createSessionToken(secretBytes, 'admin', 3600);
const clientTok = await createSessionToken(secretBytes, 'client:layali', 3600);
const kitchenTok = await createSessionToken(secretBytes, 'kitchen:main', 3600);
const cookieFor = (t) => `__Host-admin-session=${t}`;

const mwCall = (path, method, tok) =>
  middleware({
    request: new Request(`https://x${path}`, {
      method,
      headers: tok ? { Cookie: cookieFor(tok) } : {},
    }),
    env,
    next: async () => new Response('NEXT-OK'),
  });

// ---- 1) allowlist unit checks ----
check('kitchen GET /api/admin/orders allowed', isKitchenAllowed('/api/admin/orders', 'GET') === true);
check('kitchen GET /api/admin/orders?days=7 allowed', isKitchenAllowed('/api/admin/orders?days=7', 'GET') === true);
check('kitchen GET /api/admin/orders/ (slash) allowed', isKitchenAllowed('/api/admin/orders/', 'GET') === true);
check('kitchen PATCH /api/admin/orders/abc allowed', isKitchenAllowed('/api/admin/orders/abc', 'PATCH') === true);
check('kitchen GET /api/admin/orders/abc allowed', isKitchenAllowed('/api/admin/orders/abc', 'GET') === true);
check('kitchen PUT /api/admin/orders denied', isKitchenAllowed('/api/admin/orders', 'PUT') === false);
check('kitchen POST /api/admin/orders denied', isKitchenAllowed('/api/admin/orders/abc', 'POST') === false);
check('kitchen DELETE /api/admin/orders/abc denied', isKitchenAllowed('/api/admin/orders/abc', 'DELETE') === false);
check('kitchen GET /api/admin/menu denied', isKitchenAllowed('/api/admin/menu', 'GET') === false);
check('kitchen PUT /api/admin/menu denied', isKitchenAllowed('/api/admin/menu', 'PUT') === false);
check('kitchen POST /api/admin/images denied', isKitchenAllowed('/api/admin/images', 'POST') === false);
check('kitchen DELETE /api/admin/images denied', isKitchenAllowed('/api/admin/images', 'DELETE') === false);
check('kitchen GET /api/admin/reports denied', isKitchenAllowed('/api/admin/reports', 'GET') === false);
check('kitchen POST /api/admin/ordering/pause denied', isKitchenAllowed('/api/admin/ordering/pause', 'POST') === false);
check('kitchen GET /api/admin/versions denied', isKitchenAllowed('/api/admin/versions', 'GET') === false);
check('kitchen POST /api/admin/push-subscriptions allowed (own device)', isKitchenAllowed('/api/admin/push-subscriptions', 'POST') === true);
check('kitchen DELETE /api/admin/push-subscriptions allowed (own device)', isKitchenAllowed('/api/admin/push-subscriptions', 'DELETE') === true);
check('kitchen GET /api/admin/push-subscriptions denied (device list)', isKitchenAllowed('/api/admin/push-subscriptions', 'GET') === false);

// ---- 2) role resolution (session-payload fallback) ----
const reqWith = (tok) => new Request('https://x/api/admin/orders', { headers: { Cookie: cookieFor(tok) } });
check('role kitchen:main -> kitchen', (await getRequestRole(reqWith(kitchenTok), env)) === 'kitchen');
check('role admin -> admin', (await getRequestRole(reqWith(ownerTok), env)) === 'admin');
check('role client:layali -> client', (await getRequestRole(reqWith(clientTok), env)) === 'client');
check('role anonymous -> null', (await getRequestRole(new Request('https://x/api/admin/orders'), env)) === null);

// ---- 3) middleware: kitchen allowed shapes pass through ----
{
  const r = await mwCall('/api/admin/orders?days=7', 'GET', kitchenTok);
  check('kitchen reads orders via middleware (200 passthrough)', r.status === 200 && (await r.text()) === 'NEXT-OK');
}
{
  const r = await mwCall('/api/admin/orders/o1', 'PATCH', kitchenTok);
  check('kitchen PATCH order via middleware (passthrough)', r.status === 200 && (await r.text()) === 'NEXT-OK');
}
{
  const r = await mwCall('/api/admin/orders/o1', 'GET', kitchenTok);
  check('kitchen GET single order via middleware (passthrough)', r.status === 200);
}
// ---- 4) middleware: kitchen denied shapes -> 403 ----
for (const [m, p] of [
  ['PUT', '/api/admin/menu'],
  ['GET', '/api/admin/menu'],
  ['POST', '/api/admin/images'],
  ['DELETE', '/api/admin/images?key=menu/2026/01/x.jpg'],
  ['GET', '/api/admin/reports'],
  ['GET', '/api/admin/reports/2026-01'],
  ['POST', '/api/admin/ordering/pause'],
  ['POST', '/api/admin/ordering/enabled'],
  ['GET', '/api/admin/versions'],
  ['GET', '/api/admin/trash'],
  ['POST', '/api/admin/backup/export'],
  ['GET', '/api/admin/invites/list'],
  ['POST', '/api/admin/clients/update'],
  ['POST', '/api/admin/sessions/revoke'],
  ['GET', '/api/admin/activity'],
  ['GET', '/api/admin/telegram'],
]) {
  const r = await mwCall(p, m, kitchenTok);
  check(`kitchen ${m} ${p} -> 403`, r.status === 403);
}
// ---- 5) middleware: owner + client unchanged, anonymous closed ----
{
  const r = await mwCall('/api/admin/menu', 'PUT', ownerTok);
  check('owner PUT menu still passes middleware', r.status === 200);
}
{
  const r = await mwCall('/api/admin/reports', 'GET', ownerTok);
  check('owner GET reports still passes middleware', r.status === 200);
}
{
  const r = await mwCall('/api/admin/orders', 'GET', clientTok);
  check('client GET orders still passes middleware', r.status === 200);
}
{
  const r = await mwCall('/api/admin/menu', 'PUT', clientTok);
  check('client PUT menu still passes middleware (as before)', r.status === 200);
}
{
  const r = await mwCall('/api/admin/orders', 'GET', null);
  check('anonymous GET orders still 403', r.status === 403);
}

// ---- 6) route-level defense-in-depth (direct invocation, no middleware) ----
{
  const r = await menuReq({
    request: new Request('https://x/api/admin/menu', { method: 'PUT', headers: { Cookie: cookieFor(kitchenTok) } }),
    env,
  });
  check('route: kitchen PUT menu -> 403', r.status === 403);
}
{
  const r = await imagesReq({
    request: new Request('https://x/api/admin/images', { method: 'POST', headers: { Cookie: cookieFor(kitchenTok) } }),
    env,
  });
  check('route: kitchen POST images -> 403', r.status === 403);
}
{
  const r = await imagesReq({
    request: new Request('https://x/api/admin/images?key=menu/2026/01/x.jpg', {
      method: 'DELETE',
      headers: { Cookie: cookieFor(kitchenTok) },
    }),
    env,
  });
  check('route: kitchen DELETE images -> 403', r.status === 403);
}
{
  // Owner without API headers still gets the pre-existing 400 (kitchen guard
  // did not swallow or alter the owner path).
  const r = await imagesReq({
    request: new Request('https://x/api/admin/images', { method: 'POST', headers: { Cookie: cookieFor(ownerTok) } }),
    env,
  });
  check('route: owner POST images w/o headers still 400 (unchanged)', r.status === 400);
}
// ---- 7) real order handlers with a kitchen session ----
{
  const r = await ordersReq({
    request: new Request('https://x/api/admin/orders?days=7', { headers: { Cookie: cookieFor(kitchenTok) } }),
    env,
  });
  const body = await r.json().catch(() => null);
  check('route: kitchen GET orders -> 200 with orders array', r.status === 200 && body && Array.isArray(body.orders));
}
{
  const r = await orderByIdReq({
    request: new Request('https://x/api/admin/orders/o1', {
      method: 'PATCH',
      headers: {
        Cookie: cookieFor(kitchenTok),
        'X-Requested-With': 'menu-admin',
        Origin: 'https://x',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'ready' }),
    }),
    env,
    params: { id: 'o1' },
  });
  const body = await r.json().catch(() => null);
  check('route: kitchen PATCH order status -> 200 with order', r.status === 200 && body && body.order && body.order.id === 'o1');
}

if (fails) {
  console.error(`test-kitchen-gate: ${fails} FAILURES`);
  process.exit(1);
}
console.log('test-kitchen-gate: all green');
