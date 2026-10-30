/**
 * POST /api/internal/order-nag — 1-minute kitchen nag (called by an external
 * free cron, NOT by browsers).
 *
 * Auth: `Authorization: Bearer <secret>` where the secret lives in the
 * service_secrets D1 table (key 'order-nag'). Constant-time compare; wrong
 * or missing secret answers 404 so the route is indistinguishable from a
 * missing one (same convention as run-reports).
 *
 * Effect: re-pushes unacknowledged orders (status new, 1–30 min old) with
 * their stable tag — a closed phone re-blips every minute until the owner
 * acks, instead of staying silent after the first ping. Best-effort only.
 */
import { jsonNoStore, readJsonBody, safeCompareStrings } from '../../_shared/session.js';
import { nagUnackedOrders } from '../../_shared/push.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return jsonNoStore({ error: 'not_found' }, 404);

  const db = env.ORDERS_DB || null;
  const kv = env.MENU_KV || null;
  if (!db) return jsonNoStore({ error: 'not_found' }, 404);

  let want = '';
  try {
    const row = await db
      .prepare('SELECT secret FROM service_secrets WHERE key = ?1')
      .bind('order-nag')
      .first();
    want = row && typeof row.secret === 'string' ? row.secret : '';
  } catch {
    return jsonNoStore({ error: 'not_found' }, 404);
  }
  const auth = request.headers.get('Authorization') || '';
  const got = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  let ok = false;
  try {
    ok = !!want && !!got && (await safeCompareStrings(got, want));
  } catch {
    ok = false;
  }
  if (!ok) return jsonNoStore({ error: 'not_found' }, 404);

  // Drain a body if the caller sends one (some crons POST empty forms).
  try {
    await readJsonBody(request, 1024);
  } catch {}

  let origin = '';
  try {
    origin = new URL(request.url).origin;
  } catch {}
  let storeName = '';
  let cur = '';
  try {
    const menu = kv ? await kv.get('menu', { type: 'json' }) : null;
    const nm = menu?.settings?.name;
    storeName = nm && typeof nm === 'object' ? String(nm.en || nm.ar || '') : '';
    const currency = menu?.settings?.currency;
    cur = currency && typeof currency === 'object' ? String(currency.en || currency.ar || '') : '';
  } catch {}

  try {
    const out = await nagUnackedOrders(db, {
      storeName,
      currency: cur,
      adminUrl: origin ? `${origin}/admin` : '',
      subject: origin || undefined,
    });
    return jsonNoStore({ ok: true, nagged: out.nagged });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
