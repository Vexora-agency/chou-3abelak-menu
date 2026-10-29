/**
 * Feature flags — controls which packages/tabs a sold client gets.
 * Backend (`functions/_shared/plan.js` SITE_PLAN) is the SOURCE OF TRUTH and answers 404 when off.
 * Frontend flags here only hide UI; never rely on them for security.
 *
 * Single source of truth: `plan` (patched per client by
 * scripts/setup-new-client.mjs — keep SITE_PLAN in sync on rebuild).
 * Two tiers: starter (menu display only) < pro (full ordering + tools).
 * Mapping: enableReports ↔ plan FEATURES.monthlyReports (pro)
 *          enableOrderLogging ↔ plan FEATURES.orderLogging (pro)
 *          enableBackup ↔ plan FEATURES.backups (pro)
 *          enableCustomerData ↔ plan FEATURES.orderLogging (pro)
 *          enableAnnouncements ↔ plan FEATURES.announcements (pro)
 *          enableOrdering ↔ starter hides the whole ordering flow (pro)
 */
const plan: 'starter' | 'pro' =
  // DEV-ONLY plan preview (?plan=starter|pro): compiled out of
  // production builds (import.meta.env.DEV is statically false there), so
  // customers can never switch plans. Browse every tier locally, e.g.
  // http://localhost:5173/admin/dashboard?dev-admin&plan=starter
  // http://localhost:5173/admin/dashboard?dev-admin&plan=pro
  (() => {
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      const q = new URLSearchParams(window.location.search).get('plan');
      if (q === 'starter' || q === 'pro') return q;
    }
    return 'pro';
  })();
const premium = plan === 'pro';

export const featuresConfig = {
  plan,
  enableReports: premium,
  enableOrderLogging: premium,
  enableChat: false,
  enableAnalytics: false,
  enableBackup: premium,
  enableCustomerData: premium,
  enableAnnouncements: premium,
  /** Full ordering flow (cart, checkout, ordering admin). Starter is menu + call only. */
  enableOrdering: premium,
} as const;

export type FeaturesConfig = typeof featuresConfig;
