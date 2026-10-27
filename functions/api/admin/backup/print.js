/**
 * GET /api/admin/backup/print — print-optimized A4 HTML page (?lang=ar|en).
 * Brand header, categories, names, prices. No admin controls, all text escaped.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { buildPrintHTML } from '../../../_shared/versions.js';
import { readLiveMenu } from '../../../_shared/reports.js';

export async function onRequest(context) {
  const { request, env } = context;
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.MENU_KV) return jsonNoStore({ error: 'unavailable' }, 503);
  const menu = await readLiveMenu(env);
  if (!menu) return jsonNoStore({ error: 'unavailable' }, 503);
  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ar';
  return new Response(buildPrintHTML(menu, lang), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
