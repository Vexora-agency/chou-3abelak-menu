/**
 * GET /api/ordering-state — public, read-only availability snapshot:
 * { state, message, reopensAt?, serverTime }. Reads settings only
 * (nothing sensitive). Cache-Control: no-store.
 */

import { getOrderingState } from '../_shared/status.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Allow: 'GET' },
    });
  }
  let settings = null;
  try {
    const menu = env.MENU_KV ? await env.MENU_KV.get('menu', { type: 'json' }) : null;
    settings = (menu && menu.settings) || null;
  } catch {}
  if (!settings) {
    return new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  let st;
  try {
    st = getOrderingState(settings, Date.now());
  } catch {
    st = { state: 'open', message: { en: '', ar: '' } };
  }
  return new Response(JSON.stringify({ ...st, serverTime: new Date().toISOString() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
