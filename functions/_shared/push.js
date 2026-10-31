/**
 * Order-status push (Web Push / VAPID) — zero vendors, zero cost, legal by
 * construction (the customer taps "notify me": explicit opt-in per device).
 *
 * Sends run on Cloudflare Workers via @mmmike/web-push (fetch + WebCrypto).
 * The classic `web-push` npm lib needs node:crypto/node:https and CANNOT run
 * on Workers — do not swap it back in. (@portable/web-push is an empty
 * name-reservation stub — also unusable.)
 *
 * The VAPID pair is generated lazily once into push_settings (migration
 * 0009): zero dashboard env vars, zero setup. INSERT OR IGNORE + re-read
 * keeps concurrent first-calls on the same keypair.
 */
import { generateVapidKeys } from '@mmmike/web-push/vapid';
import { sendPushNotification } from '@mmmike/web-push/send';

/** 128-bit tracking token (also used for /api/track gating). */
export function newTrackToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Browser subscription shape check (shared by customer + admin endpoints).
 * Accepts standard base64 AND base64url (browsers hand either). Returns the
 * cleaned triple, or { field, got } naming the FIRST failing field with its
 * received length (never values — safe to surface to the UI for support).
 */
export function validatePushSub(body) {
  const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  const p256dh = body && typeof body.p256dh === 'string' ? body.p256dh.trim() : '';
  const auth = body && typeof body.auth === 'string' ? body.auth.trim() : '';
  if (!endpoint.startsWith('https://') || endpoint.length > 512) {
    return { ok: false, field: 'endpoint', got: endpoint.length };
  }
  // Standard base64 (+/=) and base64url (-_) both accepted: specs say
  // browsers hand standard, but tolerance here rescues legit users and
  // costs attackers nothing (fixed-shape opaque blobs, bound params only).
  if (!/^[A-Za-z0-9_\-+\/=]{20,120}$/.test(p256dh)) {
    return { ok: false, field: 'p256dh', got: p256dh.length };
  }
  if (!/^[A-Za-z0-9_\-+\/=]{10,60}$/.test(auth)) {
    return { ok: false, field: 'auth', got: auth.length };
  }
  return { ok: true, endpoint, p256dh, auth };
}

function isValidKey(s) {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{20,120}$/.test(s);
}

/**
 * Lazily-created singleton VAPID settings. Subject is set once (site origin
 * recommended: push services must be able to contact it).
 */
export async function getVapidSettings(db, subject) {
  const read = async () => {
    try {
      return await db
        .prepare('SELECT public_key, private_key, subject FROM push_settings WHERE id = 1')
        .first();
    } catch {
      return null;
    }
  };
  const existing = await read();
  if (existing && isValidKey(existing.public_key) && isValidKey(existing.private_key)) {
    return existing;
  }
  let pair = null;
  try {
    pair = await generateVapidKeys();
  } catch {
    return null;
  }
  if (!pair || !isValidKey(pair.publicKey) || !isValidKey(pair.privateKey)) return null;
  const subj = typeof subject === 'string' && subject ? subject.slice(0, 120) : 'mailto:push@localhost';
  try {
    await db
      .prepare(
        'INSERT OR IGNORE INTO push_settings (id, public_key, private_key, subject, created_at) VALUES (1, ?1, ?2, ?3, ?4)'
      )
      .bind(pair.publicKey, pair.privateKey, subj, new Date().toISOString())
      .run();
  } catch {}
  const fresh = await read();
  if (fresh && isValidKey(fresh.public_key) && isValidKey(fresh.private_key)) return fresh;
  return { public_key: pair.publicKey, private_key: pair.privateKey, subject: subj };
}

const STATUS_COPY = {
  confirmed: {
    ar: (n) => `طلبك #${n} قيد التحضير 👨‍🍳`,
    en: (n) => `Order #${n} is being prepared`,
  },
  completed: {
    ar: (n) => `طلب #${n} جاهز! 🎉`,
    en: (n) => `Order #${n} is ready! 🎉`,
  },
  cancelled: {
    ar: (n) => `طلب #${n} اتلغى — كلمنا لو في سؤال`,
    en: (n) => `Order #${n} was cancelled — call us`,
  },
};

