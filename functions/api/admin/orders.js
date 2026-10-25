/**
 * Admin Orders Endpoint: GET /api/admin/orders?days=35&limit=1000
 * Behind the admin middleware (session or Cloudflare Access). Newest first.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { mapOrderRow } from '../../_shared/orders.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable', message: 'Orders database not configured' }, 503);
  }

  const url = new URL(request.url);
  const daysRaw = parseInt(url.searchParams.get('days') || '35', 10);
  const days = Number.isInteger(daysRaw) ? Math.min(365, Math.max(1, daysRaw)) : 35;
  const limitRaw = parseInt(url.searchParams.get('limit') || '1000', 10);
  const limit = Number.isInteger(limitRaw) ? Math.min(2000, Math.max(1, limitRaw)) : 1000;

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  let rows = [];
  try {
    const res = await db
      .prepare('SELECT * FROM orders WHERE created_at >= ?1 ORDER BY created_at DESC LIMIT ?2')
      .bind(cutoff, limit)
      .all();
    rows = (res && res.results) || [];
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  return jsonNoStore({ orders: rows.map(mapOrderRow) });
}
