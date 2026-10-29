/**
 * Feature flags — controls which packages/tabs a sold client gets.
 * Backend (`functions/_shared/plan.js` SITE_PLAN) is the SOURCE OF TRUTH and answers 404 when off.
 * Frontend flags here only hide UI; never rely on them for security.
 *
 * Single source of truth: `plan` (patched per client by
 * scripts/setup-new-client.mjs — keep SITE_PLAN in sync on rebuild).
 * Tiers: starter < pro < plus (plus unlocks the same code as pro; it
 * differs by service — domain, redesign, reviews — not by gates).
 * Mapping: enableReports ↔ plan FEATURES.monthlyReports (pro, plus)
 *          enableOrderLogging ↔ plan FEATURES.orderLogging (pro, plus)
 *          enableBackup ↔ plan FEATURES.backups (pro, plus)
 *          enableCustomerData ↔ plan FEATURES.orderLogging (pro, plus)
 *          enableAnnouncements ↔ plan FEATURES.announcements (pro, plus)
 */
const plan: 'starter' | 'pro' | 'plus' =
  // DEV-ONLY plan preview (?plan=starter|pro|plus): compiled out of
  // production builds (import.meta.env.DEV is statically false there), so
  // customers can never switch plans. Browse every tier locally, e.g.
  // http://localhost:5173/?dev-admin&plan=starter#admin
  // http://localhost:5173/?dev-admin&plan=pro#admin
  // http://localhost:5173/?dev-admin&plan=plus#admin
  (() => {
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      const q = new URLSearchParams(window.location.search).get('plan');
      if (q === 'starter' || q === 'pro' || q === 'plus') return q;
    }
    return 'pro';
  })();
const premium = plan === 'pro' || plan === 'plus';

export const featuresConfig = {
  // Annotated (not narrowed): the setup script rewrites this line per client,
  // and gates compare against all three tiers.
  plan: plan as 'starter' | 'pro' | 'plus',
  enableReports: premium,
  enableOrderLogging: premium,
  enableChat: false,
  enableAnalytics: false,
  enableBackup: premium,
  enableCustomerData: premium,
  enableAnnouncements: premium,
} as const;

export type FeaturesConfig = typeof featuresConfig;
