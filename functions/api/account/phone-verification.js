/**
 * POST/GET /api/account/phone-verification
 *
 * Reverse WhatsApp verification for the signed-in member's number.
 *
 * POST { phone } mints a 6-digit code for that exact number and returns it
 * ONCE (only a keyed hash is stored). The member sends the code from their
 * WhatsApp to the restaurant; the owner approves the matching pending row in
 * the dashboard. GET ?phone= reports the current state for the checkout UI.
 *
 * Every request is session-gated and CSRF-gated. The user id always comes
 * from the session; a member can only see or create their own requests.
 */

import { jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { checkCustomerApiHeaders, requireCustomer } from '../../_shared/auth-session.js';
import {
  buildVerificationMessage,
  buildVerificationWhatsAppUrl,
  codeExpiresAt,
  generateVerificationCode,
  getVerificationSecret,
  hashVerificationCode,
  newVerificationId,
  normalizeVerificationPhone,
  VERIFICATION_COOLDOWN_SEC,
  VERIFICATION_DAILY_MAX,
  VERIFICATION_HOURLY_MAX,
  verificationReference,
  verificationValidUntil,
} from '../../_shared/phone-verification.js';
import {
  countPhoneRequestsSince,
  countUserRequestsSince,
  expireStalePending,
  expireVerificationById,
  findPendingVerification,
  findValidVerification,
  insertVerification,
} from '../../_shared/repositories/phone-verifications.repo.js';
import { readTelegramLink, callTelegramApi, escapeHtml } from '../../_shared/telegram.js';

const TELEGRAM_TIMEOUT_MS = 4000;

function publicPending(row) {
  if (!row) return null;
  return {
    phone: row.phone,
    reference: row.reference,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Store WhatsApp number + display name, best effort (never blocks a code). */
async function readStoreContact(env) {
  try {
    const menu = await env.MENU_KV.get('menu', { type: 'json' });
    const settings = menu && menu.settings ? menu.settings : {};
    return {
      whatsapp: typeof settings.whatsapp === 'string' ? settings.whatsapp : '',
      name: settings.name && typeof settings.name === 'object'
        ? String(settings.name.ar || settings.name.en || '').slice(0, 80)
        : '',
    };
  } catch {
    return { whatsapp: '', name: '' };
  }
}

/**
 * Owner ping on every new request. Approval is manual, so a silent request
 * would leave the member waiting. Best effort: a Telegram failure must not
 * lose the code the member is about to send.
 */
async function notifyOwner(env, { phone, reference, name, expiresAt }) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN || null;
    if (!token) return;
    const link = await readTelegramLink(env.ORDERS_DB);
    if (!link) return;
    const member = typeof name === 'string' && name.trim() ? escapeHtml(name.trim().slice(0, 80)) : '—';
    const text = [
      '🔐 <b>Phone verification request</b>',
      `Number: <code>+${escapeHtml(phone)}</code>`,
      `Ref: <code>${escapeHtml(reference)}</code>`,
      `Member: ${member}`,
      `Expires: ${escapeHtml(expiresAt)}`,
      '',
      'Match the Ref in the WhatsApp message, then approve in Dashboard → Customers → Accounts.',
    ].join('\n');
    await callTelegramApi(token, 'sendMessage', { chat_id: link.chatId, text, parse_mode: 'HTML' }, TELEGRAM_TIMEOUT_MS);
  } catch {}
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });
  }

  const gate = checkCustomerApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const auth = await requireCustomer(request, env);
  if (!auth.ok) return auth.response;

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable' }, 503);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const phone = normalizeVerificationPhone(url.searchParams.get('phone') || '');
    if (!phone) return jsonNoStore({ error: 'phone_invalid' }, 400);
    try {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const approved = await findValidVerification(db, auth.user.id, phone, nowMs);
      if (approved) {
        return jsonNoStore({
          verified: true,
          verifiedUntil: verificationValidUntil(approved),
          pending: null,
        });
      }
      const pending = await findPendingVerification(db, auth.user.id, phone, nowIso);
      return jsonNoStore({
        verified: false,
        verifiedUntil: null,
        pending: publicPending(pending),
      });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  let body;
  try {
    body = await readJsonBody(request, 4 * 1024);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  const phone = normalizeVerificationPhone(body && body.phone);
  if (!phone) return jsonNoStore({ error: 'phone_invalid' }, 400);

  const secret = getVerificationSecret(env);
  if (!secret) return jsonNoStore({ error: 'unavailable' }, 503);

  const lang = body && body.lang === 'ar' ? 'ar' : 'en';
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  try {
    const approved = await findValidVerification(db, auth.user.id, phone, nowMs);
    if (approved) {
      return jsonNoStore({
        ok: true,
        verified: true,
        verifiedUntil: verificationValidUntil(approved),
      });
    }

    await expireStalePending(db, nowIso, { userId: auth.user.id, phone });
    const pending = await findPendingVerification(db, auth.user.id, phone, nowIso);
    if (pending) {
      const createdMs = Date.parse(pending.created_at || '');
      const elapsedSec = Number.isFinite(createdMs) ? Math.floor((nowMs - createdMs) / 1000) : 0;
      if (elapsedSec < VERIFICATION_COOLDOWN_SEC) {
        return jsonNoStore({
          error: 'cooldown',
          retryAfter: Math.max(1, VERIFICATION_COOLDOWN_SEC - elapsedSec),
          pending: publicPending(pending),
        }, 429);
      }
      // Past the cooldown: the member asked for a fresh code. Retire the old
      // row so the one-pending slot is free; its WhatsApp message stops
      // matching, which is the point of a resend.
      await expireVerificationById(db, pending.id, nowIso);
    }

    const hourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    const [hourCount, dayCount, userDayCount] = await Promise.all([
      countPhoneRequestsSince(db, auth.user.id, phone, hourAgo),
      countPhoneRequestsSince(db, auth.user.id, phone, dayAgo),
      countUserRequestsSince(db, auth.user.id, dayAgo),
    ]);
    if (
      hourCount >= VERIFICATION_HOURLY_MAX ||
      dayCount >= VERIFICATION_DAILY_MAX ||
      userDayCount >= VERIFICATION_DAILY_MAX * 2
    ) {
      return jsonNoStore({ error: 'rate_limited', retryAfter: 3600 }, 429);
    }

    const id = newVerificationId();
    const code = generateVerificationCode();
    const reference = await verificationReference(id);
    const expiresAt = codeExpiresAt(nowMs);
    const codeHash = await hashVerificationCode(secret, { id, phone, code });
    const inserted = await insertVerification(db, {
      id,
      userId: auth.user.id,
      phone,
      reference,
      codeHash,
      createdAt: nowIso,
      expiresAt,
    });
    if (!inserted) {
      const live = await findPendingVerification(db, auth.user.id, phone, nowIso);
      return jsonNoStore({ error: 'pending_exists', pending: publicPending(live) }, 409);
    }

    const store = await readStoreContact(env);
    const message = buildVerificationMessage({ code, reference, lang });
    const whatsappUrl = buildVerificationWhatsAppUrl(store.whatsapp, message);

    const ping = notifyOwner(env, {
      phone,
      reference,
      name: auth.user && auth.user.name,
      expiresAt,
    });
    if (typeof context.waitUntil === 'function') context.waitUntil(ping);

    return jsonNoStore({
      ok: true,
      verified: false,
      verification: {
        phone,
        reference,
        code,
        createdAt: nowIso,
        expiresAt,
        message,
        whatsappUrl,
      },
    });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
