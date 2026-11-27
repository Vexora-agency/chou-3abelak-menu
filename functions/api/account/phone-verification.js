/**
 * POST/GET /api/account/phone-verification
 *
 * Reverse WhatsApp verification for the signed-in member's number.
 *
 * POST { phone, method? } mints a 6-digit code for that exact number and
 * returns it ONCE (only a keyed hash is stored). The member sends the code
 * from their WhatsApp to the business; the Cloud API webhook approves it
 * automatically. `method:'sms'` sends the OTP through UniMTX instead (the
 * no-WhatsApp fallback); the code is then verified by the member on the site.
 * GET ?phone= reports the current state for the checkout UI.
 *
 * Every request is session-gated and CSRF-gated. The user id always comes
 * from the session; a member can only see or create their own requests.
 */

import { jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { checkCustomerApiHeaders, requireCustomer } from '../../_shared/auth-session.js';
import {
  buildVerificationMessage,
  buildVerificationWhatsAppUrl,
  canonicalizeVerificationPhone,
  codeExpiresAt,
  generateVerificationCode,
  getVerificationSecret,
  hashVerificationCode,
  newVerificationId,
  normalizeVerificationPhone,
  PHONE_LINKED_ERROR,
  PHONE_LINKED_MESSAGE,
  VERIFICATION_COOLDOWN_SEC,
  VERIFICATION_DAILY_MAX,
  VERIFICATION_HOURLY_MAX,
  verificationCodeMatches,
  verificationReference,
  verificationValidUntil,
} from '../../_shared/phone-verification.js';
import {
  countPhoneRequestsSince,
  countSmsRequestsSince,
  countUserRequestsSince,
  decideVerification,
  expireStaleApproved,
  expireStalePending,
  expireVerificationById,
  findPendingVerification,
  findPhoneChangeRevocation,
  findValidVerification,
  incrementVerificationAttempts,
  insertVerification,
  phoneOwnedByAnotherUser,
} from '../../_shared/repositories/phone-verifications.repo.js';
import {
  getUnimtxTemplateId,
  getUnimtxTemplateVar,
  isUnimtxConfigured,
  sendUnimtxOtp,
  sendUnimtxTemplateSms,
  verifyUnimtxOtp,
} from '../../_shared/unimtx.js';
import { getStorePhoneSettings } from '../../_shared/store-phone.js';

const SMS_MAX_ATTEMPTS = 5;
const PHONE_CHANGED_ERROR = 'phone_changed';
const PHONE_CHANGED_MESSAGE = {
  en: 'Your saved number changed, so this code was cancelled. Request a new SMS for the current number.',
  ar: 'تم تغيير رقم حسابك، لذا أُلغي هذا الكود. اطلب كود SMS جديدًا للرقم الحالي.',
};

function phoneLinkedResponse() {
  return jsonNoStore({ error: PHONE_LINKED_ERROR, message: PHONE_LINKED_MESSAGE }, 409);
}

function publicPending(row) {
  if (!row) return null;
  return {
    phone: row.phone,
    reference: row.reference,
    method: row.method === 'sms' ? 'sms' : 'whatsapp',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Verify an SMS OTP with UniMTX and approve the pending row. The member types
 * the code on the site; no owner call is involved.
 */
async function verifySmsCode(db, env, userId, phone, rawCode) {
  const code = String(rawCode || '').replace(/[^0-9]/g, '');
  if (code.length < 4 || code.length > 8) {
    return { status: 400, body: { error: 'code_invalid' } };
  }
  if (!isUnimtxConfigured(env)) {
    return { status: 503, body: { error: 'sms_unavailable' } };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const pending = await findPendingVerification(db, userId, phone, nowIso);
  if (!pending || pending.method !== 'sms') {
    // A pending SMS is retired when the member changes their saved phone.
    // Explain that instead of the generic "expired" message.
    const revoked = await findPhoneChangeRevocation(
      db,
      userId,
      phone,
      new Date(nowMs - 60 * 60 * 1000).toISOString()
    );
    if (revoked) return { status: 409, body: { error: PHONE_CHANGED_ERROR, message: PHONE_CHANGED_MESSAGE } };
    return { status: 409, body: { error: 'no_pending' } };
  }
  if (Number(pending.attempts) >= SMS_MAX_ATTEMPTS) {
    return { status: 429, body: { error: 'too_many_attempts' } };
  }

  let valid;
  if (pending.code_hash === 'unimtx') {
    // Built-in UniMTX OTP: the provider stores and verifies the code.
    const result = await verifyUnimtxOtp(env, {
      to: phone,
      code,
      intent: 'phone_verification',
      ttl: 300,
    });
    if (!result.ok) {
      return { status: 502, body: { error: 'sms_verify_failed' } };
    }
    valid = result.valid;
  } else {
    // Custom template: the code is ours and only its keyed hash is stored.
    const secret = getVerificationSecret(env);
    if (!secret) {
      return { status: 503, body: { error: 'sms_unavailable' } };
    }
    valid = await verificationCodeMatches(secret, pending, code);
  }

  if (!valid) {
    await incrementVerificationAttempts(db, pending.id);
    return { status: 400, body: { error: 'code_invalid' } };
  }

  // Ownership is re-checked immediately before approval: another member may
  // have claimed the number after this row was minted (or a legacy duplicate
  // may exist). The code proves the phone, not the account.
  await expireStaleApproved(db, nowMs, phone);
  if (await phoneOwnedByAnotherUser(db, phone, userId, nowMs)) {
    await decideVerification(db, pending.id, {
      status: 'rejected',
      decidedBy: 'ownership_conflict',
      nowIso,
    });
    return { status: 409, body: { error: PHONE_LINKED_ERROR, message: PHONE_LINKED_MESSAGE } };
  }

  const decided = await decideVerification(db, pending.id, {
    status: 'approved',
    decidedBy: 'sms',
    nowIso,
  });
  if (!decided) {
    return { status: 409, body: { error: 'expired' } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      verified: true,
      verifiedUntil: verificationValidUntil(decided),
    },
  };
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
      if (await phoneOwnedByAnotherUser(db, phone, auth.user.id, nowMs)) {
        return jsonNoStore({
          verified: false,
          verifiedUntil: null,
          pending: null,
          linkedToOtherAccount: true,
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

  // Resolve the store's country first: every equivalent shape of the same
  // numbers (0120…, 0020…, +20…) must become the one value Meta sends the
  // webhook. Ownership checks compare exact digits, so without this a second
  // account could mint a code for an already-verified number in another shape.
  //
  // Verifying an SMS code is different: the row was stored canonical when the
  // code was minted, so use its exact digits. Re-canonicalizing against a
  // store country that changed after the request would lose the row.
  const verifyingSms = !!(body && body.action === 'verify');
  const storePhone = verifyingSms
    ? { whatsapp: '', dialCode: '' }
    : await getStorePhoneSettings(env);
  const phone = verifyingSms
    ? normalizeVerificationPhone(body.phone)
    : canonicalizeVerificationPhone(body.phone, storePhone.dialCode);
  if (!phone) return jsonNoStore({ error: 'phone_invalid' }, 400);

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // One phone = one member account. Refuse before minting a code (or spending
  // an SMS) when another member already owns this number. The approval paths
  // repeat this check to close the request/approval race.
  try {
    await expireStaleApproved(db, nowMs, phone);
    if (await phoneOwnedByAnotherUser(db, phone, auth.user.id, nowMs)) {
      return phoneLinkedResponse();
    }
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // SMS code entry: the member types the code received by SMS.
  if (body && body.action === 'verify') {
    try {
      const result = await verifySmsCode(db, env, auth.user.id, phone, body.code);
      return jsonNoStore(result.body, result.status);
    } catch (err) {
      const message = err && typeof err.message === 'string' ? err.message : '';
      // The unique owner index can win a race between the pre-check and the
      // approval. Surface the same friendly conflict instead of a 500.
      if (/UNIQUE constraint failed:\s*phone_verifications\.phone/i.test(message)) {
        return phoneLinkedResponse();
      }
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  const method = body && body.method === 'sms' ? 'sms' : 'whatsapp';
  let secret = null;
  if (method === 'whatsapp') {
    secret = getVerificationSecret(env);
    if (!secret) return jsonNoStore({ error: 'unavailable' }, 503);
  } else if (!isUnimtxConfigured(env)) {
    return jsonNoStore({
      error: 'sms_unavailable',
      message: {
        en: 'SMS verification is not available right now. Use WhatsApp or contact us.',
        ar: 'التحقق عبر SMS غير متاح حاليًا. استخدم واتساب أو تواصل معنا.',
      },
    }, 503);
  }

  const lang = body && body.lang === 'ar' ? 'ar' : 'en';

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
      const pendingMethod = pending.method === 'sms' ? 'sms' : 'whatsapp';
      if (pendingMethod !== method) {
        // The member explicitly switched channels (e.g. "I don't have
        // WhatsApp — send SMS"). Retire the old code immediately so the new
        // channel is not blocked by the WhatsApp cooldown.
        await expireVerificationById(db, pending.id, nowIso);
      } else {
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
        // row so the one-pending slot is free; its message stops matching.
        await expireVerificationById(db, pending.id, nowIso);
      }
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
    const reference = await verificationReference(id);
    const expiresAt = codeExpiresAt(nowMs);

    if (method === 'sms') {
      // Hard cost guard: SMS is only sent on the explicit no-WhatsApp path,
      // and this daily cap bounds a burst across many accounts.
      const dailyCapRaw = Number(env.UNIMTX_SMS_DAILY_MAX);
      const dailyCap = Number.isFinite(dailyCapRaw) && dailyCapRaw > 0
        ? Math.min(1000, Math.floor(dailyCapRaw))
        : 100;
      const smsToday = await countSmsRequestsSince(db, dayAgo);
      if (smsToday >= dailyCap) {
        return jsonNoStore({
          error: 'sms_rate_limited',
          message: {
            en: 'SMS verification is temporarily busy. Try again later or use WhatsApp.',
            ar: 'التحقق عبر SMS مشغول مؤقتًا. حاول لاحقًا أو استخدم واتساب.',
          },
        }, 429);
      }

      const templateId = getUnimtxTemplateId(env, lang);
      let codeHash = 'unimtx';
      let providerId = null;

      if (templateId) {
        // Language-specific template (public `pub_*` or approved custom).
        // WE generate the code, store only its keyed hash, and pass it to the
        // template variable. If the template is misconfigured or the route
        // rejects it, fall through to the built-in OTP so the member still
        // receives a code.
        const templateSecret = getVerificationSecret(env);
        if (templateSecret) {
          const smsCode = generateVerificationCode();
          const candidateHash = await hashVerificationCode(templateSecret, { id, phone, code: smsCode });
          const templateVar = getUnimtxTemplateVar(env);
          const signature = typeof env.UNIMTX_SMS_SIGNATURE === 'string'
            ? env.UNIMTX_SMS_SIGNATURE.trim()
            : '';
          const sent = await sendUnimtxTemplateSms(env, {
            to: phone,
            templateId,
            templateData: { [templateVar]: smsCode },
            signature,
          });
          if (sent.ok) {
            codeHash = candidateHash;
            providerId = sent.providerId || null;
          }
        }
      }

      if (codeHash === 'unimtx') {
        // Built-in UniMTX OTP text (zero-config fallback).
        const sent = await sendUnimtxOtp(env, {
          to: phone,
          channel: 'sms',
          intent: 'phone_verification',
          ttl: 300,
          digits: 6,
        });
        if (!sent.ok) {
          return jsonNoStore({
            error: 'sms_failed',
            message: {
              en: 'Could not send the SMS code. Check the number or use WhatsApp.',
              ar: 'تعذّر إرسال كود SMS. تحقق من الرقم أو استخدم واتساب.',
            },
          }, 502);
        }
        providerId = sent.data && typeof sent.data.id === 'string' ? sent.data.id : null;
      }

      const inserted = await insertVerification(db, {
        id,
        userId: auth.user.id,
        phone,
        reference,
        codeHash,
        method: 'sms',
        providerId,
        lang,
        createdAt: nowIso,
        expiresAt,
      });
      if (!inserted) {
        const live = await findPendingVerification(db, auth.user.id, phone, nowIso);
        return jsonNoStore({ error: 'pending_exists', pending: publicPending(live) }, 409);
      }

      return jsonNoStore({
        ok: true,
        verified: false,
        method: 'sms',
        pending: {
          phone,
          reference,
          method: 'sms',
          createdAt: nowIso,
          expiresAt,
        },
      });
    }

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(secret, { id, phone, code });
    const inserted = await insertVerification(db, {
      id,
      userId: auth.user.id,
      phone,
      reference,
      codeHash,
      method: 'whatsapp',
      lang,
      createdAt: nowIso,
      expiresAt,
    });
    if (!inserted) {
      const live = await findPendingVerification(db, auth.user.id, phone, nowIso);
      return jsonNoStore({ error: 'pending_exists', pending: publicPending(live) }, 409);
    }

    const message = buildVerificationMessage({ code, reference, lang });
    const whatsappUrl = buildVerificationWhatsAppUrl(storePhone.whatsapp, message);

    return jsonNoStore({
      ok: true,
      verified: false,
      method: 'whatsapp',
      verification: {
        phone,
        reference,
        code,
        method: 'whatsapp',
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
