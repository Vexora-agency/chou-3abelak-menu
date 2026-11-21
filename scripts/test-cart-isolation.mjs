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
ok(
  route.includes('profile_incomplete') && route.includes('getCustomerProfile') && route.includes('isProfileComplete')
    && !route.includes('with a map pin'),
  'orders route requires a complete phone + address profile; the map pin is optional'
);
ok(
  checkout.includes('isProfileComplete(accountProfile)') && checkout.includes('onRequireProfile'),
  'checkout blocks an incomplete member profile and opens account settings without losing the cart'
);
ok(
  checkout.includes('memberProfileKeyRef') && checkout.includes("phone: accountProfile?.phone || ''") && checkout.includes("address: accountProfile?.address || ''"),
  'member checkout always takes name/phone/address from the account, overriding stale guest data'
);
const formFields = read('src/features/cart/components/cart/CustomerFormFields.tsx');
ok(
  formFields.includes('readOnly={isMember}') && formFields.includes('{!isMember && ('),
  'member name/phone are account-owned and the guest remember-me checkbox is hidden'
);
ok(
  route.includes('memberProfile') && route.includes('phone_verification_required')
    && route.includes('findValidVerification') && !route.includes('c.phoneNorm = profilePhone')
    && route.includes('c.name = profileName') && route.includes('c.email = accountEmail'),
  'orders use the account name/email and the verified entered phone for every member order'
);
const profileRoute = read('functions/api/account/profile.js');
ok(
  profileRoute.includes("error: 'phone_required'") && profileRoute.includes("error: 'address_required'")
    && !profileRoute.includes('address_pin_required'),
  'profile PATCH requires phone + address and accepts an address without a map pin'
);
const accountSheet = read('src/features/auth/components/AccountSheet.tsx');
const addressInputAt = accountSheet.indexOf('id="account-address"');
const addressInput = addressInputAt >= 0 ? accountSheet.slice(addressInputAt, addressInputAt + 2400) : '';
ok(
  !addressInput.includes('disabled={!location}') && addressInput.includes('onChange=') && addressInput.includes('placeholder='),
  'member settings address is editable without a map pin (pin optional)'
);
ok(
  accountSheet.includes('setAddress(pinAddress(lat, lng, addressText))'),
  'a new pin always rewrites the default address (never old pin + typed text)'
);
ok(
  addressInput.includes('absolute right-0.5') && addressInput.includes('pr-12'),
  'the settings map-pin button sits on the physical right (correct in Arabic RTL too)'
);
ok(
  !accountSheet.includes('pinSet') && !accountSheet.includes('الموقع مثبّت')
    && accountSheet.includes('t.changePin'),
  'the settings map pin is silent: the change-pin control remains, the green note is gone'
);
ok(
  formFields.includes('absolute right-0.5') && formFields.includes('pr-12'),
  'the cart map-pin button sits on the physical right (correct in Arabic RTL too)'
);
const cartDrawer = read('src/features/cart/components/CartDrawer.tsx');
ok(
  !cartDrawer.includes('hasDefaultAddress'),
  'the cart no longer computes a default-address badge for members'
);
ok(
  !formFields.includes('عنوانك الافتراضي')
    && !formFields.includes('الموقع مثبّت')
    && !formFields.includes('Your default address · edit it here.')
    && !formFields.includes('Location pinned')
    && formFields.includes('onOpenLocSheet')
    && formFields.includes('MapPin'),
  'the cart keeps the optional map pin but prints no default-address or pinned-location note'
);
ok(
  formFields.includes('phoneChanged')
    && formFields.includes('isDifferentAccountPhone')
    && formFields.includes('phoneVerificationPhase')
    && formFields.includes('onVerifyPhone')
    && formFields.includes('Verify this number on WhatsApp before ordering.')
    && formFields.includes('This number is verified on WhatsApp.')
    && formFields.includes('استخدم رقم حسابي')
    && !formFields.includes('OTP')
    && !formFields.includes('onOpenSettings'),
  'member phone is editable: every number shows its WhatsApp verification state and a reset to the saved number'
);
ok(
  (formFields.match(/readOnly=\{isMember\}/g) || []).length === 1,
  'only the member name stays read-only; the phone field is editable'
);
ok(
  checkout.includes('isPhoneVerified')
    && checkout.includes('onRequirePhoneVerification')
    && checkout.includes('Verify your phone number on WhatsApp before placing the order.'),
  'checkout blocks an unverified member number and opens the WhatsApp verification sheet'
);
ok(
  cartDrawer.includes('accountPhone={account.profile?.phone'),
  'the cart passes the saved account number as the reset baseline'
);
ok(
  !cartDrawer.includes('onOpenSettings'),
  'the cart no longer routes the phone note to Account → Settings'
);
const paymentSection = read('src/features/cart/components/cart/PaymentMethodSection.tsx');
ok(
  !paymentSection.includes('طلبك مرتبط') && !paymentSection.includes('linked to your account automatically'),
  'the redundant “order linked to your account” line stays removed'
);
ok(
  route.includes("if (!c.address && typeof memberProfile.address === 'string'")
    && route.includes('c.address = memberProfile.address.trim()'),
  'a manually written cart address wins; the saved default only fills a blank one'
);
ok(
  !formFields.includes('النص المكتوب هو ما يصل للمطبخ')
    && !formFields.includes('The written text is what the kitchen reads')
    && !formFields.includes('اضغط على أيقونة الموقع'),
  'cart shows no pin-vs-text helper message under the address'
);
ok(
  checkout.includes('Pin is OPTIONAL') && !checkout.includes('if (!location)'),
  'checkout accepts a written address with no map pin'
);
const profilePolicy = read('src/features/auth/profile.ts');
ok(
  profilePolicy.includes('profile.phone.trim()') && profilePolicy.includes('profile.address.trim()')
    && !profilePolicy.includes('profile.location'),
  'the client order gate treats the map pin as optional'
);
const authPolicy = read('functions/_shared/validate-auth.js');
const completeFnAt = authPolicy.indexOf('export function isProfileComplete');
const completeFn = completeFnAt >= 0 ? authPolicy.slice(completeFnAt, completeFnAt + 320) : '';
ok(
  completeFn.includes('phone && address') && !completeFn.includes('location'),
  'the server order gate treats the map pin as optional'
);
ok(
  accountSheet.includes('Saving is intentionally NOT gated')
    && accountSheet.includes('PhoneVerificationSheet')
    && checkout.includes('isPhoneVerified')
    && route.includes('phone_verification_required'),
  'settings saves a changed number immediately; checkout remains the verification gate'
);

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

