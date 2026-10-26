/**
 * Monthly reporting domain (WebCrypto/node-compatible, no dependencies).
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

export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_MS = 86400000;

export function isValidMonth(ym) {
  return typeof ym === 'string' && MONTH_RE.test(ym);
}

export function prevMonth(ym) {
  const m = MONTH_RE.exec(ym);
  if (!m) throw new Error('bad_month');
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo === 0) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/* ---------------- 1. Month math (DST-safe) ---------------- */

/** UTC offset in minutes of `timeZone` at the given UTC instant. */
export function tzOffsetMinutes(timeZone, utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUTC - utcMs) / 60000);
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC millisecond instant.
 * Two refinement passes converge even across a DST transition.
 */
export function zonedTimeToUTC(timeZone, y, monthIndex, day, hour = 0, minute = 0) {
  const wallAsUTC = Date.UTC(y, monthIndex, day, hour, minute, 0);
  let guess = wallAsUTC;
  for (let i = 0; i < 2; i++) {
    guess = wallAsUTC - tzOffsetMinutes(timeZone, guess) * 60000;
  }
  return guess;
}

/** [startISO, endISO) UTC bounds of month ym as seen in timeZone. */
export function monthBoundsUTC(timeZone, ym) {
  const m = MONTH_RE.exec(ym);
  if (!m) throw new Error('bad_month');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = zonedTimeToUTC(timeZone, y, mo - 1, 1);
  const endMonth = mo === 12 ? { y: y + 1, mo: 1 } : { y, mo: mo + 1 };
  const end = zonedTimeToUTC(timeZone, endMonth.y, endMonth.mo - 1, 1);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/** 'YYYY-MM' of `nowMs` as seen in timeZone. */
export function currentMonthInTZ(timeZone, nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return `${get('year')}-${get('month')}`;
}

/** Day-of-month (1-31) in timeZone, for the "run on/after day 1" guard. */
export function dayOfMonthInTZ(timeZone, nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric' }).formatToParts(new Date(nowMs));
  return Number((parts.find((p) => p.type === 'day') || {}).value || 1);
}

/** Cached business-TZ extractors: YYYY-MM-DD date and 0-23 hour of an ISO instant. */
export function makeTZExtractors(timeZone) {
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  return {
    day(iso) {
      return dayFmt.format(new Date(iso));
    },
    hour(iso) {
      return Number(hourFmt.format(new Date(iso)));
    },
    dateTime(iso) {
      const d = new Date(iso);
      return { date: dayFmt.format(d), time: `${String(Number(hourFmt.format(d))).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` };
    },
  };
}

/* Note: time below is derived from the TZ hour plus UTC minutes. Minutes are
   timezone-independent, so pairing them is exact. */

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
  try {
    const row = await db.prepare('SELECT * FROM report_settings WHERE id = 1').first();
    if (!row) return null;
    return row;
  } catch {
    return null;
  }
}

/* ---------------- 3. Aggregation ---------------- */

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function itemDisplayName(it, withBoth) {
  const en = typeof it?.name?.en === 'string' ? it.name.en : '';
  const ar = typeof it?.name?.ar === 'string' ? it.name.ar : '';
  let base = en || ar;
  if (withBoth && en && ar && en !== ar) base = `${en} / ${ar}`;
  const v = it?.variantName;
  if (v) {
    const ven = typeof v.en === 'string' ? v.en : '';
    const varr = typeof v.ar === 'string' ? v.ar : '';
    let vn = ven || varr;
    if (withBoth && ven && varr && ven !== varr) vn = `${ven} / ${varr}`;
    if (vn) base += ` (${vn})`;
  }
  return base || 'item';
}

/**
 * Pure summary from already-fetched month rows + previous-month aggregates.
 * rows: mapped orders {createdAt, type, items:[{id,name,qty}], ...} (no PII needed).
 */
