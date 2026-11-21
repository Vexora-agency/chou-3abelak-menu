/**
 * POST/GET /api/account/phone-verification
 *
 * Reverse WhatsApp verification for the signed-in member's number.
 *
 * POST { phone } mints a 6-digit code for that exact number and returns it
 * ONCE (only a keyed hash is stored). The member sends the code from their
 * WhatsApp to the restaurant; the Cloud API webhook approves it automatically,
 * and the dashboard approval stays as a manual fallback. GET ?phone= reports
 * the current state for the checkout UI.
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

function publicPending(row) {
  if (!row) return null;
  return {
    phone: row.phone,
    reference: row.reference,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Store WhatsApp number, best effort (never blocks a code). */
async function readStoreWhatsApp(env) {
  // A dedicated Cloud API verification number may differ from the public
  // restaurant WhatsApp. When set, the member messages the API number so the
  // webhook can auto-approve and reply from it.
  const override = env && typeof env.WHATSAPP_VERIFICATION_NUMBER === 'string'
    ? env.WHATSAPP_VERIFICATION_NUMBER.trim()
    : '';
  if (override) return override;
  try {
    const menu = await env.MENU_KV.get('menu', { type: 'json' });
    const settings = menu && menu.settings ? menu.settings : {};
    return typeof settings.whatsapp === 'string' ? settings.whatsapp : '';
  } catch {
    return '';
  }
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
      lang,
      createdAt: nowIso,
      expiresAt,
    });
    if (!inserted) {
      const live = await findPendingVerification(db, auth.user.id, phone, nowIso);
      return jsonNoStore({ error: 'pending_exists', pending: publicPending(live) }, 409);
    }

    const storeWhatsApp = await readStoreWhatsApp(env);
    const message = buildVerificationMessage({ code, reference, lang });
    const whatsappUrl = buildVerificationWhatsAppUrl(storeWhatsApp, message);

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