/* ---------- F. add-to-cart landing (one-shot motion) ---------- */
const app = read('src/App.tsx');
const cartBar = read('src/features/cart/components/CartBar.tsx');
const menuAction = read('src/features/menu/components/menu-list/MenuListItemAction.tsx');
const cartLines = read('src/features/cart/components/cart/CartLinesList.tsx');
const animations = read('src/styles/animations.css');
ok(
  app.includes('addPendingRef.current = true') &&
  app.includes('qty - (prev[key] ?? 0)') &&
  app.includes('setJustAddedLine'),
  'App names the line that just grew, gated on a real add (not boot/cleanup/in-drawer steps)'
);
ok(
  app.includes('justAddedKey={justAddedLine?.key ?? null}') &&
  cartDrawer.includes("querySelectorAll<HTMLElement>('[data-line-key]')") &&
  cartDrawer.includes('behavior: \'smooth\''),
  'the drawer scrolls the just-added row into view (its own scroller, never Lenis)'
);
ok(
  cartLines.includes('CartLineQty') && cartLines.includes('key={qty}') && cartLines.includes('cart-line-land'),
  'the landed row gets the one-shot gold ring and its own keyed qty pop'
);
ok(
  cartBar.includes('key={totalCount}') && cartBar.includes('anim-badge-pop'),
  'the cart-bar count badge pops when the count changes'
);
ok(
  menuAction.includes('anim-stepper-in') && menuAction.includes('anim-qty-pop') && menuAction.includes('stepperAnimate'),
  '+ becomes a stepper with a one-shot entrance + keyed qty pop (no replay on re-render)'
);
const animationsNoComments = animations.replace(/\/\*[\s\S]*?\*\//g, '');
const landingCss = animationsNoComments.slice(animationsNoComments.indexOf('.anim-qty-pop'));
ok(
  landingCss.length > 0 && !landingCss.includes('infinite') && !landingCss.includes('forwards') && !landingCss.includes('prefers-reduced-motion'),
  'landing animations are one-shot (no loops/retained layers) and run for every visitor (owner policy)'
);

summary();
