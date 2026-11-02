/**
 * GET /api/ordering-state — public, read-only availability snapshot:
 * { state, message, reopensAt?, serverTime }. Reads settings only
 * (nothing sensitive). Cache-Control: no-store.
 *
 * KV discipline: this endpoint is polled every few seconds by every open
 * tab, so it sits behind a Cache API envelope (per datacenter, purged on
 * every ordering write via purgeMenuCaches + bounded by validUntil for
 * timed flips). A cache hit costs zero KV reads; only a miss/expired
 * snapshot reads `menu` once (edge-TTL 30s, the platform minimum).
 */

import { getOrderingState } from '../_shared/status.js';
import { jsonNoStore } from '../_shared/session.js';

/** Envelope TTL when no timed flip is scheduled (manual flips purge). */
const SNAPSHOT_TTL_MS = 60 * 1000;

/**
 * Stable ETag over exactly the fields the client renders
 * (state/message/reopensAt). serverTime is deliberately excluded: it
 * ticks every second and would make every poll look changed.
 * ASCII-safe djb2 hex (messages may contain Arabic — never put raw
 * Unicode in a header).
 */
function stableTag(snapshot) {
  const basis = JSON.stringify({ s: snapshot.state, m: snapshot.message, r: snapshot.reopensAt || '' });
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = (((h << 5) + h + basis.charCodeAt(i)) >>> 0);
  return `W/"os-${h.toString(16)}"`;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  // Cache API first: a fresh envelope answers with zero KV reads (the hot
  // path for the 3 s / 5 s pollers). Key is the bare endpoint URL — the
  // client sends no query, staleness is the envelope's validUntil.
  let cacheKey = null;
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      cacheKey = new Request(new URL(request.url).origin + '/api/ordering-state');
    }
  } catch {}
  if (cacheKey) {
    try {
      const hit = await caches.default.match(cacheKey);
      if (hit) {
        const cachedEnvelope = await hit.json();
        if (cachedEnvelope && typeof cachedEnvelope.validUntil === 'number' && Date.now() < cachedEnvelope.validUntil && cachedEnvelope.snapshot) {
          if (request.headers.get('If-None-Match') === cachedEnvelope.tag) {
            return new Response(null, { status: 304, headers: { ETag: cachedEnvelope.tag, 'Cache-Control': 'no-store' } });
          }
          return jsonNoStore({ ...cachedEnvelope.snapshot, serverTime: new Date().toISOString() }, 200, { ETag: cachedEnvelope.tag });
        }
      }
    } catch {}
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
  let snapshot;
  try {
    snapshot = getOrderingState(settings, Date.now());
  } catch {
    snapshot = { state: 'open', message: { en: '', ar: '' } };
  }
  // Conditional GET: unchanged polls answer 304 with no body, so the
  // 3 s / 5 s / 60 s scheduler cadence costs headers only. The client
  // echoes this tag (see fetchOrderingStatusVersioned); serverTime keeps
  // flowing on 200s only, while the Date header stays fresh on both.
  const tag = stableTag(snapshot);
  // Store the envelope for the next polls (best-effort: a cache failure
  // must never fail the request — the fresh body below is already built).
  if (cacheKey) {
    try {
      const envelope = {
        tag,
        snapshot,
        validUntil: snapshotValidUntilMs(snapshot, settings, Date.now()),
      };
      await caches.default.put(
        cacheKey,
        new Response(JSON.stringify(envelope), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
      );
    } catch {}
  }
  if (request.headers.get('If-None-Match') === tag) {
    return new Response(null, { status: 304, headers: { ETag: tag, 'Cache-Control': 'no-store' } });
  }
  return jsonNoStore({ ...snapshot, serverTime: new Date().toISOString() }, 200, { ETag: tag });
}

/**
 * Validity horizon for a snapshot: manual pause/resume/enabled/menu
 * writes purge the envelope instantly (purgeMenuCaches), but TIMED
 * flips (pausedUntil / reopensAt) happen with no write — so the envelope
 * must expire on or before the next scheduled flip. Falls back to a
 * short fixed TTL when nothing is scheduled.
 */
function snapshotValidUntilMs(snapshot, settings, nowMs) {
  let horizon = nowMs + SNAPSHOT_TTL_MS;
  try {
    const pausedUntilMs = settings && settings.ordering && settings.ordering.pausedUntil
      ? Date.parse(settings.ordering.pausedUntil) : NaN;
    if (Number.isFinite(pausedUntilMs) && pausedUntilMs > nowMs) horizon = Math.min(horizon, pausedUntilMs);
    const reopensAtMs = snapshot && snapshot.reopensAt ? Date.parse(snapshot.reopensAt) : NaN;
    if (Number.isFinite(reopensAtMs) && reopensAtMs > nowMs) horizon = Math.min(horizon, reopensAtMs);
  } catch {}
  return horizon;
}
