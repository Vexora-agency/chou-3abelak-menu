/**
 * Monthly reporting domain (WebCrypto/node-compatible, no dependencies).
 * Split: month math in ./reports-time.js, aggregation/CSV in
 * ./reports-aggregation.js, generation in ./reports-generation.js,
 * retention in ./reports-retention.js. This file re-exports them so existing
 * importers keep working with identical export names.
 *
 * Sections:
 *  1. Month math (DST-safe, all boundaries in the business timezone).
 *  2. Verification-token + email-validation helpers for report settings.
 *  3. Aggregation: a few SQL queries for totals; a single pass over the
 *     month's rows for what SQL cannot do (items_json parsing, business-TZ
 *     day/hour). Customer columns are never SELECTed here.
 *  4. CSV builder (UTF-8 BOM, no PII columns).
 *  5. generateMonthlyReport(env, ym): idempotent, stores summary_json + CSV.
 *  6. Retention (PII purge, order delete, report delete) with the hard rule:
 *     never touch orders of a month until its monthly_reports row exists.
 */

import { loadMenuBasics } from './reports-generation.js';
import { getReportSettingsRow } from './repositories/reports.repo.js';

export {
  MONTH_RE,
  isValidMonth,
  prevMonth,
  tzOffsetMinutes,
  zonedTimeToUTC,
  monthBoundsUTC,
  currentMonthInTZ,
  dayOfMonthInTZ,
  makeTZExtractors,
} from './reports-time.js';
export { summarizeMonth, itemDisplayName, escapeCSV, buildCSV } from './reports-aggregation.js';
export {
  csvKeyFor,
  loadMenuBasics,
  readStoredReport,
  generateMonthlyReport,
  summarizeCurrentMonth,
  getMonthCSV,
  buildEmailPayload,
} from './reports-generation.js';
export { getRetentionConfig, runRetention } from './reports-retention.js';

/* ---------------- 2. Settings + token helpers ---------------- */

export function isValidReportEmail(s) {
  if (typeof s !== 'string') return false;
  const v = s.trim();
  if (v.length < 3 || v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fresh single-use confirmation token: the raw token goes in the email link,
 *  only its SHA-256 hash is stored. */
export async function newVerifyToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { token, hash: await sha256Hex(token) };
}

export function verifyExpiryISO() {
  return new Date(Date.now() + 48 * 3600 * 1000).toISOString();
}

export async function getReportSettings(db) {
  // SQL lives in repositories/reports.repo.js — this stays as the compat
  // entry point (routes + versions.js + tests import it from here).
  try {
    const row = await getReportSettingsRow(db);
    if (!row) return null;
    return row;
  } catch {
    return null;
  }
}

/* ---- Shared admin download preamble (backup export/csv/print) ---- */

/** YYYY-MM-DD in the business timezone (falls back to the UTC date). */
export function fileDate(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Live menu doc from KV (null on miss/error — caller maps it to 503). */
export async function readLiveMenu(env) {
  try {
    return await env.MENU_KV.get('menu', { type: 'json' });
  } catch {
    return null;
  }
}

/** Business timezone from menu basics (defaults to Asia/Beirut). */
export async function businessTimezone(env) {
  try {
    const basics = await loadMenuBasics(env);
    if (basics && basics.timezone) return basics.timezone;
  } catch {}
  return 'Asia/Beirut';
}
