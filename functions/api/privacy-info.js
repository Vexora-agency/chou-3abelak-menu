/**
 * GET /api/privacy-info — public, read-only numbers for the privacy page:
 * { piiDays, orderMonths, reportMonths, hasOrderRecords }. Nothing sensitive.
 */

import { getRetentionConfig } from '../_shared/reports.js';
import { hasFeature } from '../_shared/plan.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Allow: 'GET' },
    });
  }
  const cfg = getRetentionConfig(env);
  return new Response(
    JSON.stringify({
      piiDays: cfg.piiDays,
      orderMonths: cfg.orderMonths,
      reportMonths: cfg.reportMonths,
      hasOrderRecords: hasFeature(env, 'orderLogging') && !!env.ORDERS_DB,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
}
