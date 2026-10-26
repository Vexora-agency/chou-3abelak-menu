/**
 * GET /api/admin/reports — stored monthly_reports rows (newest first) plus
 * a live on-demand row for the current in-progress month.
 * Behind the admin middleware + the "monthlyReports" plan feature.
 */

import { checkApiHeaders, jsonNoStore } from '../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import {
  currentMonthInTZ,
  loadMenuBasics,
  summarizeCurrentMonth,
} from '../../_shared/reports.js';

function rowOf(month, totals, extra) {
  return {
    month,
    orders: totals?.orders || 0,
    revenue: totals?.revenue || 0,
    avg: totals?.avg || 0,
    emailedAt: null,
    emailStatus: null,
    csvAvailable: true,
    ...extra,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'monthlyReports')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.ORDERS_DB) return jsonNoStore({ error: 'unavailable' }, 503);

  let stored = [];
  try {
    const res = await env.ORDERS_DB.prepare(
      'SELECT month, summary_json, emailed_at, email_status FROM monthly_reports ORDER BY month DESC'
    ).all();
    stored = (res && res.results) || [];
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  const { timezone } = await loadMenuBasics(env);
  const current = currentMonthInTZ(timezone);
  const reports = [];
  for (const r of stored) {
    if (typeof r.month !== 'string' || r.month === current) continue;
    let totals = null;
    try {
      totals = JSON.parse(r.summary_json || '').totals || null;
    } catch {}
    if (!totals) continue;
    reports.push(
      rowOf(r.month, totals, {
        emailedAt: r.emailed_at || null,
        emailStatus: r.email_status || null,
      })
    );
  }

  try {
    const live = await summarizeCurrentMonth(env, current);
    if (live && live.summary) {
      reports.unshift({
        ...rowOf(current, live.summary.totals, {}),
        inProgress: true,
      });
    }
  } catch {}

  return jsonNoStore({ reports });
}
