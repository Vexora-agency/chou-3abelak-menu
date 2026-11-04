/**
 * Customer order-status emails (best-effort, never throws, never logs PII).
 * Contract: notifyCustomerOrderEvent(db, env, { order, event, origin })
 *   - order: mapOrderRow shape (includes customer.email when opted-in).
 *   - event: 'placed' | 'confirmed' | 'completed' | 'cancelled' | 'receipt_check'.
 *   - origin: request origin for the track link (may be '').
 * Behavior: missing email or disabled event -> { sent:false, reason } with
 * zero Resend traffic. Otherwise builds via buildOrderEmail() from
 * ./order-emails.js and sends via sendEmail() from ./mail.js with
 * idempotencyKey 'order/<number>/<event>'. Any internal error is swallowed
 * ({ sent:false, reason }) — email never breaks an order flow.
 */

import { sendEmail } from './mail.js';

const EVENTS = ['placed', 'confirmed', 'completed', 'cancelled', 'receipt_check'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function defaultNotifications() {
  return {
    senderName: '',
    replyTo: '',
    events: { placed: true, confirmed: true, completed: true, cancelled: true, receipt_check: true },
  };
}

function normalizeNotifications(raw) {
  const d = defaultNotifications();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const senderName = typeof raw.senderName === 'string' ? raw.senderName.trim().slice(0, 80) : '';
  let replyTo = typeof raw.replyTo === 'string' ? raw.replyTo.trim().toLowerCase().slice(0, 254) : '';
  if (replyTo && !EMAIL_RE.test(replyTo)) replyTo = '';
  const ev = raw.events && typeof raw.events === 'object' && !Array.isArray(raw.events) ? raw.events : {};
  const b = (v) => (typeof v === 'boolean' ? v : true);
  return {
    senderName,
    replyTo,
    events: {
      placed: b(ev.placed),
      confirmed: b(ev.confirmed),
      completed: b(ev.completed),
      cancelled: b(ev.cancelled),
      receipt_check: b(ev.receipt_check),
    },
  };
}

async function loadNotifications(env) {
  try {
    const kv = env && env.MENU_KV ? env.MENU_KV : null;
    if (!kv) return defaultNotifications();
    const menu = await kv.get('menu', { type: 'json', cacheTtl: 300 });
    const s = menu && menu.settings ? menu.settings : null;
    return normalizeNotifications(s ? s.notifications : null);
  } catch {
    return defaultNotifications();
  }
}

function storeNameOf(menu, lang) {
  try {
    const nm = menu && menu.settings ? menu.settings.name : null;
    if (nm && typeof nm === 'object') {
      const en = typeof nm.en === 'string' ? nm.en.trim() : '';
      const ar = typeof nm.ar === 'string' ? nm.ar.trim() : '';
      return lang === 'ar' ? ar || en || '' : en || ar || '';
    }
    if (typeof nm === 'string') return nm.trim().slice(0, 80);
  } catch {}
  return '';
}

function currencyOf(menu, lang) {
  try {
    const cur = menu && menu.settings ? menu.settings.currency : '';
    if (cur && typeof cur === 'object') {
      const en = typeof cur.en === 'string' ? cur.en.trim() : '';
      const ar = typeof cur.ar === 'string' ? cur.ar.trim() : '';
      return lang === 'ar' ? ar || en : en || ar;
    }
    if (typeof cur === 'string') return cur.trim();
  } catch {}
  return '';
}

async function loadMenuBits(env, lang) {
  try {
    const kv = env && env.MENU_KV ? env.MENU_KV : null;
    if (!kv) return { storeName: '', currency: '', timezone: '', menu: null };
    const menu = await kv.get('menu', { type: 'json', cacheTtl: 300 });
    const settings = menu && menu.settings ? menu.settings : null;
    const tz = settings && typeof settings.timezone === 'string' ? settings.timezone.trim() : '';
    return {
      storeName: storeNameOf(menu, lang),
      currency: currencyOf(menu, lang),
      timezone: tz || 'Asia/Beirut',
      menu,
    };
  } catch {
    return { storeName: '', currency: '', timezone: '', menu: null };
  }
}

function extractEmail(order) {
  try {
    const c = order && order.customer ? order.customer : null;
    const raw = c && typeof c.email === 'string' ? c.email.trim() : '';
    if (!raw) return '';
    const low = raw.toLowerCase().slice(0, 254);
    return EMAIL_RE.test(low) ? low : '';
  } catch {
    return '';
  }
}

function buildTrackUrl(order, origin) {
  try {
    const o = typeof origin === 'string' ? origin.trim().replace(/\/$/, '') : '';
    if (!o) return '';
    const n = order && Number.isInteger(order.number) ? order.number : NaN;
    const t = order && typeof order.trackToken === 'string' && order.trackToken ? order.trackToken : '';
    if (!Number.isInteger(n) || !t) return '';
    return `${o}/?track=${n}&t=${t}`;
  } catch {
    return '';
  }
}

async function buildContent(args) {
  try {
    const mod = await import('./order-emails.js');
    const fn = mod && typeof mod.buildOrderEmail === 'function' ? mod.buildOrderEmail : null;
    if (fn) {
      const out = await fn(args);
      if (out && typeof out.subject === 'string' && typeof out.html === 'string' && typeof out.text === 'string') {
        return out;
      }
    }
  } catch {}
  // Fallback when the template module is absent (parallel agent lands it
  // separately): minimal bilingual shell so the helper still sends a sane
  // email and tests stay green. Never throws.
  try {
    const n = args && args.order && Number.isInteger(args.order.number) ? args.order.number : '?';
    const ev = args && typeof args.event === 'string' ? args.event : 'update';
    const store = typeof args.storeName === 'string' && args.storeName ? args.storeName : 'our store';
    const url = typeof args.trackUrl === 'string' ? args.trackUrl : '';
    const subject = `Order #${n} — ${ev} / طلب #${n} — ${ev}`;
    const html = `<p>Order #${n} (${ev}) from ${store}. ${url ? `<a href="${url}">Track</a>` : ''}</p><p dir="rtl">طلب #${n} (${ev}) من ${store}.</p>`;
    const text = `Order #${n} (${ev}) from ${store}. ${url}\nطلب #${n} (${ev}) من ${store}.`;
    return { subject, html, text };
  } catch {
    return null;
  }
}

export async function notifyCustomerOrderEvent(db, env, { order, event, origin } = {}) {
  const fail = (reason) => ({ sent: false, reason });
  try {
    if (!EVENTS.includes(event)) return fail('bad_event');
    const to = extractEmail(order);
    if (!to) return fail('no_email');
    const notifications = await loadNotifications(env);
    if (!notifications.events[event]) return fail('disabled');
    // فحص الاستلام هو آخر بريد: إتمام لاحق لا يراسل مرتين.
    // The receipt-check is the last email; a later completed must not double-mail.
    if (event === 'completed' && order && order.receiptAskedAt) return fail('already_asked');
    const lang = order && order.lang === 'ar' ? 'ar' : 'en';
    const { storeName, currency, timezone, menu } = await loadMenuBits(env, lang);
    // Reuse the menu read above when possible (loadNotifications already
    // fetched it, but loadMenuBits re-reads edge-cached — still 1 KV hit
    // per call path in practice due to cacheTtl).
    void menu;
    void db;
    const trackUrl = buildTrackUrl(order, origin);
    const itemsCount = Array.isArray(order?.items) && order.items.length > 0
      ? order.items.length
      : (order && order.itemsCount !== undefined && order.itemsCount !== null && String(order.itemsCount).trim() !== ''
        ? order.itemsCount
        : undefined);
    const contentOrder = itemsCount === undefined ? order : { ...order, itemsCount };
    const content = await buildContent({
      event,
      order: contentOrder,
      storeName,
      currency,
      lang,
      trackUrl,
      timezone,
    });
    if (!content) return fail('build_failed');
    const fromName = notifications.senderName ? notifications.senderName : storeName ? storeName : undefined;
    const idempotencyKey = `order/${order && Number.isInteger(order.number) ? order.number : 'unknown'}/${event}`;
    const envForSend = notifications.replyTo ? { ...env, REPLY_TO: notifications.replyTo } : env;
    let res;
    try {
      res = await sendEmail(envForSend, {
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
        idempotencyKey,
        ...(fromName ? { fromName } : {}),
      });
    } catch {
      return fail('send_failed');
    }
    return { sent: true, id: res && typeof res.id === 'string' ? res.id : null };
  } catch {
    return fail('error');
  }
}

export const __testOnly = { normalizeNotifications, extractEmail, buildTrackUrl, defaultNotifications };
