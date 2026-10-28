/**
 * Feature: cart + checkout (public). Public API only — other features and
 * App.tsx import from here, never from ./components or ./hooks directly.
 */
export { CartBar } from './components/CartBar';
export { CartDrawer } from './components/CartDrawer';
export { useShopCartState } from './hooks/useShopCartState';
export { useCartCheckoutSubmit } from './hooks/useCartCheckoutSubmit';
export { submitOrder } from './services/cart.api';
export type { SubmitOrderPayload } from './services/cart.api';
