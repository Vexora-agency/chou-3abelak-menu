/**
 * Telegram Bot API webhook: POST /api/telegram/webhook
 * Phase 2+3 scope: account LINKING only (/start <pairing-code>).
 *
 * PUBLIC endpoint (outside /api/admin/*, so no admin middleware) — the ONLY
 * gate is Telegram's secret_token: every request must carry the
 * X-Telegram-Bot-Api-Secret-Token header matching the TELEGRAM_WEBHOOK_SECRET
 * Pages secret (timing-safe compare). Fail closed: no secret configured or
 * header mismatch -> reject; malformed updates -> 200-ignored (no retry
 * storms, no oracle).
 *
 * Authorization uses ONLY the numeric chat.id written by consumePairingCode
 * during an authenticated pairing flow. Usernames, first/last names, and any
 * client-supplied id are never trusted.
 *
 * Callback buttons (Confirm / Cancel) are validated in handleOrderCallback:
 * linked chat only, order must exist, transition must be allowed, repeats
 * are idempotent no-ops.
 */

import { jsonNoStore, readJsonBody } from '../../_shared/session.js';
import {
  callTelegramApi,
  consumePairingCode,
  handleOrderCallback,
  isPairingCodeFormat,
  readTelegramLink,
  saveTelegramLink,
  verifyWebhookSecret,
} from '../../_shared/telegram.js';

const MAX_BODY_BYTES = 16 * 1024;

function getBotToken(env) {
  const t = env && typeof env.TELEGRAM_BOT_TOKEN === 'string' ? env.TELEGRAM_BOT_TOKEN : '';
  return t !== '' ? t : null;
}

function getChatId(msg) {
  const id = msg && msg.chat && msg.chat.id;
  return Number.isInteger(id) ? id : null;
}

/** Extract "/start <code>" param (tolerates "/start@BotName <code>"). */
function parseStartParam(text) {
  if (typeof text !== 'string') return null;
  const m = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/.exec(text.trim());
  if (!m) return { isStart: false, param: null };
  return { isStart: true, param: typeof m[1] === 'string' ? m[1] : null };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  // Gate 1: secret header. null = webhook not configured (closed, 404 —
  // hides the endpoint until the owner sets the secret). false = mismatch.
  const verdict = verifyWebhookSecret(request, env);
  if (verdict === null) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }
  if (verdict === false) {
    return jsonNoStore({ error: 'forbidden' }, 403);
  }

  let update;
  try {
    update = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    // Malformed body: 200-ignored so Telegram stops retrying junk.
    return jsonNoStore({ ok: true });
  }
  if (!update || typeof update !== 'object') return jsonNoStore({ ok: true });

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ ok: true });
  const token = getBotToken(env);

  // Best-effort send (link state is D1 truth; confirmation never blocks).
  const reply = async (chatId, text) => {
    if (!token || !Number.isInteger(chatId)) return;
    try {
      await callTelegramApi(token, 'sendMessage', { chat_id: chatId, text });
    } catch {}
  };
  // ---- callback_query: Confirm / Cancel buttons. Fully validated in
  // handleOrderCallback (linked chat, order exists, transition allowed).
  try {
    const cb = update.callback_query;
    if (cb && typeof cb === 'object') {
      const msg = cb.message && typeof cb.message === 'object' ? cb.message : null;
      await handleOrderCallback(db, token, {
        callbackId: typeof cb.id === 'string' ? cb.id : '',
        clickerId: cb.from && Number.isInteger(cb.from.id) ? cb.from.id : null,
        chatId: msg ? getChatId(msg) : null,
        messageId: msg && Number.isInteger(msg.message_id) ? msg.message_id : null,
        data: typeof cb.data === 'string' ? cb.data : '',
        messageText: msg && typeof msg.text === 'string' ? msg.text : '',
      });
      return jsonNoStore({ ok: true });
    }
  } catch {}

  // ---- message handling: only /start (pairing).
  try {
    const msg = update.message;
    if (!msg || typeof msg !== 'object') return jsonNoStore({ ok: true });
    const chatId = getChatId(msg);
    if (chatId === null) return jsonNoStore({ ok: true });

    const { isStart, param } = parseStartParam(msg.text);
    if (!isStart) return jsonNoStore({ ok: true });

    const link = await readTelegramLink(db);

    // /start with a code -> pairing attempt. Expired/reused/unknown all
    // read identically (no oracle); only a valid consume links.
    if (param !== null) {
      if (!isPairingCodeFormat(param)) {
        await reply(chatId, 'This link is invalid. Please generate a new one from the admin dashboard.');
        return jsonNoStore({ ok: true });
      }
      let consumed = false;
      try {
        consumed = await consumePairingCode(db, param, chatId);
      } catch {
        consumed = false;
      }
      if (!consumed) {
        await reply(chatId, 'This link has expired or was already used. Please generate a new one from the admin dashboard.');
        return jsonNoStore({ ok: true });
      }
      try {
        await saveTelegramLink(db, chatId);
      } catch {
        // Code consumed but link write failed: tell the owner to retry
        // with a FRESH code (the used one can never be reused).
        await reply(chatId, 'Linking failed on our side. Please generate a new link from the admin dashboard and try again.');
        return jsonNoStore({ ok: true });
      }
      await reply(chatId, '✅ This chat is now linked. You will receive new-order notifications here.');
      return jsonNoStore({ ok: true });
    }

    // Bare /start (no code): linked chats get status, others get the
    // generic pointer (no link-state disclosure beyond their own chat).
    if (link && link.chatId === chatId) {
      await reply(chatId, '✅ This chat is linked and will receive new-order notifications.');
    } else {
      // Generic pointer for unknown chats: pairing links are issued from
      // the authenticated dashboard only (never guessable, never via chat).
      await reply(chatId, 'To link, generate a pairing link from the admin dashboard (Telegram section).');
    }
    return jsonNoStore({ ok: true });
  } catch {
    return jsonNoStore({ ok: true });
  }
}
