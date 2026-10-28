/**
 * Feature: admin (login + panel + catalog + settings). Public API only —
 * App.tsx imports from here, never from ./components or ./hooks directly.
 * Admin composes other features (orders/reports/backup/menu) via their
 * barrels only — never deep.
 */
export { AdminPanel } from './components/AdminPanel';
export { default as AdminLogin } from './components/AdminLogin';
export { useAdminSaveAuth } from './hooks/useAdminSaveAuth';
export { useAdminSaveMenu } from './hooks/useAdminSaveMenu';
export { useAdminCatalog } from './hooks/useAdminCatalog';
export { useAdminApi } from './hooks/useAdminApi';
export type { LoginResult } from './components/AdminLogin';
