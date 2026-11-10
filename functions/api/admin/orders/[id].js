/**
 * Admin Order Status Endpoint: PATCH /api/admin/orders/<id>
 * Body {status} must be one of the five order statuses. Unknown id -> 404.
 */

import { checkApiHeaders, getSessionCookie, getSessionSecret, jsonNoStore, readJsonBody, verifySessionToken } from '../../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';
import { getRole } from '../../../_shared/access.js';
import {
  countActiveKitchenOrders,
  findOrderById,
  updateOrderStatus,
} from '../../../_shared/repositories/orders.repo.js';
import { orderDistanceKm, orderingEtaOrDefaults } from '../../../_shared/eta.js';
import { notifyOrderStatus } from '../../../_shared/push.js';
import { syncOrderStatusToTelegram } from '../../../_shared/telegram.js';

const STATUSES = ['new', 'confirmed', 'ready', 'completed', 'cancelled'];

export async function onRequest(context) {
  const { request, env, params } = context;

  if (!hasFeature(env, 'orderLogging')) return featureOffResponse();
  if (request.method !== 'PATCH') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'PATCH' });
  }

  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  const status = typeof body.status === 'string' ? body.status : '';
  if (!STATUSES.includes(status)) {
    return jsonNoStore({ error: 'invalid_status' }, 400);
  }

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  const id = params && typeof params.id === 'string' ? params.id : '';
  if (!id || id.length > 128) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  // Single edge-cached menu read for everything below (confirm-stamp inputs
  // AND the owner-push store name) — still exactly ONE KV read per call.
  let menu = null;
  try {
    const kv = env.MENU_KV || null;
    menu = kv ? await kv.get('menu', { type: 'json', cacheTtl: 300 }) : null;
  } catch {
    menu = null;
  }

  // Confirm stamping inputs (migration 0022): piggyback the menu + the
  // current row (both already needed) — no extra KV reads. The stamp itself
  // happens inside updateOrderStatus; absent/invalid inputs degrade to ETA
  // defaults + a live kitchen count (never blocks the status write).
  let confirmOpts;
  if (status === 'confirmed') {
    confirmOpts = {};
    try {
      const existing = await findOrderById(db, id);
      if (existing) {
        confirmOpts.settings = orderingEtaOrDefaults(menu && menu.settings ? menu.settings.ordering : null);
        confirmOpts.distanceKm = orderDistanceKm(existing, menu);
        confirmOpts.queueLen = await countActiveKitchenOrders(db);
      }
    } catch {
      confirmOpts = {};
    }
  }

  // Last-status actor (migration 0029): a kitchen/client change stamps
  // its login name, an owner change clears to NULL (Recent orders shows
  // nothing extra). Role source is the canonical getRole(); the username
  // is the session sub suffix `client:<username>`. Unknown sessions
  // (Cloudflare Access assertion, local dev) are the owner path -> clear.
  // Never blocks the write: on any failure the key is omitted and the
  // repository preserves the existing value.
  let updatedBy = null;
  let hasActor = true;
  try {
    const role = await getRole(request, env);
    if (role === 'kitchen' || role === 'client') {
      let username = '';
      try {
        const secret = getSessionSecret(env);
        const token = getSessionCookie(request);
        const payload = secret && token ? await verifySessionToken(secret, token) : null;
        const sub = payload && typeof payload.sub === 'string' ? payload.sub : '';
        if (sub.startsWith('client:')) username = sub.slice('client:'.length).trim();
      } catch {}
      updatedBy = username ? username.slice(0, 64) : role;
    } else {
      updatedBy = null;
    }
  } catch {
    hasActor = false;
  }
  const statusOpts = { ...(confirmOpts || {}) };
  if (hasActor) statusOpts.updatedBy = updatedBy;

  try {
    const order = await updateOrderStatus(db, id, status, statusOpts);
    if (!order) {
      return jsonNoStore({ error: 'not_found' }, 404);
    }
    // Owner -> customer loop: status change pushes subscribed devices.
    // Best-effort only (never delays or breaks the admin action); devices
    // subscribed with the order's tracking link, pruned when gone.
    if (order.trackToken && order.number) {
      const done = (async () => {
        let origin = '';
        try {
          origin = new URL(request.url).origin;
        } catch {}
        try {
          // Store name string only — reuses the menu fetched above (still
          // one KV read per admin call, edge-cached for minutes).
          let storeName = '';
          try {
            const nm = menu && menu.settings && menu.settings.name;
            storeName = typeof nm?.en === 'string' && nm.en ? nm.en : '';
          } catch {}
          await notifyOrderStatus(db, {
            storeName,
            orderId: id,
            orderNumber: order.number,
            status,
            orderType: order.type,
            lang: order.lang === 'ar' ? 'ar' : 'en',
            trackUrl: origin ? `${origin}/?track=${order.number}&t=${order.trackToken}` : '',
            subject: origin || undefined,
          });
        } catch {}
        // Two-way sync (site -> Telegram): stamp the same order message the
        // owner got at order time. Best-effort only — never delays or breaks
        // the admin action.
        try {
          const token = env.TELEGRAM_BOT_TOKEN || null;
          await syncOrderStatusToTelegram(db, token, {
            orderId: id,
            status,
            adminUrl: origin ? `${origin}/admin/dashboard` : '',
            env,
          });
        } catch {}
        // Customer email (confirmed/completed/cancelled): best-effort only.
        // 'ready' counts as 'confirmed' for the customer (no ready template).
        try {
          const map = { confirmed: 'confirmed', ready: 'confirmed', completed: 'completed', cancelled: 'cancelled' };
          const ev = map[status];
          if (ev && order && order.customer && typeof order.customer.email === 'string' && order.customer.email) {
            const { notifyCustomerOrderEvent } = await import('../../../_shared/customer-email.js');
            await notifyCustomerOrderEvent(db, env, { order, event: ev, origin });
          }
        } catch {}
      })();
      if (context.waitUntil) {
        try {
          context.waitUntil(done);
        } catch {}
      } else {
        await done;
      }
    }
    return jsonNoStore({ order });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
