/**
 * GET /api/admin/backup/csv — spreadsheet of items × variants (BOM, Arabic).
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { buildMenuCSV } from '../../../_shared/versions.js';
import { loadMenuBasics } from '../../../_shared/reports.js';

function fileDate(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);
  let menu = null;
  try {
    menu = await env.MENU_KV.get('menu', { type: 'json' });
  } catch {}
  if (!menu) return jsonNoStore({ error: 'unavailable' }, 503);
  let timezone = 'Asia/Beirut';
  try {
    const b = await loadMenuBasics(env);
    if (b && b.timezone) timezone = b.timezone;
  } catch {}
  return new Response(buildMenuCSV(menu), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chou3abelak-menu-${fileDate(timezone)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
