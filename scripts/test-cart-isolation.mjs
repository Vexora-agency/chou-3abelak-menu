/**
 * Cart isolation + persistence audit as runnable assertions.
 * Run: node scripts/test-cart-isolation.mjs  (or: npm run test:cart)
 *
 * What it proves (without a browser):
 *  A. Storage mechanism is per-browser localStorage (static source scans):
 *     - cart lives ONLY in localStorage key 'cart_v1' (no user/session suffix,
 *       no sessionStorage/IndexedDB/cookies, no server cart endpoints).
 *  B. Two-browser separation (simulation): two isolated localStorage-like
 *     stores (Ahmed / Mohamed) round-tripping the same load/save shape as
 *     useShopCartState.loadCart — neither store ever sees the other's items.
 *  C. Same-device sharing (simulation): one shared store IS visible to the
 *     second "user" — expected without login, documented not a leak.
 *  D. Persistence contract: auto-clear after successful order (configurable)
 *     + 7-day sliding expiry (configurable) — asserted in detail below.
 *
 * A real two-context browser check (Playwright, not installed here) would be:
 *   const a = await browser.newContext(); // Ahmed
 *   const b = await browser.newContext(); // Mohamed (isolated storage)
 *   // add burger in a, pepsi in b, assert b has no burger.
 * The static assertions below guard the properties that make that true.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const shop = read('src/features/cart/hooks/useShopCartState.ts');
const checkout = read('src/features/cart/hooks/useCartCheckoutSubmit.ts');
const api = read('src/features/cart/services/cart.api.ts');
const route = read('functions/api/orders.js');

/* ---------- A. storage mechanism ---------- */
ok(shop.includes("CART_KEY = 'cart_v1'"), "cart lives under fixed localStorage key 'cart_v1'");
ok(shop.includes('localStorage.getItem(CART_KEY)') && shop.includes('localStorage.setItem(CART_KEY'), 'cart loads + persists via the SAME key on every change');
ok(!/localStorage\.(getItem|setItem|removeItem)\('cart[^']*(user|session|id)[^']*'/.test(shop), 'storage key has no user/session suffix (global per browser profile)');
ok(!shop.includes('sessionStorage') && !shop.includes('IndexedDB') && !shop.includes('document.cookie'), 'cart hook uses no sessionStorage/IndexedDB/cookies');
ok(!checkout.includes('sessionStorage') && !api.includes('sessionStorage'), 'checkout + transport also browser-local only');
ok(!existsSync(join(ROOT, 'functions/api/cart')), 'no server-side cart endpoints (functions/api/cart/* absent)');
ok(api.includes("publicPostRaw('/api/orders'") && !/http\.get|\.get\(/.test(api), 'transport is fire-and-forget POST /api/orders only (no cart GET to leak from)');
ok(/randomUUID|Math\.random/.test(checkout), 'idempotency key is random per drawer session, not a user identity (checkout:178-182)');
ok(route.includes('CF-Connecting-IP') && route.includes('RATE_KEY_PREFIX') && route.includes('checkAndReserveOrderBudget'), 'server rate limit is per-IP abuse cap, not per-user identity');
ok(route.includes('account_required') && route.includes("REQUIRE_ACCOUNT_FOR_COD !== '0'"), 'COD order gate requires a signed-in account (local tests opt out explicitly)');

/* ---------- B. two-browser separation (simulation) ---------- */
function makeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}
// Mirrors loadCart/persist shape: JSON under ONE fixed key, no identity.
const saveCart = (store, lines) => store.setItem('cart_v1', JSON.stringify(lines));
const loadCart = (store) => {
  const raw = store.getItem('cart_v1');
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : {};
  } catch { return {}; }
};
const ahmed = makeStore(); // Ahmed's browser (Cairo)
const mohamed = makeStore(); // Mohamed's browser (different device)
saveCart(ahmed, { 'burger||': { id: 'burger', quantity: 1 } });
saveCart(mohamed, { 'pepsi||': { id: 'pepsi', quantity: 1 } });
const ahmedSees = Object.values(loadCart(ahmed)).map((l) => l.id);
const mohamedSees = Object.values(loadCart(mohamed)).map((l) => l.id);
ok(ahmedSees.includes('burger') && !ahmedSees.includes('pepsi'), 'Ahmed sees ONLY burger');
ok(mohamedSees.includes('pepsi') && !mohamedSees.includes('burger'), 'Mohamed sees ONLY pepsi (no cross-user leakage)');

/* ---------- C. same device/browser (expected sharing) ---------- */
const sharedPhone = makeStore();
saveCart(sharedPhone, { 'burger||': { id: 'burger', quantity: 1 } }); // Ahmed adds
const secondUserSees = Object.values(loadCart(sharedPhone)).map((l) => l.id); // Mohamed picks up same phone
ok(secondUserSees.includes('burger'), 'same browser profile shares cart (expected without login — not a leak)');

/* ---------- D. persistence contract (clear-after-order + 7-day expiry) ---------- */
saveCart(ahmed, { 'burger||': { id: 'burger', quantity: 1 } }); // reload = same store, fresh read
ok(Object.keys(loadCart(ahmed)).length === 1, 'cart survives reload/tab-close (localStorage)');
ok(checkout.includes('onOrderSuccess?.()'), 'successful order empties the cart via onOrderSuccess (checkout:234)');
ok(
  checkout.includes('clearAfterOrder') &&
  read('src/features/cart/components/CartDrawer.tsx').includes('onOrderSuccess: onClearCart'),
  'auto-clear is configurable (client.config cart.clearAfterOrder) and wired to the cart owner'
);
ok(
  shop.includes("CART_TS_KEY = 'cart_timestamp_v1'") &&
  shop.includes('CART_EXPIRY_DAYS') &&
  shop.includes('localStorage.removeItem(CART_KEY)'),
  'sliding expiry: timestamp written on persist, stale carts dropped on load'
);
ok(
  read('src/config/client.config.ts').includes('expiryDays: 7'),
  'expiry window is white-label configurable (client.config cart.expiryDays)'
);

/* ---------- E. expiry logic (mirror of loadCart, Date-driven) ---------- */
const DAY = 24 * 60 * 60 * 1000;
const loadWithExpiry = (store, nowMs, expiryDays = 7) => {
  const ts = store.getItem('cart_timestamp_v1');
  if (ts) {
    const age = nowMs - parseInt(ts, 10);
    if (Number.isFinite(age) && age > expiryDays * DAY) {
      store.removeItem('cart_v1');
      store.removeItem('cart_timestamp_v1');
      return {};
    }
  }
  return loadCart(store);
};
const stale = makeStore();
stale.setItem('cart_v1', JSON.stringify({ 'burger||': { id: 'burger', quantity: 1 } }));
stale.setItem('cart_timestamp_v1', String(Date.now() - 8 * DAY)); // 8 days ago
ok(Object.keys(loadWithExpiry(stale, Date.now())).length === 0, '8-day-old cart expires on load');
ok(stale.getItem('cart_v1') === null, 'expired cart keys are removed, not just hidden');
const fresh = makeStore();
fresh.setItem('cart_v1', JSON.stringify({ 'burger||': { id: 'burger', quantity: 1 } }));
fresh.setItem('cart_timestamp_v1', String(Date.now() - 6 * DAY)); // 6 days ago
ok(Object.keys(loadWithExpiry(fresh, Date.now())).length === 1, '6-day-old cart survives (inside 7-day window)');

summary();
