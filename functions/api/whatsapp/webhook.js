/**
 * WhatsApp Cloud API webhook: GET verification + POST inbound messages.
 *
 * GET  /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
 * POST /api/whatsapp/webhook  (Meta only; X-Hub-Signature-256 required)
 *
 * The member sends the 6-digit code from their own WhatsApp to the business
 * number. The sender number is the proof; the code hash is the second factor.
 * A correct code approves the pending row automatically and replies with a
 * free-form service message (the inbound message opened the 24-hour customer
 * service window). A wrong code gets the retry reply and stays pending.
 *
 * No Telegram here. The dashboard approval stays as a manual fallback when the
 * webhook is not configured or a reply fails.
 */

import { jsonNoStore, safeCompareStrings } from '../../_shared/session.js';
import { captureBackendException } from '../../_shared/sentry.js';
import {
  pickReplyLanguage,
  extractVerificationCode,
  looksLikeVerificationMessage,
  readWhatsAppMessages,
  sendWhatsAppText,
  verifyWebhookSignature,
  whatsappReply,
} from '../../_shared/whatsapp.js';
import { getVerificationSecret, verificationCodeMatches } from '../../_shared/phone-verification.js';
import {
  claimWhatsAppEvent,
  countWhatsAppEventsSince,
  decideVerification,
  expireStaleApproved,
  findValidVerificationByPhone,
  finishWhatsAppEvent,
  getVerificationById,
  listLivePendingWaVerifications,
  listPendingVerificationsByPhone,
  phoneOwnedByAnotherUser,
} from '../../_shared/repositories/phone-verifications.repo.js';

const MAX_BODY_BYTES = 64 * 1024;
/** Reply caps protect the free monthly service-message allowance. */
const REPLY_HOURLY_PER_PHONE = 10;
const REPLY_DAILY_PER_PHONE = 20;
const DEFAULT_MONTHLY_REPLIES = 900;

