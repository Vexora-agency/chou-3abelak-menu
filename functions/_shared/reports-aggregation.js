/**
 * Aggregation + CSV builder (UTF-8 BOM, no PII columns).
 * Split from reports.js — only dependency is ./reports-time.js for TZ extractors.
 * Works in Cloudflare Workers and Node.
 * Re-exported from ./reports.js so existing importers keep working.
 */

import { makeTZExtractors } from './reports-time.js';

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