export function summarizeMonth(rows, tz, prevAgg) {
  const live = rows.filter((o) => o.status !== 'cancelled');
  const revenue = live.reduce((s, o) => s + (typeof o.total === 'number' ? o.total : 0), 0);
  const orders = live.length;
  const completed = live.filter((o) => o.status === 'completed').length;
  const cancelled = rows.filter((o) => o.status === 'cancelled').length;

  const types = { delivery: 0, pickup: 0, dinein: 0 };
  for (const o of live) {
    if (o.type === 'delivery' || o.type === 'pickup' || o.type === 'dinein') types[o.type] += 1;
  }

  const { day, hour } = makeTZExtractors(tz);
  const dayCounts = new Map();
  const hourCounts = new Array(24).fill(0);
  const itemMap = new Map();
  for (const o of live) {
    const d = day(o.createdAt);
    dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
    const h = hour(o.createdAt);
    if (h >= 0 && h < 24) hourCounts[h] += 1;
    for (const it of o.items || []) {
      const qty = typeof it.qty === 'number' ? it.qty : 0;
      if (!it || !it.id || qty <= 0) continue;
      const e = itemMap.get(it.id) || {
        name: {
          en: typeof it?.name?.en === 'string' ? it.name.en : '',
          ar: typeof it?.name?.ar === 'string' ? it.name.ar : '',
        },
        qty: 0,
      };
      e.qty += qty;
      itemMap.set(it.id, e);
    }
  }

  let busiestDay = null;
  for (const [date, count] of dayCounts) {
    if (!busiestDay || count > busiestDay.orders) busiestDay = { date, orders: count };
  }
  let peakHour = null;
  for (let h = 0; h < 24; h++) {
    if (peakHour === null || hourCounts[h] > hourCounts[peakHour]) peakHour = hourCounts[h] > 0 ? h : peakHour;
  }
  if (peakHour !== null && hourCounts[peakHour] === 0) peakHour = null;

  const topItems = [...itemMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

  return {
    totals: {
      orders,
      revenue: round2(revenue),
      avg: orders ? round2(revenue / orders) : 0,
      completed,
      cancelled,
    },
    prev: {
      orders: prevAgg.orders,
      revenue: round2(prevAgg.revenue),
      avg: prevAgg.orders ? round2(prevAgg.revenue / prevAgg.orders) : 0,
    },
    busiestDay,
    peakHour,
    topItems,
    types,
  };
}

export { itemDisplayName };

/* ---------------- 4. CSV (UTF-8 BOM, no PII) ---------------- */

const CSV_HEADER = 'order_number,date,time,type,status,items,subtotal,delivery_fee,total';

export function escapeCSV(v) {
  const s = String(v ?? '');
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows: mapped orders. Customer columns are never read here by construction. */
export function buildCSV(rows, tz) {
  const { dateTime } = makeTZExtractors(tz);
  const lines = [CSV_HEADER];
  const sorted = [...rows].sort((a, b) => (a.number || 0) - (b.number || 0));
  for (const o of sorted) {
    const { date, time } = dateTime(o.createdAt);
    const items = (o.items || [])
      .map((it) => `${itemDisplayName(it, true)} x ${typeof it.qty === 'number' ? it.qty : 0}`)
      .join('; ');
    lines.push(
      [
        o.number ?? '',
        date,
        time,
        o.type || '',
        o.status || '',
        items,
        o.subtotal ?? '',
        o.deliveryFee ?? o.delivery_fee ?? '',
        o.total ?? '',
      ]
        .map(escapeCSV)
        .join(',')
    );
  }
  return '﻿' + lines.join('\n') + '\n';
}

/* ---------------- 5. Report generation (idempotent) ---------------- */

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
  return { timezone, restaurantName: name, currency };
}

async function aggregateBounds(db, startISO, endISO) {
  const cur = await db
    .prepare(
      "SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS rev FROM orders WHERE created_at >= ?1 AND created_at < ?2 AND status != 'cancelled'"
    )
    .bind(startISO, endISO)
    .first();
  const st = await db
    .prepare('SELECT status, COUNT(*) AS c FROM orders WHERE created_at >= ?1 AND created_at < ?2 GROUP BY status')
    .bind(startISO, endISO)
    .all();
  return { cur, stRows: (st && st.results) || [] };
}

async function fetchMonthRows(db, startISO, endISO) {
  const res = await db
    .prepare(
      'SELECT id, number, created_at, type, status, items_json, subtotal, delivery_fee, total FROM orders WHERE created_at >= ?1 AND created_at < ?2 ORDER BY number ASC'
    )
    .bind(startISO, endISO)
    .all();
  return ((res && res.results) || []).map(mapReportRow);
}

export async function readStoredReport(db, month) {
  const row = await db.prepare('SELECT * FROM monthly_reports WHERE month = ?1').bind(month).first();
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

  const { cur, stRows } = await aggregateBounds(db, start, end);
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
    await db
      .prepare('INSERT INTO monthly_reports (month, summary_json, csv_key, generated_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(ym, JSON.stringify(summary), storedKey, summary.generatedAt)
      .run();
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
  const nowISO = new Date().toISOString();
  const effEnd = end < nowISO ? end : nowISO;
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
      generatedAt: nowISO,
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
  const { restaurantName, currency } = await loadMenuBasics(env);
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
  };
}

/* ---------------- 7. Retention ---------------- */

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
