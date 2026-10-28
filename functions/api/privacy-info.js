/**
 * GET /api/privacy-info — public, read-only numbers for the privacy page:
 * { piiDays, orderMonths, reportMonths, hasOrderRecords }. Nothing sensitive.
 */

import { getRetentionConfig } from '../_shared/reports.js';
import { hasFeature } from '../_shared/plan.js';
import { jsonNoStore } from '../_shared/session.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  const cfg = getRetentionConfig(env);
  return jsonNoStore({
    piiDays: cfg.piiDays,
    orderMonths: cfg.orderMonths,
    reportMonths: cfg.reportMonths,
    hasOrderRecords: hasFeature(env, 'orderLogging') && !!env.ORDERS_DB,
  });
}
