/**
 * Telegram owner-notification helpers (WebCrypto only, no dependencies).
 *
 * Phase 2+3 scope: pairing + webhook plumbing ONLY. No order-flow changes.
 *
 * Security contract (mirrors the invite-token model in access.js):
 *  - Pairing codes are 256-bit CSPRNG, base64url (43 chars — fits Telegram's
 *    64-char /start deep-link limit). Only SHA-256(code) touches D1.
 *  - Codes live 10 minutes (PAIRING_TTL_SEC) and are single-use via an
 *    atomic UPDATE ... WHERE used_at IS NULL AND expires_at > now.
 *  - The webhook trusts ONLY the linked chat_id (numeric Telegram id) that
 *    was written during an authenticated pairing flow. Usernames, names,
 *    and any client-supplied id are never used for authorization.
 *  - Bot credentials live in Cloudflare Pages secrets (TELEGRAM_BOT_TOKEN,
 *    TELEGRAM_WEBHOOK_SECRET) — never in D1, KV, or source control.
 *    The link itself (chat_id + bot_username, non-secret) lives in
 *    service_config under TELEGRAM_CONFIG_KEY, same as the WhatsApp
 *    config (migration 0012 pattern).
 *
 * Delivery contract (for Phase 4; ledger table ships in migration 0014):
 *  - telegram_notifications.order_id PK is the dedupe key: a repeated
 *    order event reuses the row instead of re-sending.
 *  - Exactly-once is NOT promised: HTTP + Telegram ACK-loss means a retry
 *    can double-deliver. Handlers must stay idempotent; the ledger gives
 *    at-least-once with visible status (pending/sent/failed) + attempts.
 *  - A Telegram failure must NEVER fail order creation (best-effort via
 *    context.waitUntil, same as push.js notifyNewOrder). Retryable errors
 *    (429/5xx/network) may be retried; 400/401/403/404 must not be.
 */

import { sha256Hex } from './access.js';
import { safeCompareStrings } from './session.js';

export const TELEGRAM_CONFIG_KEY = 'telegram';
export const PAIRING_TTL_SEC = 10 * 60;
export const PAIRING_CODE_BYTES = 32;
/** Cap of live (unused, unexpired) codes — bounds table growth per admin. */
export const MAX_ACTIVE_PAIRING_CODES = 5;

const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
const BOT_USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/;

