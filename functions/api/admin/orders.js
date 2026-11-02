/**
 * Admin Orders Endpoint: GET /api/admin/orders?days=35&limit=1000
 * or GET /api/admin/orders?from=<ISO>&to=<ISO>&limit=2000
 * Behind the admin middleware (session or Cloudflare Access). Newest first.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import { isOrderInGrace, listOrdersByWindow } from '../../_shared/repositories/orders.repo.js';

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

  // Kitchen grace period: a `new` order younger than 5 minutes stays
  // hidden (the customer may still self-cancel). Cancelled orders are
  // never hidden — the owner sees the cancellation at once.
  try {
    const now = Date.now();
    if (Array.isArray(orders)) {
      orders = orders.filter((o) => !isOrderInGrace(o && o.status, o && o.createdAt, now));
    }
  } catch {}

  return jsonNoStore({ orders });
}
