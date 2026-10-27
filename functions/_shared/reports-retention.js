/**
 * Retention (PII purge, order delete, report delete) with the hard rule:
 * never touch orders of a month until its monthly_reports row exists.
 * Split from reports.js — only dependency is ./reports-time.js for MONTH_RE.
 * Works in Cloudflare Workers and Node.
 * Re-exported from ./reports.js so existing importers keep working.
 */

import { MONTH_RE } from './reports-time.js';

const DAY_MS = 86400000;

function csvKeyFor(month) {
  return `reports/${month}.csv`;
}

export function getRetentionConfig(env) {
  const num = (v, dflt, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, Math.floor(n)));
  };
  return {
    piiDays: num(env?.PII_RETENTION_DAYS, 90, 1, 3650),
    orderMonths: num(env?.ORDER_RETENTION_MONTHS, 13, 1, 120),
    reportMonths: num(env?.REPORT_RETENTION_MONTHS, 36, 1, 120),
  };
}

function utcMonthStartMinus(monthsBack) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - monthsBack;
  return new Date(Date.UTC(y, m, 1));
}

function utcMonthOf(iso) {
  return String(iso || '').slice(0, 7);
}

/**
 * Enforce retention. Returns counts. The hard rule is enforced via `guardISO`:
 * rows at/after it are never purged or deleted (they may belong to a month
 * with no report yet; minus a 1-day margin for TZ-boundary orders).
 */
export async function runRetention(env) {
  const db = env.ORDERS_DB;
  if (!db) throw new Error('unavailable');
  const cfg = getRetentionConfig(env);
  const nowMs = Date.now();
  // Step names only (never row data) so a silent no-op is distinguishable
  // from a failing statement.
  const errors = [];

  const reported = new Set();
  try {
    const res = await db.prepare('SELECT month FROM monthly_reports').all();
    for (const r of (res && res.results) || []) {
      if (typeof r.month === 'string') reported.add(r.month);
    }
  } catch {}

  // Earliest UTC month (from oldest order to now) with no report row.
  let oldestMonth = null;
  try {
    const row = await db.prepare('SELECT MIN(created_at) AS m FROM orders').first();
    if (row && typeof row.m === 'string' && row.m.length >= 7) oldestMonth = utcMonthOf(row.m);
  } catch {}
  let guardISO = null;
  if (oldestMonth && MONTH_RE.test(oldestMonth)) {
    const [oy, om] = oldestMonth.split('-').map(Number);
    const cur = new Date(Date.UTC(oy, om - 1, 1));
    const nowStart = new Date(Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), 1));
    while (cur <= nowStart) {
      const ym = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!reported.has(ym)) {
        guardISO = new Date(cur.getTime() - DAY_MS).toISOString();
        break;
      }
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  const piiCutoff = new Date(nowMs - cfg.piiDays * DAY_MS).toISOString();
  const effPurgeCut = guardISO && guardISO < piiCutoff ? guardISO : piiCutoff;

  let purged = 0;
  try {
    const r = await db
      .prepare(
        'UPDATE orders SET customer_name = NULL, customer_phone = NULL, phone_norm = NULL, customer_address = NULL, notes = NULL, location_lat = NULL, location_lng = NULL, pii_purged_at = ?1 WHERE created_at < ?2 AND pii_purged_at IS NULL'
      )
      .bind(new Date(nowMs).toISOString(), effPurgeCut)
      .run();
    purged = (r && r.meta && typeof r.meta.changes === 'number') ? r.meta.changes : 0;
  } catch {
    errors.push('purge');
  }

  const orderCutoff = utcMonthStartMinus(cfg.orderMonths - 1).toISOString();
  const effDelCut = guardISO && guardISO < orderCutoff ? guardISO : orderCutoff;
  let deletedOrders = 0;
  try {
    const r = await db
      .prepare('DELETE FROM orders WHERE created_at < ?1 AND pii_purged_at IS NOT NULL')
      .bind(effDelCut)
      .run();
    deletedOrders = (r && r.meta && typeof r.meta.changes === 'number') ? r.meta.changes : 0;
  } catch {
    errors.push('deleteOrders');
  }

  // Monthly reports older than the window (+ their R2 CSVs).
  const rptCut = (() => {
    const d = utcMonthStartMinus(cfg.reportMonths - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  })();
  let oldMonths = [];
  try {
    const res = await db.prepare('SELECT month FROM monthly_reports WHERE month < ?1').bind(rptCut).all();
    oldMonths = ((res && res.results) || []).map((r) => r.month).filter((m) => typeof m === 'string');
  } catch {
    errors.push('readOldReports');
  }
  let deletedReports = 0;
  if (oldMonths.length) {
    try {
      const del = await db.prepare('DELETE FROM monthly_reports WHERE month < ?1').bind(rptCut).run();
      deletedReports = (del && del.meta && typeof del.meta.changes === 'number') ? del.meta.changes : 0;
    } catch {
      errors.push('deleteReports');
    }
    if (env.REPORTS && typeof env.REPORTS.delete === 'function') {
      for (const m of oldMonths) {
        try {
          await env.REPORTS.delete(csvKeyFor(m));
        } catch {}
      }
    }
  }

  return { purged, deletedOrders, deletedReports, guardMonth: guardISO ? utcMonthOf(guardISO) : null, config: cfg, errors };
}
