/**
 * Report generation (idempotent) + live current-month summary + CSV serving.
 * Split from reports.js — depends on time/aggregation/retention siblings.
 * Works in Cloudflare Workers and Node.
 * Re-exported from ./reports.js so existing importers keep working.
 */

import { isValidMonth, monthBoundsUTC, prevMonth } from './reports-time.js';
import { buildCSV, summarizeMonth } from './reports-aggregation.js';
import { getRetentionConfig } from './reports-retention.js';
import {
  countByStatusByBounds,
  countRevenueByBounds,
  fetchOrderRowsByBounds,
  insertMonthlyReportRow,
  readMonthlyReportRow,
} from './repositories/reports.repo.js';

export function csvKeyFor(month) {
  return `reports/${month}.csv`;
}

function mapReportRow(row) {
  let items = [];
  try {
    const parsed = JSON.parse(row.items_json || '[]');
    if (Array.isArray(parsed)) items = parsed;
  } catch {}
  return {
    id: row.id,
    number: row.number,
    createdAt: row.created_at,
    status: row.status,
    type: row.type,
    items,
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
  };
}

export async function loadMenuBasics(env) {
  let menu = null;
  try {
    menu = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  const settings = (menu && menu.settings) || {};
  let timezone = typeof settings.timezone === 'string' && settings.timezone ? settings.timezone : 'Asia/Beirut';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    timezone = 'Asia/Beirut';
  }
  const name = settings.name && typeof settings.name === 'object'
    ? { en: settings.name.en || 'Restaurant', ar: settings.name.ar || settings.name.en || 'Restaurant' }
    : { en: 'Restaurant', ar: 'Restaurant' };
  const currency = settings.currency && typeof settings.currency === 'object'
    ? { en: settings.currency.en || '', ar: settings.currency.ar || settings.currency.en || '' }
    : { en: '', ar: '' };
  const validTypes = ['delivery', 'pickup', 'dinein'];
  const rawTypes = settings.ordering && typeof settings.ordering === 'object' ? settings.ordering.types : null;
  const orderTypes = Array.isArray(rawTypes) && rawTypes.length
    ? rawTypes.filter((t) => validTypes.includes(t))
    : [...validTypes];
  return { timezone, restaurantName: name, currency, orderTypes };
}

async function aggregateBounds(db, startISO, endISO) {
  // SQL lives in repositories/reports.repo.js — domain math stays here.
  const cur = await countRevenueByBounds(db, startISO, endISO);
  const stRows = await countByStatusByBounds(db, startISO, endISO);
  return { cur, stRows };
}

async function fetchMonthRows(db, startISO, endISO) {
  // SQL lives in repositories/reports.repo.js — row mapping stays here.
  const rows = await fetchOrderRowsByBounds(db, startISO, endISO);
  return rows.map(mapReportRow);
}

export async function readStoredReport(db, month) {
  const row = await readMonthlyReportRow(db, month);
  if (!row || !row.summary_json) return null;
  try {
    return { month, summary: JSON.parse(row.summary_json), csvKey: row.csv_key || null, emailedAt: row.emailed_at || null, emailStatus: row.email_status || null, attempts: row.email_attempts || 0 };
  } catch {
    return null;
  }
}

/**
 * Generate (or reuse) the monthly report. Never throws for missing R2 —
 * the CSV is served on demand from orders in that case.
 */
export async function generateMonthlyReport(env, ym) {
  if (!isValidMonth(ym)) {
    const e = new Error('bad_month');
    e.code = 'bad_month';
    throw e;
  }
  const db = env.ORDERS_DB;
  if (!db) {
    const e = new Error('unavailable');
    e.code = 'unavailable';
    throw e;
  }

  const stored = await readStoredReport(db, ym);
  if (stored) return { ...stored, reused: true };

  const { timezone } = await loadMenuBasics(env);
  const { start, end } = monthBoundsUTC(timezone, ym);
  const prev = monthBoundsUTC(timezone, prevMonth(ym));

  const { stRows } = await aggregateBounds(db, start, end);
  const prevBounds = await aggregateBounds(db, prev.start, prev.end);
  const prevAgg = { orders: prevBounds.cur?.c || 0, revenue: prevBounds.cur?.rev || 0 };

  const rows = await fetchMonthRows(db, start, end);
  const completed = (stRows.find((r) => r.status === 'completed') || {}).c || 0;
  const cancelled = (stRows.find((r) => r.status === 'cancelled') || {}).c || 0;

  const partial = summarizeMonth(rows, timezone, prevAgg);
  const summary = {
    month: ym,
    generatedAt: new Date().toISOString(),
    totals: { ...partial.totals, completed, cancelled },
    prev: partial.prev,
    busiestDay: partial.busiestDay,
    peakHour: partial.peakHour,
    topItems: partial.topItems,
    types: partial.types,
  };

  const csv = buildCSV(rows, timezone);
  const csvKey = csvKeyFor(ym);
  let storedKey = null;
  if (env.REPORTS && typeof env.REPORTS.put === 'function') {
    try {
      await env.REPORTS.put(csvKey, csv, { httpMetadata: { contentType: 'text/csv; charset=utf-8' } });
      storedKey = csvKey;
    } catch {}
  }

  try {
    await insertMonthlyReportRow(db, { month: ym, summaryJson: JSON.stringify(summary), csvKey: storedKey, generatedAt: summary.generatedAt });
  } catch {
    // Lost a race with another run: reuse the winner's row (idempotent).
    const winner = await readStoredReport(db, ym);
    if (winner) return { ...winner, reused: true };
    throw new Error('unavailable');
  }
  return { month: ym, summary, csvKey: storedKey, emailedAt: null, emailStatus: null, attempts: 0, reused: false };
}

