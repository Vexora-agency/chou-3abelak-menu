/**
 * GET /api/admin/reports/<YYYY-MM>.csv — streams the month's CSV
 * (R2 snapshot when present, otherwise built live from orders while they
 * exist). Authenticated download with Content-Disposition filename
 * chou3abelak-YYYY-MM-orders.csv.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';
import { getMonthCSV, isValidMonth } from '../../../_shared/reports.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!hasFeature(env, 'monthlyReports')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });

  let month = typeof params?.month === 'string' ? params.month : '';
  if (month.toLowerCase().endsWith('.csv')) month = month.slice(0, -4);
  if (!isValidMonth(month)) return jsonNoStore({ error: 'bad_month' }, 400);

  let got;
  try {
    got = await getMonthCSV(env, month);
  } catch {
    got = null;
  }
  if (!got || typeof got.csv !== 'string') return jsonNoStore({ error: 'not_found' }, 404);

  return new Response(got.csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chou3abelak-${month}-orders.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
