/**
 * Feature: orders (admin dashboard + public availability). Public API only —
 * other features and App.tsx import from here, never from ./components or
 * ./hooks directly.
 */
export { default as OrdersDashboard } from './components/OrdersDashboard';
export { useAdminOrders } from './hooks/useAdminOrders';
export { useOrderingState } from './hooks/useOrderingState';
export type { Order, OrderStatus } from './components/orders/ordersDashTypes';
