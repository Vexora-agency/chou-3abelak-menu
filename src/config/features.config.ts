/**
 * Feature flags — controls which packages/tabs a sold client gets.
 * Backend (`functions/_shared/plan.js` SITE_PLAN) is the SOURCE OF TRUTH and answers 404 when off.
 * Frontend flags here only hide UI; never rely on them for security.
 *
 * Tiers: starter < pro < plus (plus unlocks the same code as pro; it
 * differs by service — domain, redesign, reviews — not by gates).
 * Mapping: enableReports ↔ plan FEATURES.monthlyReports (pro, plus)
 *          enableOrderLogging ↔ plan FEATURES.orderLogging (pro, plus)
 *          enableBackup ↔ plan FEATURES.backups (pro, plus)
 *          enableCustomerData ↔ plan FEATURES.orderLogging (pro, plus)
 *          enableAnnouncements ↔ plan FEATURES.announcements (pro, plus)
 */
export const featuresConfig = {
  enableReports: true,
  enableOrderLogging: true,
  enableChat: false,
  enableAnalytics: false,
  enableBackup: true,
  enableCustomerData: true,
  enableAnnouncements: true,
} as const;

export type FeaturesConfig = typeof featuresConfig;
