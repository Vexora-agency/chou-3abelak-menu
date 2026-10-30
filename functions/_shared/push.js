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
    ar: (n) => `طلب #${n} اتأكد وبيتجهز 🔥`,
    en: (n) => `Order #${n} confirmed — we are on it 🔥`,
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
 */
export async function notifyOrderStatus(db, { storeName, orderId, orderNumber, status, lang, trackUrl, subject }) {
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
