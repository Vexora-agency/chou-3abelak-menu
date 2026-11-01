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
    // cacheTtl 30 is the platform minimum (anything lower throws and this
    // endpoint 503s on every request — do not lower it). 30s still cuts
    // most repeated KV reads; the endpoint is tiny. True seconds-fresh
    // flips would need a write-time purge, not a shorter TTL.
    const menu = env.MENU_KV ? await env.MENU_KV.get('menu', { type: 'json', cacheTtl: 30 }) : null;
    settings = (menu && menu.settings) || null;
  } catch (e) {
    // Silent catch hid a total outage (invalid TTL 503d every poll).
    // Log server-side only — never leaks to the client body.
    try { console.error('[ordering-state] menu read failed', e); } catch {}
  }
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