/** Live (unstored) summary for the current in-progress month. */
export async function summarizeCurrentMonth(env, ym) {
  const db = env.ORDERS_DB;
  if (!db || !isValidMonth(ym)) return null;
  const { timezone } = await loadMenuBasics(env);
  const { start, end } = monthBoundsUTC(timezone, ym);
  const nowIso = new Date().toISOString();
  const effEnd = end < nowIso ? end : nowIso;
  const a = await aggregateBounds(db, start, effEnd);
  const rows = await fetchMonthRows(db, start, effEnd);
  const prev = monthBoundsUTC(timezone, prevMonth(ym));
  const p = await aggregateBounds(db, prev.start, prev.end);
  const completed = (a.stRows.find((r) => r.status === 'completed') || {}).c || 0;
  const cancelled = (a.stRows.find((r) => r.status === 'cancelled') || {}).c || 0;
  const partial = summarizeMonth(rows, timezone, { orders: p.cur?.c || 0, revenue: p.cur?.rev || 0 });
  return {
    month: ym,
    summary: {
      month: ym,
      generatedAt: nowIso,
      totals: { ...partial.totals, completed, cancelled },
      prev: partial.prev,
      busiestDay: partial.busiestDay,
      peakHour: partial.peakHour,
      topItems: partial.topItems,
      types: partial.types,
    },
  };
}

/* ---------------- 6. CSV serving + email payload ---------------- */

/**
 * CSV for a month: stored R2 snapshot first, otherwise built live from
 * orders while they exist. Returns { csv } or null when unavailable.
 */
export async function getMonthCSV(env, ym) {
  if (!isValidMonth(ym)) return null;
  const db = env.ORDERS_DB;
  if (!db) return null;
  const key = csvKeyFor(ym);
  if (env.REPORTS && typeof env.REPORTS.get === 'function') {
    try {
      const obj = await env.REPORTS.get(key);
      if (obj) {
        const text = await obj.text();
        if (typeof text === 'string' && text.length) return { csv: text, cached: true };
      }
    } catch {}
  }
  const stored = await readStoredReport(db, ym);
  const { timezone } = await loadMenuBasics(env);
  const { start, end } = monthBoundsUTC(timezone, ym);
  const rows = await fetchMonthRows(db, start, end);
  if (!stored && rows.length === 0) return null;
  const csv = buildCSV(rows, timezone);
  if (env.REPORTS && typeof env.REPORTS.put === 'function') {
    try {
      await env.REPORTS.put(key, csv, { httpMetadata: { contentType: 'text/csv; charset=utf-8' } });
    } catch {}
  }
  return { csv, cached: false };
}

/** Data object for renderMonthlyReportEmail(), in the recipient's language. */
export async function buildEmailPayload(env, summary, csvAttached) {
  const { restaurantName, currency, orderTypes } = await loadMenuBasics(env);
  const cfg = getRetentionConfig(env);
  const site = typeof env?.SITE_URL === 'string' ? env.SITE_URL.replace(/\/$/, '') : '';
  return {
    restaurantName,
    month: summary.month,
    currency,
    logoUrl: site ? `${site}/assets/email-logo.png` : '',
    dashboardUrl: site ? `${site}/#admin` : '',
    settingsUrl: site ? `${site}/#admin` : '',
    csvAttached: !!csvAttached,
    retention: { piiDays: cfg.piiDays },
    totals: summary.totals,
    prev: summary.prev,
    busiestDay: summary.busiestDay,
    peakHour: summary.peakHour,
    topItems: summary.topItems,
    types: summary.types,
    orderTypes,
  };
}
