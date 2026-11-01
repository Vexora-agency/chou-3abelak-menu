/**
 * Admin Telegram integration: GET status / POST pair-code|save-username|disconnect.
 * ADMIN SESSION REQUIRED (directory middleware) + checkApiHeaders.
 * Phase 2+3 scope: pairing ONLY — no order changes.
 *
 * Secrets (TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET) are Cloudflare Pages
 * secrets (env), never stored in D1. GET exposes presence flags only.
 * The link (chat_id + bot_username, non-secret) lives in service_config
 * under the 'telegram' key; pairing codes live hashed in
 * telegram_pairing_codes (migration 0014).
 */
import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import {
  PAIRING_TTL_SEC,
  buildDeepLink,
  clearTelegramLink,
  isBotUsernameFormat,
  issuePairingCode,
  readLastTelegramNotification,
  readPendingPairing,
  readTelegramLink,
  resolveBotUsername,
  saveTelegramBotUsername,
} from '../../_shared/telegram.js';

const MAX_BODY_BYTES = 4 * 1024;

export async function onRequest(context) {
  const { request, env } = context;

  if (!hasFeature(env, 'orderLogging')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable', message: 'Orders database not configured' }, 503);
  }

  const hasBotToken = typeof env.TELEGRAM_BOT_TOKEN === 'string' && env.TELEGRAM_BOT_TOKEN !== '';
  const hasWebhookSecret = typeof env.TELEGRAM_WEBHOOK_SECRET === 'string' && env.TELEGRAM_WEBHOOK_SECRET !== '';

  // Status: link state + presence flags. Never the token, never the secret.
  // chat_id is shown only to the authenticated admin (it is their own id).
  if (request.method === 'GET') {
    let link;
    let botUsername;
    let lastNotification;
    let pendingPairing = { pending: false, expiresAt: null };
    try {
      link = await readTelegramLink(db);
      botUsername = await resolveBotUsername(db, env);
      lastNotification = await readLastTelegramNotification(db);
      if (!link) pendingPairing = await readPendingPairing(db);
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
    return jsonNoStore({
      ok: true,
      linked: link !== null,
      pairingPending: pendingPairing.pending,
      pairingExpiresAt: pendingPairing.expiresAt,
      linkedAt: link ? link.linkedAt : null,
      botUsername,
      botConfigured: botUsername !== null,
      hasBotToken: hasBotToken,
      hasWebhookSecret: hasWebhookSecret,
      pairingTtlSec: PAIRING_TTL_SEC,
      lastNotification,
    });
  }

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_content_type' }, 400);
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_body' }, 400);
  }
  const action = body && typeof body.action === 'string' ? body.action : '';

  // Save the public bot username (from BotFather). Needed to build the
  // t.me deep link. Non-secret; validated shape.
  if (action === 'save-username') {
    const name = body && typeof body.botUsername === 'string' ? body.botUsername.trim() : '';
    if (!isBotUsernameFormat(name)) {
      return jsonNoStore({ error: 'invalid_bot_username' }, 400);
    }
    try {
      const saved = await saveTelegramBotUsername(db, name);
      return jsonNoStore({ ok: true, botUsername: saved });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  // Issue a one-time pairing code (10 min TTL). The raw code is returned
  // ONCE here; only its SHA-256 hash is stored.
  if (action === 'pair-code') {
    try {
      const { code, expiresAt } = await issuePairingCode(db);
      const botUsername = await resolveBotUsername(db, env);
      const deepLink = botUsername ? buildDeepLink(botUsername, code) : null;
      if (!deepLink) {
        return jsonNoStore({ error: 'bot_not_configured' }, 503);
      }
      return jsonNoStore({
        ok: true,
        code,
        deepLink,
        expiresAt,
        ttlSec: PAIRING_TTL_SEC,
      });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  // Disconnect: drop the chat link. Pairing codes already issued stay
  // single-use and expire on their own; a fresh code re-links.
  if (action === 'disconnect') {
    try {
      await clearTelegramLink(db);
      return jsonNoStore({ ok: true, linked: false });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  return jsonNoStore({ error: 'bad_action' }, 400);
}
