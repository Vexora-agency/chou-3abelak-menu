/**
 * GET /api/admin/backup/csv — spreadsheet of items × variants (BOM, Arabic).
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { buildMenuCSV } from '../../../_shared/versions.js';
import { businessTimezone, fileDate, readLiveMenu } from '../../../_shared/reports.js';

export async function onRequest(context) {
  const { request, env } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);
  const menu = await readLiveMenu(env);
  if (!menu) return jsonNoStore({ error: 'unavailable' }, 503);
  const timezone = await businessTimezone(env);
  return new Response(buildMenuCSV(menu), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chou3abelak-menu-${fileDate(timezone)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
