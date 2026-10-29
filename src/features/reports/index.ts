/**
 * Feature: reports (plan-gated: pro/plus). Disabled via features.config
 * + backend 404 on starter. Public API only — import from here, never deep.
 */
export { default as ReportsPanel } from './components/ReportsPanel';
export { default as CustomerData } from './components/CustomerData';
export { useReportCenter } from './hooks/useReportCenter';
export type { ReportSettings, MonthlyReportRow } from './components/ReportsPanel';
export type { CustomerResult } from './components/CustomerData';