/**
 * Best-effort push to every device subscribed to an order. Only
 * confirmed/completed/cancelled notify (a "new" order IS the customer's own
 * send). Gone subscriptions (404/410) are pruned; every other failure is
 * swallowed — notification must never break the admin action.
 */export async function notifyOrderStatus(db, { storeName, orderId, orderNumber, status, lang, trackUrl, subject }) {
  const copy = STATUS_COPY[status];
  if (!copy || !orderId) return { sent: 0 };
  const useAr = lang === 'ar';
  const title = typeof storeName === 'string' && storeName ? storeName : useAr ? 'طلبك' : 'Your order';

  let subs = [];
  try {
    const res = await db
      .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE order_id = ?1')
      .bind(orderId)
      .all();
    subs = (res && res.results) || [];
  } catch {
    return { sent: 0 };
  }
  if (!subs.length) return { sent: 0 };

  const vapid = await getVapidSettings(db, subject);
  if (!vapid) return { sent: 0 };

  let sent = 0;
  for (const s of subs) {
    if (!s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://')) continue;
    try {
      const delivered = await sendPushNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        { title, body: copy[useAr ? 'ar' : 'en'](orderNumber), url: trackUrl },
        { publicKey: vapid.public_key, privateKey: vapid.private_key, subject: vapid.subject }
      );
      if (delivered === false) {
        try {
          await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(s.endpoint).run();
        } catch {}
      } else {
        sent += 1;
      }
    } catch {
      // Transient push-service failure: keep the subscription for next time.
    }
  }
  return { sent };
}

function fmtMoney(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.round(v).toLocaleString('en-US');
}

/**
 * Kitchen loop (owner side): a freshly stored order notifies EVERY admin-
 * subscribed device. Payload is deliberately PII-free (number + total only —
 * names/phones/addresses open behind the admin login after the tap).
 * Same best-effort contract: never breaks order creation.
 * `tag` groups re-pushes into ONE persistent notification (with renotify the
 * OS re-blips instead of stacking) — the nag job reuses it every minute
 * until the order is acknowledged.
 */
export async function notifyNewOrder(db, { storeName, orderNumber, total, currency, adminUrl, subject, tag, repeat = 1 }) {
  if (!Number.isInteger(orderNumber) || orderNumber <= 0) return { sent: 0 };

  let subs = [];
  try {
    const res = await db
      .prepare('SELECT endpoint, p256dh, auth FROM admin_push_subscriptions')
      .all();
    subs = (res && res.results) || [];
  } catch {
    return { sent: 0 };
  }
  if (!subs.length) return { sent: 0 };

  const vapid = await getVapidSettings(db, subject);
  if (!vapid) return { sent: 0 };

  const title = typeof storeName === 'string' && storeName ? storeName : 'New order';
  const money = currency ? ` · ${fmtMoney(total)} ${currency}` : '';
  const body = `🔔 طلب جديد #${orderNumber}${money} · New order`;
  const payload = { title, body, url: adminUrl };
  if (typeof tag === 'string' && tag) payload.tag = tag.slice(0, 64);

  // Burst mode (nag path): the same notification re-fired N times back to
  // back with renotify = N blips inside seconds instead of one — the closest
  // a closed phone gets to a ringing alarm. Clamped 1..5; default single.
  const bursts = Math.min(Math.max(Number.parseInt(repeat, 10) || 1, 1), 5);
  let sent = 0;
  for (let r = 0; r < bursts; r++) {
  for (const s of subs) {
    if (!s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://')) continue;
    try {
      const delivered = await sendPushNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { publicKey: vapid.public_key, privateKey: vapid.private_key, subject: vapid.subject }
      );
      if (delivered === false) {
        try {
          await db.prepare('DELETE FROM admin_push_subscriptions WHERE endpoint = ?1').bind(s.endpoint).run();
        } catch {}
      } else {
        sent += 1;
      }
    } catch {
      // Transient push-service failure: keep the subscription for next time.
    }
  }
  }
  return { sent };
}

/**
 * Nag pass (called every minute by the external cron): re-pushes every
 * UNACKNOWLEDGED order (status new, 1–30 min old) with its stable tag, so a
 * closed phone re-blips instead of staying silent. Ack/cancel/completion
 * flips the status and the nagging stops by itself; past-30-min orders age
 * out (the kitchen missed them — no infinite nagging).
 */
export async function nagUnackedOrders(db, { storeName, currency, adminUrl, subject }) {
  let rows = [];
  try {
    const now = Date.now();
    const from = new Date(now - 30 * 60 * 1000).toISOString();
    const to = new Date(now - 60 * 1000).toISOString();
    const res = await db
      .prepare(
        "SELECT number, total FROM orders WHERE status = 'new' AND created_at >= ?1 AND created_at <= ?2 ORDER BY created_at ASC LIMIT 20"
      )
      .bind(from, to)
      .all();
    rows = (res && res.results) || [];
  } catch {
    return { nagged: 0 };
  }
  let nagged = 0;
  for (const r of rows) {
    if (!r || !Number.isInteger(r.number)) continue;
    try {
      const out = await notifyNewOrder(db, {
        storeName,
        orderNumber: r.number,
        total: r.total,
        currency,
        adminUrl,
        subject,
        tag: `new-order-${r.number}`,
        repeat: 3,
      });
      if (out.sent > 0) nagged += 1;
    } catch {}
  }
  return { nagged };
}
