/**
 * Feature: admin (login + panel + catalog). Public API only.
 */
export { AdminPanel } from '@/src/components/AdminPanel';
export { default as AdminLogin } from '@/src/components/AdminLogin';
export { useAdminSaveAuth } from '@/src/hooks/useAdminSaveAuth';
export { useAdminSaveMenu } from '@/src/hooks/useAdminSaveMenu';
export { useAdminCatalog } from '@/src/hooks/useAdminCatalog';
export { useAdminApi } from '@/src/hooks/useAdminApi';