/** 256-bit pairing code, 43-char base64url (fits /start's 64-char limit). */
export function newPairingCode() {
  const bytes = new Uint8Array(PAIRING_CODE_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict shape: exactly what newPairingCode() emits — nothing else. */
export function isPairingCodeFormat(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

/** Public bot username shape (BotFather names: 5–32 chars, alnum + _). */
export function isBotUsernameFormat(name) {
  return typeof name === 'string' && BOT_USERNAME_RE.test(name.trim());
}

export function buildDeepLink(botUsername, code) {
  if (!isBotUsernameFormat(botUsername) || !isPairingCodeFormat(code)) return null;
  return `https://t.me/${botUsername.trim()}?start=${code}`;
}

/* ---------- link storage (service_config, non-secret) ---------- */

async function readTelegramConfig(db) {
  try {
    const row = await db
      .prepare('SELECT value FROM service_config WHERE key = ?1')
      .bind(TELEGRAM_CONFIG_KEY)
      .first();
    if (row && typeof row.value === 'string') {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

async function writeTelegramConfig(db, config) {
  await db
    .prepare('INSERT OR REPLACE INTO service_config (key, value, updated_at) VALUES (?1, ?2, ?3)')
    .bind(TELEGRAM_CONFIG_KEY, JSON.stringify(config), new Date().toISOString())
    .run();
}

/**
 * The linked owner chat (numeric Telegram chat id) or null. This is the
 * ONLY value the webhook authorizes against — never a username.
 */
export async function readTelegramLink(db) {
  const cfg = await readTelegramConfig(db);
  const chatId = cfg && (typeof cfg.chat_id === 'number' ? cfg.chat_id : null);
  if (!Number.isInteger(chatId)) return null;
  return {
    chatId,
    linkedAt: typeof cfg.linked_at === 'string' ? cfg.linked_at : null,
    botUsername: typeof cfg.bot_username === 'string' ? cfg.bot_username : null,
  };
}

export async function readTelegramBotUsername(db) {
  const cfg = await readTelegramConfig(db);
  return typeof cfg.bot_username === 'string' && isBotUsernameFormat(cfg.bot_username)
    ? cfg.bot_username
    : null;
}

/**
 * Resolve the public bot username. Priority:
 *   1. TELEGRAM_BOT_USERNAME Pages variable (set once by the developer —
 *      the owner never types or sees anything technical).
 *   2. D1 service_config fallback (legacy manual save).
 * Returns null when neither is configured.
 */
export async function resolveBotUsername(db, env) {
  const fromEnv = env && typeof env.TELEGRAM_BOT_USERNAME === 'string' ? env.TELEGRAM_BOT_USERNAME.trim() : '';
  if (isBotUsernameFormat(fromEnv)) return fromEnv;
  try {
    return await readTelegramBotUsername(db);
  } catch {
    return null;
  }
}

export async function saveTelegramBotUsername(db, botUsername) {
  if (!isBotUsernameFormat(botUsername)) throw new Error('invalid_bot_username');
  const cfg = await readTelegramConfig(db);
  await writeTelegramConfig(db, { ...cfg, bot_username: botUsername.trim() });
  return botUsername.trim();
}

/** Persist the link after a successful atomic code consume. */
export async function saveTelegramLink(db, chatId) {
  if (!Number.isInteger(chatId)) throw new Error('invalid_chat_id');
  const cfg = await readTelegramConfig(db);
  await writeTelegramConfig(db, {
    ...cfg,
    chat_id: chatId,
    linked_at: new Date().toISOString(),
  });
}

/** Disconnect: drops the chat link, keeps the (public) bot username. */
export async function clearTelegramLink(db) {
  const cfg = await readTelegramConfig(db);
  const next = { ...cfg };
  delete next.chat_id;
  delete next.linked_at;
  await writeTelegramConfig(db, next);
}

/* ---------- pairing codes (hash-only storage, TTL, single-use) ---------- */

/**
 * Issue a code: prune expired rows, cap live codes, store ONLY the hash.
 * Returns { code, expiresAt } — the raw code is shown ONCE to the admin.
 */
export async function issuePairingCode(db) {
  const nowIso = new Date().toISOString();
  try {
    await db
      .prepare('DELETE FROM telegram_pairing_codes WHERE expires_at <= ?1 OR (used_at IS NOT NULL AND used_at <= ?1)')
      .bind(nowIso)
      .run();
  } catch {}
  // Bound growth: drop oldest live codes beyond the cap (single admin).
  try {
    await db
      .prepare(
        `DELETE FROM telegram_pairing_codes WHERE code_hash IN (
           SELECT code_hash FROM telegram_pairing_codes
           WHERE used_at IS NULL AND expires_at > ?1
           ORDER BY created_at DESC LIMIT -1 OFFSET ?2
         )`
      )
      .bind(nowIso, MAX_ACTIVE_PAIRING_CODES)
      .run();
  } catch {}
  const code = newPairingCode();
  const codeHash = await sha256Hex(code);
  const nowMs = Date.now();
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + PAIRING_TTL_SEC * 1000).toISOString();
  await db
    .prepare('INSERT INTO telegram_pairing_codes (code_hash, created_at, expires_at, used_at, consumed_by_chat) VALUES (?1, ?2, ?3, NULL, NULL)')
    .bind(codeHash, createdAt, expiresAt)
    .run();
  return { code, expiresAt };
}

/**
 * Atomically consume a code for a chat. Returns true on success.
 * False covers expired / reused / unknown identically (no oracle).
 */
export async function consumePairingCode(db, code, chatId) {
  if (!isPairingCodeFormat(code) || !Number.isInteger(chatId)) return false;
  const nowIso = new Date().toISOString();
  let codeHash;
  try {
    codeHash = await sha256Hex(code);
  } catch {
    return false;
  }
  try {
    const res = await db
      .prepare(
        'UPDATE telegram_pairing_codes SET used_at = ?2, consumed_by_chat = ?3 WHERE code_hash = ?1 AND used_at IS NULL AND expires_at > ?2'
      )
      .bind(codeHash, nowIso, String(chatId))
      .run();
    const changed = res && res.meta ? res.meta.changes : 0;
    return changed === 1;
  } catch {
    return false;
  }
}

/**
 * Pending (live, unused) pairing info for the dashboard: lets a refresh
 * restore the "link in progress" state WITHOUT ever exposing the raw code
 * (only its hash is stored — the code itself is shown once at issue time).
 */
export async function readPendingPairing(db) {
  try {
    const row = await db
      .prepare(
        "SELECT COUNT(*) AS n, MAX(expires_at) AS exp FROM telegram_pairing_codes WHERE used_at IS NULL AND expires_at > ?1"
      )
      .bind(new Date().toISOString())
      .first();
    if (row && typeof row.n === 'number' && row.n > 0) {
      return { pending: true, expiresAt: typeof row.exp === 'string' ? row.exp : null };
    }
  } catch {}
  return { pending: false, expiresAt: null };
}

/* ---------- webhook verification ---------- */

/**
 * Verify Telegram's secret header. Returns:
 *   true  — header matches the configured secret;
 *   false — header present but wrong (reject with 403);
 *   null  — no secret configured (webhook closed; treat as 404).
 */
export function verifyWebhookSecret(request, env) {
  const configured = env && typeof env.TELEGRAM_WEBHOOK_SECRET === 'string' ? env.TELEGRAM_WEBHOOK_SECRET : '';
  if (!configured) return null;
  const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  return got !== '' && safeCompareStrings(got, configured);
}

/* ---------- Bot API transport ---------- */

function isRetryableStatus(status) {
  return status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599);
}

/**
 * Minimal Bot API POST with a tight timeout. Never throws for transport
 * errors — returns { ok:false, retryable, error }. Never logs the token;
 * callers must not put customer PII in `params` logs either.
 */
export async function callTelegramApi(token, method, params, timeoutMs = 8000, fetchFn = fetch) {
  if (typeof token !== 'string' || !token || typeof method !== 'string' || !/^[A-Za-z]+$/.test(method)) {
    return { ok: false, retryable: false, error: 'bad_call' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, timeoutMs);
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
      signal: controller.signal,
    }).catch(() => null);
    if (!res) return { ok: false, retryable: true, error: 'network' };
    let data = null;
    try {
      data = await res.json();
    } catch {
      return { ok: false, retryable: isRetryableStatus(res.status), error: `http_${res.status}` };
    }
    if (res.ok && data && data.ok === true) return { ok: true, result: data.result ?? null };
    const code = data && typeof data.error_code === 'number' ? data.error_code : res.status;
    const desc = data && typeof data.description === 'string' ? data.description.slice(0, 200) : `http_${res.status}`;
    const retryAfter = data && data.parameters && typeof data.parameters.retry_after === 'number'
      ? data.parameters.retry_after
      : null;
    return { ok: false, retryable: isRetryableStatus(code), error: desc, retryAfter };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return { ok: false, retryable: true, error: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Escape for parse_mode HTML (order text uses this). */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ---------- Phase 4: new-order notification (View button only) ---------- */

const TYPE_LABEL = { delivery: 'توصيل 🛵', pickup: 'استلام 🏃', dinein: 'صالة 🍽️' };

function fmtMoney(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.round(v).toLocaleString('en-US');
}

function pickName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const ar = typeof obj.ar === 'string' ? obj.ar.trim() : '';
  if (ar) return ar;
  return typeof obj.en === 'string' ? obj.en.trim() : '';
}

/**
 * Format a saved order (cleaned shape from validateOrderInput) as an
 * HTML-parsed Telegram message. Arabic-first, all interpolated values
 * escaped. Caps length defensively for Telegram's 4096-char limit.
 */
export function formatNewOrderMessage(cleaned, orderNumber, currency) {
  const cur = typeof currency === 'string' && currency ? escapeHtml(currency) : '';
  const lines = [];
  lines.push(`🆕 <b>طلب جديد #${Number.isInteger(orderNumber) ? orderNumber : '?'}</b>`);
  const typeLabel = TYPE_LABEL[cleaned.type] || escapeHtml(String(cleaned.type || ''));
  lines.push(`النوع: ${typeLabel}`);
  lines.push(`الزبون: ${escapeHtml(cleaned.name || '-')}`);
  lines.push(`الهاتف: <code>${escapeHtml(cleaned.phone || '-')}</code>`);
  if (cleaned.type === 'delivery' && cleaned.address) {
    lines.push(`العنوان: ${escapeHtml(cleaned.address)}`);
  }
  if (cleaned.type === 'dinein' && cleaned.table) {
    lines.push(`الطاولة: ${escapeHtml(cleaned.table)}`);
  }
  lines.push('');
  lines.push('<b>الأصناف:</b>');
  const items = Array.isArray(cleaned.items) ? cleaned.items : [];
  const shown = items.slice(0, 20);
  for (const it of shown) {
    const name = escapeHtml(pickName(it.name) || it.id || 'صنف');
    const qty = Number.isFinite(it.qty) ? it.qty : 0;
    const unit = typeof it.unitPrice === 'number' ? it.unitPrice : 0;
    const extras = [];
    if (it.variantName && pickName(it.variantName)) extras.push(escapeHtml(pickName(it.variantName)));
    if (Array.isArray(it.addonNames)) {
      for (const a of it.addonNames) {
        const n = pickName(a);
        if (n) extras.push('+' + escapeHtml(n));
      }
    }
    const extra = extras.length ? ` (${extras.join('، ')})` : '';
    lines.push(`• ${name}${extra} × ${qty} = ${fmtMoney(unit * qty)}${cur ? ' ' + cur : ''}`);
  }
  if (items.length > shown.length) {
    lines.push(`… +${items.length - shown.length} أصناف أخرى`);
  }
  lines.push('');
  lines.push(`المجموع الفرعي: ${fmtMoney(cleaned.subtotal)}${cur ? ' ' + cur : ''}`);
  if (cleaned.deliveryFee) {
    lines.push(`التوصيل: ${fmtMoney(cleaned.deliveryFee)}${cur ? ' ' + cur : ''}`);
  }
  lines.push(`<b>الإجمالي: ${fmtMoney(cleaned.total)}${cur ? ' ' + cur : ''}</b>`);
  if (cleaned.notes) {
    lines.push('');
    lines.push(`📝 ملاحظات: ${escapeHtml(cleaned.notes)}`);
  }
  const text = lines.join('\n');
  return text.length > 4000 ? text.slice(0, 4000) + '…' : text;
}

/** Single View button (URL — opens the dashboard behind admin login). */
export function buildOrderKeyboard(adminUrl) {
  return {
    inline_keyboard: [[{ text: '👁 عرض الطلب', url: String(adminUrl || '') }]],
  };
}

const RETRY_DELAY_CAP_MS = 30 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function writeLedger(db, row) {
  const nowIso = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO telegram_notifications
           (order_id, order_number, status, attempts, last_error, created_at, updated_at, sent_at)
         VALUES (?1, ?2, 'pending', 0, NULL, ?3, ?3, NULL)
         ON CONFLICT(order_id) DO NOTHING`
      )
      .bind(row.orderId, row.orderNumber, nowIso)
      .run();
  } catch {}
  try {
    const ex = await db
      .prepare('SELECT status FROM telegram_notifications WHERE order_id = ?1')
      .bind(row.orderId)
      .first();
    return ex && typeof ex.status === 'string' ? ex.status : 'pending';
  } catch {
    return 'pending';
  }
}

async function stampLedger(db, orderId, status, attempts, lastError, sent) {
  try {
    await db
      .prepare(
        'UPDATE telegram_notifications SET status = ?2, attempts = ?3, last_error = ?4, updated_at = ?5, sent_at = ?6 WHERE order_id = ?1'
      )
      .bind(orderId, status, attempts, lastError, new Date().toISOString(), sent ? new Date().toISOString() : null)
      .run();
  } catch {}
}

/**
 * Send the new-order notification. NEVER throws and NEVER fails order
 * creation — every failure path returns { sent: 0, reason }.
 *
 * Dedupe: the ledger's order_id PK — a repeated event for an order already
 * marked 'sent' is skipped. Not 'sent' (pending/failed/ledger-unreadable)
 * proceeds, so a rare double-delivery is possible; the message carries no
 * side effects (read-only URL button), making dupes harmless.
 *
 * Retry: ONE inline retry for retryable errors (429/5xx/network), honoring
 * Telegram's retry_after capped at 30 s. Anything else is recorded as
 * failed with attempts + last_error for the admin status view.
 */
export async function notifyNewOrderTelegram(db, token, { orderId, orderNumber, cleaned, storeName, currency, adminUrl }) {
  const fail = (reason) => ({ sent: 0, reason });
  try {
    if (typeof token !== 'string' || !token) return fail('no_token');
    if (!db || typeof orderId !== 'string' || !orderId) return fail('bad_order');
    let link = null;
    try {
      link = await readTelegramLink(db);
    } catch {
      return fail('link_read_error');
    }
    if (!link) return fail('unlinked');

    const prior = await writeLedger(db, { orderId, orderNumber });
    if (prior === 'sent') return fail('duplicate');

    const prefix = typeof storeName === 'string' && storeName ? escapeHtml(storeName) + '\n' : '';
    const text = prefix + formatNewOrderMessage(cleaned || {}, orderNumber, currency);
    const params = {
      chat_id: link.chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: buildOrderKeyboard(adminUrl),
    };

    let attempts = 0;
    let res = await callTelegramApi(token, 'sendMessage', params);
    attempts += 1;
    if (!res.ok && res.retryable) {
      const waitMs = res.retryAfter && Number.isFinite(res.retryAfter)
        ? Math.min(Math.max(res.retryAfter, 1), 30) * 1000
        : 3000;
      try {
        await sleep(Math.min(waitMs, RETRY_DELAY_CAP_MS));
      } catch {}
      res = await callTelegramApi(token, 'sendMessage', params);
      attempts += 1;
    }
    if (res.ok) {
      await stampLedger(db, orderId, 'sent', attempts, null, true);
      return { sent: 1 };
    }
    await stampLedger(db, orderId, 'failed', attempts, String(res.error || 'send_failed').slice(0, 200), false);
    return fail(String(res.error || 'send_failed').slice(0, 60));
  } catch {
    return fail('error');
  }
}

/** Latest ledger row for the admin status view (or null). */
export async function readLastTelegramNotification(db) {
  try {
    const row = await db
      .prepare('SELECT order_number, status, attempts, updated_at, sent_at FROM telegram_notifications ORDER BY updated_at DESC LIMIT 1')
      .first();
    if (!row) return null;
    return {
      orderNumber: row.order_number,
      status: row.status,
      attempts: row.attempts,
      updatedAt: row.updated_at || null,
      sentAt: row.sent_at || null,
    };
  } catch {
    return null;
  }
}
