/**
 * Feature: cart + checkout (public). Public API only — other features and
 * App.tsx import from here, never from ./components or ./hooks directly.
 */
export { CartBar } from './components/CartBar';
// NOTE: CartDrawer is intentionally NOT re-exported here — App.tsx imports
// it directly (lazy) so it splits into its own chunk instead of riding the
// main bundle through this barrel.
export { useShopCartState } from './hooks/useShopCartState';
export { useCartCheckoutSubmit } from './hooks/useCartCheckoutSubmit';
export { submitOrder } from './services/cart.api';
export type { SubmitOrderPayload } from './services/cart.api';
