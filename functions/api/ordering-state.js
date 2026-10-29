/**
 * GET /api/ordering-state — public, read-only availability snapshot:
 * { state, message, reopensAt?, serverTime }. Reads settings only
 * (nothing sensitive). Cache-Control: no-store.
 */

import { getOrderingState } from '../_shared/status.js';
import { jsonNoStore } from '../_shared/session.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  let settings = null;
  try {
    // cacheTtl: polls hit this every few seconds while paused — the state it
    // computes changes on minute scales, so a short edge cache cuts repeated
    // KV reads without ever serving a stale open/closed flip.
    const menu = env.MENU_KV ? await env.MENU_KV.get('menu', { type: 'json', cacheTtl: 30 }) : null;
    settings = (menu && menu.settings) || null;
  } catch {}
  if (!settings) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  let st;
  try {
    st = getOrderingState(settings, Date.now());
  } catch {
    st = { state: 'open', message: { en: '', ar: '' } };
  }
  return jsonNoStore({ ...st, serverTime: new Date().toISOString() });
}
