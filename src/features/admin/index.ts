/**
 * Feature: admin (login + panel + catalog + settings). Public API only —
 * App.tsx imports from here, never from ./components or ./hooks directly.
 * Admin composes other features (orders/reports/backup/menu) via their
 * barrels only — never deep.
 *
 * SOLE EXCEPTION (perf): App.tsx lazy-loads the two components and statically
 * imports the two gating hooks via direct file paths. Importing this barrel
 * (even lazily) keeps it whole in the customer bundle — the split was
 * verified broken (1,164 kB) until the barrel left the static graph.
 */
export { AdminPanel } from './components/AdminPanel';
export { default as AdminLogin } from './components/AdminLogin';
export { useAdminSaveAuth } from './hooks/useAdminSaveAuth';
export { useAdminSaveMenu } from './hooks/useAdminSaveMenu';
export { useAdminCatalog } from './hooks/useAdminCatalog';
export { useAdminApi } from './hooks/useAdminApi';
export type { LoginResult } from './components/AdminLogin';
