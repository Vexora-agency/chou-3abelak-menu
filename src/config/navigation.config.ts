import { featuresConfig } from './features.config';

export interface NavLink {
  id: string;
  labelEn: string;
  labelAr: string;
  path: string;
}

/**
 * Sidebar / admin tabs — driven by features.config (never hardcode per-client links).
 * To hide Reports for a starter client: set enableReports=false AND backend 404s it via SITE_PLAN.
 */
export const navigationConfig: NavLink[] = [
  { id: 'dashboard', labelEn: 'Dashboard', labelAr: 'لوحة التحكم', path: '/admin/dashboard' },
  { id: 'orders', labelEn: 'Orders', labelAr: 'الطلبات', path: '/admin/orders' },
  { id: 'menu', labelEn: 'Menu', labelAr: 'القائمة', path: '/admin/menu' },
  ...(featuresConfig.enableReports
    ? [{ id: 'reports', labelEn: 'Reports', labelAr: 'التقارير', path: '/admin/reports' } as NavLink]
    : []),
  ...(featuresConfig.enableBackup
    ? [{ id: 'backup', labelEn: 'Backup', labelAr: 'النسخ الاحتياطي', path: '/admin/backup' } as NavLink]
    : []),
  ...(featuresConfig.enableCustomerData
    ? [{ id: 'customers', labelEn: 'Customers', labelAr: 'العملاء', path: '/admin/customers' } as NavLink]
    : []),
];
