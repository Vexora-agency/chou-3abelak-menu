/**
 * Feature flags — controls which packages/tabs a sold client gets.
 * Backend (`functions/_shared/plan.js` SITE_PLAN) is the SOURCE OF TRUTH and answers 404 when off.
 * Frontend flags here only hide UI; never rely on them for security.
 *
 * Mapping: enableReports ↔ plan FEATURES.monthlyReports (pro, signature)
 *          enableOrderLogging ↔ plan FEATURES.orderLogging (pro, signature)
 */
export const featuresConfig = {
  enableReports: true,
  enableOrderLogging: true,
  enableChat: false,
  enableAnalytics: false,
  enableBackup: true,
  enableCustomerData: true,
} as const;

export type FeaturesConfig = typeof featuresConfig;
