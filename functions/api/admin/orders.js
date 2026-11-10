/**
 * Admin Orders Endpoint: GET /api/admin/orders?days=35&limit=1000
 * or GET /api/admin/orders?from=<ISO>&to=<ISO>&limit=2000
 * Behind the admin middleware (session or Cloudflare Access). Newest first.
 * Returns `cronHealth` (order-nag heartbeat: last run, stale/critical
 * flags on the server clock) for EVERYONE on the dashboard — owner and
 * client logins alike. It is an operational signal ("kitchen updates may
 * be stuck, orders could be piling up unseen"), not programmer internals,
 * so the banner it drives must reach whoever watches the orders feed.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import { cronHealthFromRow, countGraceHiddenOrders, getCronHeartbeat, isOrderInGrace, listOrdersByWindow, ORDER_GRACE_MS, cancelWindowMsFromMenu, ORDER_NAG_SERVICE } from '../../_shared/repositories/orders.repo.js';

function parseISO(v) {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!hasFeature(env, 'orderLogging')) return featureOffResponse();
  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable', message: 'Orders database not configured' }, 503);
  }

  const url = new URL(request.url);
  const limitRaw = parseInt(url.searchParams.get('limit') || '1000', 10);
  const limit = Number.isInteger(limitRaw) ? Math.min(2000, Math.max(1, limitRaw)) : 1000;

  // Explicit window (used by the dashboard: from = first day of the
  // previous month in the business timezone so Today / 7 days / This month
  // / Last month all work). Falls back to the legacy days= window.
  // Validation stays in the route; SQL templates live in the repository.
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  let window;
  if (fromParam !== null || toParam !== null) {
    const from = parseISO(fromParam);
    const to = toParam === null ? new Date().toISOString() : parseISO(toParam);
    if (!from || !to || from >= to) {
      return jsonNoStore({ error: 'bad_request', message: 'Invalid from/to window' }, 400);
    }
    window = { from, to };
  } else {
    const daysRaw = parseInt(url.searchParams.get('days') || '35', 10);
    const days = Number.isInteger(daysRaw) ? Math.min(365, Math.max(1, daysRaw)) : 35;
    window = { days };
  }

  let orders;
  try {
    orders = await listOrdersByWindow(db, window, limit);
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Kitchen grace period: a `new` order younger than the owner-tuned
  // cancel window (default 5 minutes) stays hidden (the customer may still
  // self-cancel). Cancelled orders are never hidden — the owner sees the
  // cancellation at once. The window is read from the saved menu (KV) like
  // the other routes, with the constant as fallback.
  const nowMs = Date.now();
  let graceMs = ORDER_GRACE_MS;
  try {
    const kv = env.MENU_KV || null;
    const menu = kv ? await kv.get('menu', { type: 'json', cacheTtl: 60 }) : null;
    graceMs = cancelWindowMsFromMenu(menu);
  } catch {
    graceMs = ORDER_GRACE_MS;
  }
  try {
    if (Array.isArray(orders)) {
      orders = orders.filter((o) => !isOrderInGrace(o && o.status, o && o.createdAt, nowMs, graceMs));
    }
  } catch {}

  // Pipeline visibility (count only, no PII): how many `new` orders are
  // inside the grace window right now, so a quiet board reads as "calm",
  // not "cron dead" (the heartbeat banner covers the dead case).
  let graceHidden = 0;
  try {
    graceHidden = await countGraceHiddenOrders(db, new Date(nowMs - graceMs).toISOString());
  } catch {
    graceHidden = 0;
  }

  // Cron health (D1 heartbeat row, one cheap indexed read) for everyone
  // watching the dashboard: owner and client logins alike. Never fails
  // the orders payload; a missing row reports neverRan.
  let cronHealth = null;
  try {
    cronHealth = cronHealthFromRow(await getCronHeartbeat(db, ORDER_NAG_SERVICE), Date.now());
  } catch {
    cronHealth = cronHealthFromRow(null, Date.now());
  }

  return jsonNoStore({ orders, cronHealth, graceHidden });
}
