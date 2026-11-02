/**
 * Feature: orders (admin dashboard + public availability). Public API only —
 * other features and App.tsx import from here, never from ./components or
 * ./hooks directly.
 */
export { default as OrdersDashboard } from './components/OrdersDashboard';
export { useAdminOrders } from './hooks/useAdminOrders';
export { useOrderingState } from './hooks/useOrderingState';
// Kitchen-bell audio engine, re-exported so the admin settings sound picker
// (the sole allowed cross-feature importer) reaches it through the barrel,
// never deep — see .dependency-cruiser.json feature-admin-isolation.
export { playNewOrderBeep, unlockOrderSound } from './hooks/useNewOrderSound';
export type { Order, OrderStatus, CronHealth } from './components/orders/ordersDashTypes';