function monthStartIso(nowMs) {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/**
 * True when a reply is worth sending without risking the free tier. Approvals
 * are never blocked by this; only the WhatsApp confirmation is skipped.
 */
async function replyAllowed(db, env, phone, nowMs) {
  const hourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const monthlyCapRaw = Number(env.WHATSAPP_REPLY_MONTHLY_CAP);
  const monthlyCap = Number.isFinite(monthlyCapRaw) && monthlyCapRaw > 0
    ? Math.min(10000, Math.floor(monthlyCapRaw))
    : DEFAULT_MONTHLY_REPLIES;
  const [hourCount, dayCount, monthCount] = await Promise.all([
    countWhatsAppEventsSince(db, hourAgo, phone),
    countWhatsAppEventsSince(db, dayAgo, phone),
    countWhatsAppEventsSince(db, monthStartIso(nowMs)),
  ]);
  return hourCount < REPLY_HOURLY_PER_PHONE
    && dayCount < REPLY_DAILY_PER_PHONE
    && monthCount < monthlyCap;
}

async function maybeReply(env, db, msg, text, nowMs, outcome) {
  let allowed;
  try {
    allowed = await replyAllowed(db, env, msg.from, nowMs);
  } catch {
    // Fail closed for the reply (cost guard); the approval already happened.
    allowed = false;
  }
  if (!allowed) return;
  const result = await sendWhatsAppText(env, msg.from, text);
  if (!result.ok) {
    try {
      console.warn(JSON.stringify({
        evt: 'whatsapp_reply_failed',
        outcome,
        error: result.error,
        status: result.status,
      }));
    } catch {}
  }
}

/**
 * The sender has no pending row for their own number. Before treating the
 * message as expired, see whether the code matches a live request for a
 * DIFFERENT number: that means the member typed a number that does not match
 * the WhatsApp they are sending from, so the message can never approve it.
 * Return that row (language only; the number is never echoed back).
 */
async function findWrongNumberPending(db, secret, code, sender, nowIso) {
  let rows;
  try {
    rows = await listLivePendingWaVerifications(db, nowIso);
  } catch {
    return null;
  }
  for (const row of rows) {
    if (!row || row.phone === sender) continue;
    if (await verificationCodeMatches(secret, row, code)) return row;
  }
  return null;
}

async function handleMessage(context, env, db, msg) {
  // Ignore ordinary customer messages on the same business number. Only a
  // verification-looking message is claimed, recorded, or answered.
  if (!looksLikeVerificationMessage(msg.text)) return;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const claimed = await claimWhatsAppEvent(db, {
    messageId: msg.id,
    phone: msg.from,
    nowIso,
  });
  if (!claimed) return;

  let outcome = 'ignored';
  try {
    const pendingRows = await listPendingVerificationsByPhone(db, msg.from, nowIso);
    const code = extractVerificationCode(msg.text);
    const secret = getVerificationSecret(env);
    const rowLang = pendingRows[0]?.lang;

    if (pendingRows.length === 0) {
      // The message can still carry the code of a request for another number.
      // That happens when the member typed the number with a different digit
      // (or another account owns it) but sent from this WhatsApp. Explain the
      // mismatch instead of leaving them waiting forever.
      if (code && secret) {
        const wrongNumber = await findWrongNumberPending(db, secret, code, msg.from, nowIso);
        if (wrongNumber) {
          outcome = 'wrong_number';
          await maybeReply(
            env,
            db,
            msg,
            whatsappReply('wrongNumber', pickReplyLanguage(wrongNumber.lang, msg.text)),
            nowMs,
            outcome
          );
          return;
        }
      }
      const approved = await findValidVerificationByPhone(db, msg.from, nowMs);
      if (approved) {
        // Duplicate/extra message after a successful verification: stay quiet
        // to avoid spending another service message on a duplicate.
        outcome = 'already_verified';
        return;
      }
      outcome = 'no_request';
      await maybeReply(
        env,
        db,
        msg,
        whatsappReply('expired', pickReplyLanguage(null, msg.text)),
        nowMs,
        outcome
      );
      return;
    }

    if (!code) {
      outcome = 'missing_code';
      await maybeReply(
        env,
        db,
        msg,
        whatsappReply('missing', pickReplyLanguage(rowLang, msg.text)),
        nowMs,
        outcome
      );
      return;
    }

    if (!secret) {
      outcome = 'no_secret';
      return;
    }

    let matched = null;
    for (const row of pendingRows) {
      if (await verificationCodeMatches(secret, row, code)) {
        matched = row;
        break;
      }
    }

    if (!matched) {
      outcome = 'wrong_code';
      await maybeReply(
        env,
        db,
        msg,
        whatsappReply('wrong', pickReplyLanguage(rowLang, msg.text)),
        nowMs,
        outcome
      );
      return;
    }

    // Re-check ownership immediately before approving: another member may
    // have claimed this number while the code was waiting. The code proves
    // the phone, not the account, so the second account must be refused.
    await expireStaleApproved(db, nowMs, matched.phone);
    if (await phoneOwnedByAnotherUser(db, matched.phone, matched.user_id, nowMs)) {
      await decideVerification(db, matched.id, {
        status: 'rejected',
        decidedBy: 'ownership_conflict',
        nowIso,
      });
      outcome = 'phone_linked_other_account';
      await maybeReply(
        env,
        db,
        msg,
        whatsappReply('conflict', pickReplyLanguage(matched.lang, msg.text)),
        nowMs,
        outcome
      );
      return;
    }

    let decided;
    try {
      decided = await decideVerification(db, matched.id, {
        status: 'approved',
        decidedBy: 'whatsapp',
        nowIso,
      });
    } catch (err) {
      const message = err && typeof err.message === 'string' ? err.message : '';
      // Two approvals raced; the unique owner index let the other member win.
      // Tell this sender the number is linked instead of failing silently.
      if (/UNIQUE constraint failed:\s*phone_verifications\.phone/i.test(message)) {
        outcome = 'phone_linked_other_account';
        await maybeReply(
          env,
          db,
          msg,
          whatsappReply('conflict', pickReplyLanguage(matched.lang, msg.text)),
          nowMs,
          outcome
        );
        return;
      }
      throw err;
    }
    if (!decided) {
      // A race with the manual dashboard button can lose the UPDATE even
      // though the row is now approved. Treat that as success, not expiry.
      const current = await getVerificationById(db, matched.id);
      const lang = pickReplyLanguage(matched.lang, msg.text);
      if (current && current.status === 'approved') {
        outcome = 'verified';
        await maybeReply(env, db, msg, whatsappReply('success', lang), nowMs, outcome);
      } else {
        outcome = 'expired';
        await maybeReply(env, db, msg, whatsappReply('expired', lang), nowMs, outcome);
      }
      return;
    }

    outcome = 'verified';
    await maybeReply(
      env,
      db,
      msg,
      whatsappReply('success', pickReplyLanguage(matched.lang, msg.text)),
      nowMs,
      outcome
    );
  } catch (err) {
    outcome = 'error';
    captureBackendException(context, err, { binding: 'd1', code: 'whatsapp_webhook' });
  } finally {
    try {
      await finishWhatsAppEvent(db, msg.id, outcome);
    } catch {}
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Meta webhook verification challenge.
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') || '';
    const challenge = url.searchParams.get('hub.challenge') || '';
    const expected = typeof env.WHATSAPP_VERIFY_TOKEN === 'string' ? env.WHATSAPP_VERIFY_TOKEN.trim() : '';
    if (mode === 'subscribe' && expected && safeCompareStrings(token, expected)) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });
  }

  const appSecret = typeof env.WHATSAPP_APP_SECRET === 'string' ? env.WHATSAPP_APP_SECRET.trim() : '';
  if (!appSecret) return jsonNoStore({ error: 'unavailable' }, 503);

  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BODY_BYTES) return jsonNoStore({ error: 'too_large' }, 413);

  let raw;
  try {
    raw = await request.text();
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }
  if (raw.length > MAX_BODY_BYTES) return jsonNoStore({ error: 'too_large' }, 413);

  const valid = await verifyWebhookSignature(
    raw,
    request.headers.get('X-Hub-Signature-256'),
    appSecret
  ).catch(() => false);
  if (!valid) return jsonNoStore({ error: 'forbidden' }, 401);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  const messages = readWhatsAppMessages(payload);
  if (messages.length === 0) return jsonNoStore({ ok: true, processed: 0 });

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable' }, 503);

  for (const msg of messages) {
    try {
      await handleMessage(context, env, db, msg);
    } catch (err) {
      // One malformed message must not block the rest. Meta retries are
      // harmless: the message id is claimed once.
      captureBackendException(context, err, { binding: 'd1', code: 'whatsapp_webhook_message' });
    }
  }

  return jsonNoStore({ ok: true, processed: messages.length });
}
