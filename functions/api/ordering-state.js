/**
 * GET /api/ordering-state — public, read-only availability snapshot:
 * { state, message, reopensAt?, serverTime }. Reads settings only
 * (nothing sensitive). Cache-Control: no-store.
 */

import { getOrderingState } from '../_shared/status.js';
import { jsonNoStore } from '../_shared/session.js';

/**
 * Stable ETag over exactly the fields the client renders
 * (state/message/reopensAt). serverTime is deliberately excluded: it
 * ticks every second and would make every poll look changed.
 * ASCII-safe djb2 hex (messages may contain Arabic — never put raw
 * Unicode in a header).
 */
function stableTag(st) {
  const basis = JSON.stringify({ s: st.state, m: st.message, r: st.reopensAt || '' });
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = (((h << 5) + h + basis.charCodeAt(i)) >>> 0);
  return `W/"os-${h.toString(16)}"`;
}

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
  // Conditional GET: unchanged polls answer 304 with no body, so the
  // 3 s / 5 s / 60 s scheduler cadence costs headers only. The client
  // echoes this tag (see fetchOrderingStatusVersioned); serverTime keeps
  // flowing on 200s only, while the Date header stays fresh on both.
  const tag = stableTag(st);
  if (request.headers.get('If-None-Match') === tag) {
    return new Response(null, { status: 304, headers: { ETag: tag, 'Cache-Control': 'no-store' } });
  }
  return jsonNoStore({ ...st, serverTime: new Date().toISOString() }, 200, { ETag: tag });
}
