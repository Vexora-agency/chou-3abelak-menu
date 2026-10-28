/**
 * Client identity — THE ONLY file that changes per sold client (with theme + features).
 * NEVER hardcode company name / logo / support email in components. Import from here.
 */
export const clientConfig = {
  companyNameEn: 'Chou 3abelak',
  companyNameAr: 'شو عبالك',
  logo: '/assets/logo-final.png',
  logoWidth: 1440,
  logoHeight: 532,
  supportEmail: 'info@vexora.agency',
  replyTo: 'info@vexora.agency',
} as const;

export type ClientConfig = typeof clientConfig;
