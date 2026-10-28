# Cart Isolation & Persistence

> Automated guard: `npm run test:cart` (`scripts/test-cart-isolation.mjs`,
> 20 assertions). This doc is the human-readable contract + manual checklist.

## Short answer for the owner

**Mohamed does NOT see Ahmed's cart** — as long as they use different
browsers/devices. The cart lives in each browser's own `localStorage`
(`cart_v1`); the server never stores carts and there is no login, so there
is no identity to mix up. Same phone + same browser = shared cart
(expected without login, not a bug). The cart **empties automatically
after a successful order** and otherwise expires **7 days after its last
change** (both white-label configurable, see below).

## Storage mechanism

| Question | Answer | Evidence |
|---|---|---|
| Where | `localStorage` (per browser profile) | `features/cart/hooks/useShopCartState.ts:26,60` |
| Key | `cart_v1` (fixed, no user/session suffix) | same file; no `userId`/`sessionId` in key |
| sessionStorage / IndexedDB / cookies | Not used for cart | grep: zero hits in `features/cart` |
| Server-side cart | None — `functions/api/cart/*` does not exist | glob empty; transport (`services/cart.api.ts:19`) only `POST /api/orders` |
| What server stores | One-shot order snapshot (items/prices recomputed from live menu) | `functions/api/orders.js:98-107`, repo INSERT |
| TTL / expiry | 7-day sliding window (`cart_timestamp_v1`, refreshed on every save; stale carts dropped on load) | `useShopCartState.ts` (`CART_TS_KEY`, `CART_EXPIRY_DAYS`), window from `client.config.ts cart.expiryDays` |
| Auto-clear after order | **Yes** — on the WhatsApp-opened success path the hook calls `onOrderSuccess` (wired to the cart owner's clear); validation/availability gates return early so failed sends keep the cart | `useCartCheckoutSubmit.ts:234-239`, `CartDrawer.tsx:69` (`onOrderSuccess: onClearCart`), kill-switch `client.config.ts cart.clearAfterOrder` |
| Related keys (same scoping) | `customer_details_v1` (only if "remember me"), `menu_cache_v3`, `menu_lang_v1`, `menu_theme_v1` | `useCartCheckoutSubmit.ts:24,167,169`, `useMenuLoader.ts:19`, `useAppPrefs.ts:8,17` |

## Manual test checklist (5 minutes, no tools)

- [ ] **Reload:** add item → reload page → cart still there (localStorage).
- [ ] **Tab close:** add item → close tab → reopen site in same browser → cart still there.
- [ ] **Incognito:** open private window → cart is EMPTY (separate storage).
- [ ] **Second browser/device:** open site elsewhere → cart is EMPTY (no leak).
- [ ] **Same-device sharing:** hand the phone to someone else → they see the
      cart (expected: no login exists; use "Clear cart and close" to reset).
- [ ] **After order:** send an order → cart is EMPTY (auto-cleared on the
      WhatsApp-opened success path; failed/ blocked sends keep the cart).
- [ ] **Expiry:** add item → DevTools → set `cart_timestamp_v1` to 8 days
      ago → reload → cart is EMPTY. Repeat with 6 days ago → cart STAYS.
- [ ] **Kill-switch:** set `cart.clearAfterOrder: false` in
      `client.config.ts` → send order → cart STAYS (per-client opt-out).
- [ ] **Corrupt data:** cart with unknown item ids self-heals on load
      (unavailable lines are dropped, `useShopCartState.ts:68-101`).

## Security notes

- **Hijack another user's cart?** No vector: no cart GET endpoint, no
  predictable cart id (the only id in flight, `idemKey`, is a random
  per-drawer-session UUID, `useCartCheckoutSubmit.ts:178-182`).
- **Abuse ceiling (not identity):** `POST /api/orders` is limited to
  5 orders / 10 min / IP (`functions/api/orders.js:13-16,110-127`).
- **Privacy note:** `customer_details_v1` persists name/phone/address only
  when the user ticks "remember me"; otherwise it is removed on send
  (`useCartCheckoutSubmit.ts:165-171`).

## Recommendation

Implemented: auto-clear after successful order + 7-day sliding expiry, both
gated by `client.config.ts cart.{expiryDays, clearAfterOrder}` per sold
client. No fix required for isolation — it is SAFE. Remaining nicety:
mention the per-browser scoping in the README/FAQ.
