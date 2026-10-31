/**
 * Public Order Endpoint: POST /api/orders
 * Records a customer order. Prices/names always come from the live menu —
 * client-supplied totals are ignored. Never reads or modifies existing orders
 * except through the idempotency key.
 */

import { jsonNoStore, readJsonBody } from '../_shared/session.js';
import { mapOrderRow, validateOrderInput } from '../_shared/orders.js';
import { newTrackToken, notifyNewOrder } from '../_shared/push.js';
import { notifyNewOrderTelegram } from '../_shared/telegram.js';
import {
  WA_CONFIG_KEY,
  WA_TOKEN_KEY,
  buildCustomerParams,
  buildOwnerParams,
  checkCap,
  incrCap,
  isCompleteConfig,
  sanitizeWaConfig,
  sendTemplate,
  toApiPhone,
} from '../_shared/whatsapp-api.js';
import { findOrderById, findOrderByIdemKey, insertOrderWithNumber, markOrderSentVia, nextOrderNumber } from '../_shared/repositories/orders.repo.js';
import { getOrderingState } from '../_shared/status.js';

const MAX_BODY_BYTES = 8 * 1024;
const RATE_PREFIX = 'order:ip:';
const RATE_TTL_SEC = 10 * 60;
// Human bursts welcome (family + guests ordering together), bots capped:
// 15 distinct orders per 10 minutes per IP. Same-key retries never consume
// budget (a retry is not a new order — the dedupe returns the stored row).
const RATE_MAX = 15;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  let reqOrigin;
  try {
    reqOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (!origin) return false;
  const sameHost = (h) => h === 'localhost' || h === '127.0.0.1';
  let originHost;
  let reqHost;
  try {
    originHost = new URL(origin).hostname;
    reqHost = new URL(reqOrigin).hostname;
  } catch {
    return false;
  }
  const local = sameHost(originHost) && sameHost(reqHost);
  return origin === reqOrigin || local;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  if (!checkOrigin(request)) {
    return jsonNoStore({ error: 'forbidden' }, 403);
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  // Honeypot: bots fill it, humans never see it. Fake success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return jsonNoStore({ ok: true });
  }

  const kv = env.MENU_KV || null;
  const db = env.ORDERS_DB || null;
  if (!kv || !db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Load the live menu (prices/names come only from here)
  let menu = null;
  try {
    menu = await kv.get('menu', { type: 'json' });
  } catch {}
  if (!menu || !Array.isArray(menu.items)) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Availability is evaluated FIRST from the live menu at submit time, so
  // the answer is always 403 {error:'paused'|'closed'|'disabled', message}.
  // Client-sent state is ignored. Not open -> no order is recorded.
  let orderingState = { state: 'open' };
  try {
    orderingState = getOrderingState((menu && menu.settings) || {}, Date.now());
  } catch {}
  if (orderingState.state !== 'open') {
    return jsonNoStore({ error: orderingState.state, message: orderingState.message || { en: '', ar: '' } }, 403);
  }

  const checked = validateOrderInput(body, menu);
  if (!checked.ok) {
    const code = (checked.errors && checked.errors[0]) || 'invalid';
    if (code === 'min_order') {
      const out = { error: code };
      if (typeof checked.minOrder === 'number') out.minOrder = checked.minOrder;
      return jsonNoStore(out, 400);
    }
    return jsonNoStore({ error: code }, 400);
  }
  const c = checked.cleaned;
  // Tracking token: minted once per logical order (retries reuse the stored
  // row's token below), gates the public /api/track page. No PII in it.
  c.trackToken = newTrackToken();

  // Rate limit: 15 orders per 10 minutes per IP
  const ip = clientIp(request);
  const nowSec = Math.floor(Date.now() / 1000);
  let used = 0;
  let windowReset = nowSec + RATE_TTL_SEC;
  try {
    const raw = await kv.get(RATE_PREFIX + ip);
    if (raw) {
      const state = JSON.parse(raw);
      if (state && typeof state.n === 'number' && typeof state.reset === 'number' && nowSec < state.reset) {
        used = state.n;
        windowReset = state.reset;
      }
    }
  } catch {}
  if (used >= RATE_MAX) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }

  // Idempotency: a repeated key returns the original order (stored totals, not
  // freshly computed ones — the menu may have changed since the first insert).
  // sentVia replays the ORIGINAL channel so a retry never double-contacts
  // (API message + wa.me draft for one order).
  const sentViaOf = (existing) => (existing && existing.sent_via === 'api' ? 'api' : 'wa');
  if (c.idemKey) {
    try {
      const existing = await findOrderByIdemKey(db, c.idemKey);
      if (existing && typeof existing.number === 'number') {
        return jsonNoStore({
          ok: true,
          orderNumber: existing.number,
          total: typeof existing.total === 'number' ? existing.total : c.total,
          trackToken: typeof existing.track_token === 'string' ? existing.track_token : null,
          sentVia: sentViaOf(existing),
        });
      }
    } catch {}
  }

  // One timestamp per request (verbatim original: created_at/updated_at identical, even on retry).
  const nowIso = new Date().toISOString();
  const insertWithNumber = async (num) => insertOrderWithNumber(db, c, num, nowIso);

  // Order numbers come from the atomic order_counter (UPDATE ... RETURNING):
  // no read-modify-write, no conflict retry needed. Numbers stay sequential
  // per DB (first order = 1001 via the migration seed).
  let created = null;
  try {
    const next = await nextOrderNumber(db);
    created = await insertWithNumber(next);
  } catch {
    created = null;
    if (c.idemKey) {
      try {
        const existing = await findOrderByIdemKey(db, c.idemKey);
        if (existing && typeof existing.number === 'number') {
          return jsonNoStore({
            ok: true,
            orderNumber: existing.number,
            total: typeof existing.total === 'number' ? existing.total : c.total,
            trackToken: typeof existing.track_token === 'string' ? existing.track_token : null,
            sentVia: sentViaOf(existing),
          });
        }
      } catch {}
    }
  }
  if (!created) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Cloud API path (only when fully configured): the SITE delivers the order
  // over WhatsApp itself, so the client must NOT open wa.me (sentVia tells
  // it). Awaited inline — the client decision depends on it — with tight
  // timeouts; any failure falls back to wa.me ('wa'). Owner first (gates
  // 'api'), customer confirmation second (opt-in only), each capped.
  let sentVia = 'wa';
  try {
    let cfgRaw = null;
    let token = '';
    try {
      const cfgRow = await db
        .prepare('SELECT value FROM service_config WHERE key = ?1')
        .bind(WA_CONFIG_KEY)
        .first();
      cfgRaw = cfgRow && typeof cfgRow.value === 'string' ? JSON.parse(cfgRow.value) : {};
      const tokRow = await db
        .prepare('SELECT secret FROM service_secrets WHERE key = ?1')
        .bind(WA_TOKEN_KEY)
        .first();
      token = tokRow && typeof tokRow.secret === 'string' ? tokRow.secret : '';
    } catch {}
    const { config: waCfg } = sanitizeWaConfig(cfgRaw || {});
    if (token && isCompleteConfig(waCfg)) {
      const cap = await checkCap(kv, waCfg.dailyCap);
      if (cap.allowed) {
        let origin = '';
        try {
          origin = new URL(request.url).origin;
        } catch {}
        const currency = menu?.settings?.currency;
        const cur = currency && typeof currency === 'object'
          ? String(currency.en || currency.ar || '') : '';
        const nm = menu?.settings?.name;
        const storeName = nm && typeof nm === 'object' ? String(nm.en || nm.ar || '') : '';
        const owner = await sendTemplate({
          token,
          phoneNumberId: waCfg.phoneNumberId,
          to: waCfg.ownerRecipient,
          templateName: waCfg.ownerTemplate,
          params: buildOwnerParams({
            number: created.num,
            items: c.items,
            total: c.total,
            currency: cur,
            name: c.name,
            phone: c.phone,
          }),
          timeoutMs: 8000,
        });
        if (owner.ok) {
          await incrCap(kv);
          sentVia = 'api';
          await markOrderSentVia(db, created.id, 'api');
          if (waCfg.customerUpdates && c.whatsappUpdates && c.phone) {
            const to = toApiPhone(c.phone);
            if (to && waCfg.customerTemplate) {
              const cu = await sendTemplate({
                token,
                phoneNumberId: waCfg.phoneNumberId,
                to,
                templateName: waCfg.customerTemplate,
                params: buildCustomerParams({
                  number: created.num,
                  total: c.total,
                  currency: cur,
                  storeName,
                  trackUrl: origin && c.trackToken ? `${origin}/?track=${created.num}&t=${c.trackToken}` : '',
                }),
                timeoutMs: 8000,
              });
              if (cu.ok) await incrCap(kv);
            }
          }
        }
      }
    }
  } catch {}

  // Bookkeeping (never blocks the response). Retention lives in the daily
  // /api/internal/run-reports job now — never here.
  const after = (async () => {
    try {
      await kv.put(
        RATE_PREFIX + ip,
        JSON.stringify({ n: used + 1, reset: windowReset }),
        { expirationTtl: RATE_TTL_SEC }
      );
    } catch {}
    // Kitchen loop (owner side): a stored order pushes every admin-
    // subscribed device. Best-effort only — push failure never touches the
    // order or the customer response (payload: number + total, no PII).
    try {
      let origin = '';
      try {
        origin = new URL(request.url).origin;
      } catch {}
      const currency = menu?.settings?.currency;
      const cur = currency && typeof currency === 'object'
        ? String(currency.en || currency.ar || '') : '';
      const nm = menu?.settings?.name;
      const storeName = nm && typeof nm === 'object' ? String(nm.en || nm.ar || '') : '';
      await notifyNewOrder(db, {
        storeName,
        orderNumber: created.num,
        total: c.total,
        currency: cur,
        adminUrl: origin ? `${origin}/admin` : '',
        subject: origin || undefined,
        tag: `new-order-${created.num}`,
      });
    } catch {}
    // Telegram owner loop: same best-effort contract — runs AFTER the
    // order row is committed, inside waitUntil, never touches the order
    // or the customer response. Deduped via the telegram_notifications
    // ledger (Phase 4: View-button only, no Accept/Reject yet).
    try {
      const token = env.TELEGRAM_BOT_TOKEN || null;
      let origin = '';
      try {
        origin = new URL(request.url).origin;
      } catch {}
      const currency = menu?.settings?.currency;
      const cur = currency && typeof currency === 'object'
        ? String(currency.en || currency.ar || '') : '';
      const nm = menu?.settings?.name;
      const storeName = nm && typeof nm === 'object' ? String(nm.en || nm.ar || '') : '';
      await notifyNewOrderTelegram(db, token, {
        orderId: created.id,
        orderNumber: created.num,
        cleaned: c,
        storeName,
        currency: cur,
        adminUrl: origin ? `${origin}/admin/dashboard` : '',
      });
    } catch {}
  })();
  if (context.waitUntil) {
    try {
      context.waitUntil(after);
    } catch {}
  } else {
    await after;
  }

  // Fetch the stored row back so the response reflects exactly what was saved
  let savedTotal = c.total;
  try {
    const row = await findOrderById(db, created.id);
    if (row) savedTotal = mapOrderRow(row).total;
  } catch {}
  return jsonNoStore({ ok: true, orderNumber: created.num, total: savedTotal, trackToken: c.trackToken, sentVia });
}
