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
 *    service_config under TELEGRAM_CONFIG_KEY (service_config/service_secrets
 *    pattern from migration 0011/0012).
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
import { unitLabel } from './pricing.js';
import { safeCompareStrings } from './session.js';
import { findOrderById, updateOrderStatus } from './repositories/orders.repo.js';
import { notifyOrderStatus } from './push.js';

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
 * Bidi isolation, explicit code points (minifier-safe, no invisible
 * literals): LRI (U+2066) ... PDI (U+2069). Wraps every Latin/number run
 * (phone, price, #number) so it stays glued LTR inside RTL text.
 * Without this, Telegram renders mixed lines half-right/half-left —
 * digits jump sides and the line looks broken. Telegram's HTML subset
 * has no dir= support, so isolates are the fix.
 */
const BIDI_LRI = String.fromCharCode(0x2066);
const BIDI_PDI = String.fromCharCode(0x2069);
function bidi(s) {
  return `${BIDI_LRI}${String(s ?? '')}${BIDI_PDI}`;
}

/**
 * Accuracy bar for a DELIVERY pin, in meters (delivery apps treat a
 * cell-tower fix ~300m+ as unusable and GPS/WiFi ~5-100m as good).
 * A pin WORSE than this is never presented as "exact" — it falls back
 * to the written address (or an explicitly approximate pin).
 */
export const MAPS_ACCURACY_OK_M = 250;

/**
 * Map link for a delivery order.
 * - Pinned location with a GOOD fix -> EXACT pin URL (`maps?q=lat,lng&z=18`),
 *   never the `search/?api=1&query=` form: search snaps the pin to the
 *   nearest named place and its address card reads WRONG (the reported
 *   bug). Same form as the customer-facing link in the checkout sheet.
 * - Coarse fix (cell tower, urban canyon) or no pin -> address-text search
 *   (or the raw pin as last resort), honestly labeled approximate.
 * Rendered as a short pretty anchor (never a bare long URL).
 * Returns { url, precise } or null.
 */
export function buildMapsLink(cleaned) {
  if (!cleaned || cleaned.type !== 'delivery') return null;
  const loc = cleaned.location;
  const hasCoords = loc &&
    typeof loc.lat === 'number' && Number.isFinite(loc.lat) &&
    typeof loc.lng === 'number' && Number.isFinite(loc.lng) &&
    loc.lat >= -90 && loc.lat <= 90 && loc.lng >= -180 && loc.lng <= 180;
  const acc = hasCoords && typeof loc.accuracy === 'number' && Number.isFinite(loc.accuracy) ? loc.accuracy : null;
  const sharp = hasCoords && (acc === null || acc <= MAPS_ACCURACY_OK_M);
  if (sharp) {
    return {
      url: `https://www.google.com/maps?q=${loc.lat},${loc.lng}&z=18`,
      precise: true,
    };
  }
  if (typeof cleaned.address === 'string' && cleaned.address.trim()) {
    return {
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleaned.address.trim())}`,
      precise: false,
    };
  }
  if (hasCoords) {
    return {
      url: `https://www.google.com/maps?q=${loc.lat},${loc.lng}&z=15`,
      precise: false,
    };
  }
  return null;
}

/**
 * Format a saved order (cleaned shape from validateOrderInput) as an
 * HTML-parsed Telegram message. Arabic-first, bold labels for the
 * important bits, every LTR run bidi-isolated, all interpolated values
 * escaped. Caps length defensively for Telegram's 4096-char limit.
 */
export function formatNewOrderMessage(cleaned, orderNumber, currency) {
  const cur = typeof currency === 'string' && currency ? escapeHtml(currency) : '';
  const money = (n) => (cur ? `${bidi(fmtMoney(n))} ${cur}` : bidi(fmtMoney(n)));
  const lines = [];
  lines.push(`🆕 <b>طلب جديد ${bidi(`#${Number.isInteger(orderNumber) ? orderNumber : '?'}`)}</b>`);
  const typeLabel = TYPE_LABEL[cleaned.type] || escapeHtml(String(cleaned.type || ''));
  lines.push(`<b>النوع:</b> ${typeLabel}`);
  lines.push(`<b>الزبون:</b> ${escapeHtml(cleaned.name || '-')}`);
  lines.push(`<b>الهاتف:</b> <code>${bidi(escapeHtml(cleaned.phone || '-'))}</code>`);
  if (cleaned.type === 'delivery' && cleaned.address) {
    lines.push(`<b>العنوان:</b> ${escapeHtml(cleaned.address)}`);
    const maps = buildMapsLink(cleaned);
    if (maps) {
      const hasAddress = typeof cleaned.address === 'string' && cleaned.address.trim() !== '';
      const anchor = maps.precise
        ? '📍 الموقع الدقيق على الخريطة'
        : hasAddress ? '🔍 بحث تقريبي عن العنوان' : '📍 موقع تقريبي — تحقق مع الزبون';
      lines.push(`<a href="${escapeHtml(maps.url)}">${anchor}</a>`);
    }
  }
  if (cleaned.type === 'dinein' && cleaned.table) {
    lines.push(`<b>الطاولة:</b> ${bidi(escapeHtml(cleaned.table))}`);
  }
  lines.push('');
  lines.push('<b>الأصناف:</b>');
  const items = Array.isArray(cleaned.items) ? cleaned.items : [];
  const shown = items.slice(0, 20);
  for (const it of shown) {
    const name = escapeHtml(pickName(it.name) || it.id || 'صنف');
    const qty = Number.isFinite(it.qty) ? it.qty : 0;
    const unit = typeof it.unitPrice === 'number' ? it.unitPrice : 0;
    // Pricing unit word ("2 دستتين", not bare "× 2") — old rows without a
    // stored unit fall back to the bare quantity, never a wrong word.
    let qtyWord = bidi(qty);
    try {
      if (typeof it.unit === 'string' && it.unit) {
        qtyWord = `${bidi(qty)} ${escapeHtml(unitLabel(it.unit, qty, 'ar'))}`;
      }
    } catch {}
    const extras = [];
    if (it.variantName && pickName(it.variantName)) extras.push(escapeHtml(pickName(it.variantName)));
    if (Array.isArray(it.addonNames)) {
      for (const a of it.addonNames) {
        const n = pickName(a);
        if (n) extras.push('+' + escapeHtml(n));
      }
    }
    const extra = extras.length ? ` (${extras.join('، ')})` : '';
    lines.push(`• ${name}${extra} × ${qtyWord} = ${money(unit * qty)}`);
  }
  if (items.length > shown.length) {
    lines.push(`… ${bidi(`+${items.length - shown.length}`)} أصناف أخرى`);
  }
  lines.push('');
  lines.push(`المجموع الفرعي: ${money(cleaned.subtotal)}`);
  if (cleaned.deliveryFee) {
    lines.push(`التوصيل: ${money(cleaned.deliveryFee)}`);
  }
  lines.push(`<b>الإجمالي: ${money(cleaned.total)}</b>`);
  if (cleaned.notes) {
    lines.push('');
    lines.push(`📝 <b>ملاحظات:</b> ${escapeHtml(cleaned.notes)}`);
  }
  const text = lines.join('\n');
  return text.length > 4000 ? text.slice(0, 4000) + '…' : text;
}

/**
 * Order keyboard: row 1 = View (URL, opens the dashboard behind admin
 * login — zero auth surface); row 2 = Start-preparing / Cancel (callbacks,
 * fully validated server-side in handleOrderCallback).
 * "بدء التحضير" = the OWNER confirming receipt: the kitchen saw the
 * order and is preparing it -> status `confirmed` (DB value kept;
 * everywhere the customer looks it reads "قيد التحضير / Preparing",
 * NOT delivered).
 * Delivery is confirmed separately: the customer taps "received" in the
 * bell/tracking (or the 12h auto-complete) -> `completed`. Old tg:rcv:*
 * callbacks from already-sent messages still validate and complete —
 * they are just never attached to NEW messages. callback_data is capped
 * by Telegram at 64 bytes: prefix + 36-char order id fits.
 */
export function buildOrderKeyboard(adminUrl, orderId) {
  const rows = [[{ text: '👁 عرض الطلب', url: String(adminUrl || '') }]];
  if (typeof orderId === 'string' && orderId) {
    rows.push([
      { text: '🔥 بدء التحضير', callback_data: `tg:cfm:${orderId}` },
      { text: '❌ إلغاء', callback_data: `tg:cnl:${orderId}` },
    ]);
  }
  return { inline_keyboard: rows };
}

/* ---------- Phase 5: Confirm / Cancel callbacks ---------- */

export const ORDER_ACTIONS = { cfm: 'confirmed', cnl: 'cancelled', rcv: 'completed' };
/**
 * Telegram may only move orders forward along these edges (admin model
 * subset — no new status: "received" IS completed). Terminal states
 * (completed/cancelled) accept nothing further.
 */
const TG_TRANSITIONS = {
  new: ['confirmed', 'cancelled', 'completed'],
  confirmed: ['cancelled', 'completed'],
};

const CONFIRMED_BANNER = '🔥 الطلب قيد التحضير';
const RECEIVED_BANNER = '📦 تم الاستلام';

export function parseOrderCallback(data) {
  if (typeof data !== 'string') return null;
  const m = /^tg:(cfm|cnl|rcv):([A-Za-z0-9-]{1,128})$/.exec(data.trim());
  if (!m) return null;
  return { action: m[1], orderId: m[2], status: ORDER_ACTIONS[m[1]] };
}

export function isTelegramTransitionAllowed(from, to) {
  return Array.isArray(TG_TRANSITIONS[from]) && TG_TRANSITIONS[from].includes(to);
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

async function stampLedger(db, orderId, status, attempts, lastError, sent, refs) {
  try {
    const r = refs && typeof refs === 'object' ? refs : {};
    const chatId = Number.isInteger(r.chatId) ? r.chatId : null;
    const messageId = Number.isInteger(r.messageId) ? r.messageId : null;
    const messageText = typeof r.messageText === 'string' && r.messageText ? r.messageText.slice(0, 4000) : null;
    await db
      .prepare(
        'UPDATE telegram_notifications SET status = ?2, attempts = ?3, last_error = ?4, updated_at = ?5, sent_at = ?6, chat_id = COALESCE(?7, chat_id), message_id = COALESCE(?8, message_id), message_text = COALESCE(?9, message_text) WHERE order_id = ?1'
      )
      .bind(orderId, status, attempts, lastError, new Date().toISOString(), sent ? new Date().toISOString() : null, chatId, messageId, messageText)
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
      reply_markup: buildOrderKeyboard(adminUrl, orderId),
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
      const sentMsg = res.result && typeof res.result === 'object' ? res.result : null;
      const sentId = sentMsg && Number.isInteger(sentMsg.message_id) ? sentMsg.message_id : null;
      await stampLedger(db, orderId, 'sent', attempts, null, true, {
        chatId: link.chatId,
        messageId: sentId,
        messageText: text,
      });
      return { sent: 1 };
    }
    await stampLedger(db, orderId, 'failed', attempts, String(res.error || 'send_failed').slice(0, 200), false);
    return fail(String(res.error || 'send_failed').slice(0, 60));
  } catch {
    return fail('error');
  }
}

/**
 * Rebuild the full order message (with HTML links) from the DB row.
 * Needed because Telegram hands callbacks only the PLAIN text of the
 * message — re-stamping that would permanently kill the maps link and
 * bold formatting. Rebuilding from the saved order keeps every tap target
 * alive after an action. env is optional (currency falls back to '').
 * Returns the HTML text or null when the row cannot be rebuilt.
 */
export async function rebuildOrderMessage(db, env, order) {
  try {
    if (!db || !order || typeof order !== 'object') return null;
    let items = [];
    try {
      const parsed = JSON.parse(order.items_json || '[]');
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      return null;
    }
    let currency = '';
    try {
      const kv = env && env.MENU_KV ? env.MENU_KV : null;
      const menu = kv ? await kv.get('menu', { type: 'json' }) : null;
      const cur = menu && menu.settings && menu.settings.currency;
      if (cur && typeof cur === 'object') currency = String(cur.en || cur.ar || '');
    } catch {}
    const cleaned = {
      type: order.type,
      name: order.customer_name || '',
      phone: order.customer_phone || '',
      address: order.customer_address || null,
      table: order.customer_table || null,
      notes: order.notes || null,
      items,
      subtotal: order.subtotal,
      // camelCase: formatNewOrderMessage reads deliveryFee (snake_case here
      // used to silently drop the delivery line after Confirm was pressed).
      deliveryFee: order.delivery_fee,
      total: order.total,
      lang: order.lang,
      location: (order.location_lat !== null && order.location_lat !== undefined &&
        order.location_lng !== null && order.location_lng !== undefined)
        ? { lat: order.location_lat, lng: order.location_lng }
        : null,
    };
    if (!Number.isInteger(order.number)) return null;
    return formatNewOrderMessage(cleaned, order.number, currency);
  } catch {
    return null;
  }
}

/**
 * Handle a Confirm/Cancel button press. NEVER throws — every failure path
 * answers the callback (so the client spinner never hangs) and returns a
 * reason. Validation order: linked chat → known action → order exists →
 * idempotent repeat → allowed transition → write → announce.
 *
 * Only the linked owner chat can act (clicker AND message chat must equal
 * the stored chat_id — usernames never trusted). Terminal states
 * (confirmed/completed/cancelled) reject further Confirm presses; Cancel is
 * allowed from new/confirmed only. The write goes through the same
 * updateOrderStatus repository as the dashboard (one status model).
 */
export async function handleOrderCallback(db, token, { callbackId, clickerId, chatId, messageId, data, messageText, env }) {
  const noop = (reason) => ({ handled: false, reason });
  const answer = async (text) => {
    if (!token || typeof callbackId !== 'string' || !callbackId) return;
    try {
      await callTelegramApi(token, 'answerCallbackQuery', {
        callback_query_id: callbackId,
        text: String(text || '').slice(0, 200),
      });
    } catch {}
  };
  try {
    if (!db || !token) {
      await answer('Unavailable — try again.');
      return noop('misconfigured');
    }
    let link = null;
    try {
      link = await readTelegramLink(db);
    } catch {
      link = null;
    }
    if (!link || clickerId !== link.chatId || chatId !== link.chatId) {
      await answer('Not linked.');
      return noop('unauthorized');
    }
    const parsed = parseOrderCallback(data);
    if (!parsed) {
      await answer('Unknown action.');
      return noop('bad_data');
    }
    let order = null;
    try {
      order = await findOrderById(db, parsed.orderId);
    } catch {
      order = null;
    }
    if (!order) {
      await answer('Order not found.');
      return noop('not_found');
    }
    const current = order.status;
    if (current === parsed.status) {
      const already = parsed.status === 'confirmed'
        ? 'Already confirmed ✅'
        : parsed.status === 'completed' ? 'Already marked received 📦' : 'Already cancelled.';
      await answer(already);
      return { handled: true, noop: true, status: current };
    }
    if (!isTelegramTransitionAllowed(current, parsed.status)) {
      await answer('This order can no longer be updated.');
      return noop('bad_transition');
    }
    let updated = null;
    try {
      updated = await updateOrderStatus(db, parsed.orderId, parsed.status);
    } catch {
      updated = null;
    }
    if (!updated) {
      await answer('Could not update — try again.');
      return noop('write_failed');
    }
    const banner = parsed.status === 'confirmed'
      ? CONFIRMED_BANNER
      : parsed.status === 'completed' ? RECEIVED_BANNER : '❌ تم إلغاء الطلب';
    // Rebuild the FULL message (with HTML links) from the DB row: the
    // callback only carries plain text, and re-stamping that would kill
    // the maps link and all formatting. Falls back to plain text only
    // when the rebuild fails.
    let rebuilt = null;
    try {
      rebuilt = await rebuildOrderMessage(db, env, order);
    } catch {
      rebuilt = null;
    }
    // Heal pre-0015 ledger rows: remember where this message lives so a
    // later dashboard change can sync back to it. Store the rebuilt HTML
    // (links intact), never the plain callback text. updated_at untouched —
    // the admin "last notification" view keeps send order.
    try {
      await db
        .prepare(
          'UPDATE telegram_notifications SET chat_id = COALESCE(chat_id, ?2), message_id = COALESCE(message_id, ?3), message_text = COALESCE(message_text, ?4) WHERE order_id = ?1'
        )
        .bind(
          parsed.orderId,
          Number.isInteger(chatId) ? chatId : null,
          Number.isInteger(messageId) ? messageId : null,
          typeof rebuilt === 'string' && rebuilt
            ? rebuilt.slice(0, 4000)
            : (typeof messageText === 'string' && messageText ? messageText.slice(0, 4000) : null)
        )
        .run();
    } catch {}
    await answer(banner);
    // Freeze the buttons (no double-tap) + stamp the status on the message.
    try {
      await callTelegramApi(token, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
    } catch {}
    try {
      const base = typeof rebuilt === 'string' && rebuilt
        ? rebuilt
        : (typeof messageText === 'string' && messageText ? messageText : `طلب #${order.number ?? ''}`);
      const stamped = `${base}\n\n${banner}`.slice(0, 4000);
      await callTelegramApi(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: stamped,
        parse_mode: 'HTML',
      });
    } catch {}
    // Owner -> customer loop (same as the dashboard PATCH path): best-effort.
    try {
      await notifyOrderStatus(db, {
        storeName: '',
        orderId: parsed.orderId,
        orderNumber: order.number,
        status: parsed.status,
        lang: order.lang === 'ar' ? 'ar' : 'en',
        trackUrl: '',
        subject: undefined,
      });
    } catch {}
    return { handled: true, status: parsed.status };
  } catch {
    return noop('error');
  }
}

const STATUS_BANNERS = {
  confirmed: '🔥 الطلب قيد التحضير',
  completed: '📦 تم الاستلام',
  cancelled: '❌ تم إلغاء الطلب',
};

/** Strip a previously stamped status banner (lets 'new' restore cleanly). */
function stripBanner(text) {
  let out = String(text ?? '');
  // Legacy banners (pre-preparing wording) still strip cleanly on reopen.
  const legacy = ['✅ تم تأكيد الطلب', '✅ تم استلام الطلب — جارٍ التحضير'];
  for (const b of [...Object.values(STATUS_BANNERS), ...legacy]) {
    const tail = `\n\n${b}`;
    if (out.endsWith(tail)) out = out.slice(0, -tail.length);
  }
  return out;
}

/**
 * Site -> Telegram sync: a dashboard status change stamps the SAME order
 * message the owner got at order time (two-way sync with the buttons).
 * Best-effort and silent — NEVER throws, NEVER blocks the dashboard action:
 *   - no ledger row / no message refs (pre-0015 message, unlinked chat,
 *     deleted message) -> skipped with a reason, no error surfaced.
 *   - confirmed/completed/cancelled -> banner stamped + buttons frozen.
 *   - new (reopened) -> buttons restored so the owner can act again.
 */
export async function syncOrderStatusToTelegram(db, token, { orderId, status, adminUrl }) {
  const skip = (reason) => ({ sent: 0, reason });
  try {
    if (!db || typeof token !== 'string' || !token) return skip('misconfigured');
    if (typeof orderId !== 'string' || !orderId) return skip('bad_order');
    if (typeof status !== 'string' || !(status === 'new' || STATUS_BANNERS[status])) return skip('bad_status');
    let row = null;
    try {
      row = await db
        .prepare('SELECT chat_id, message_id, message_text FROM telegram_notifications WHERE order_id = ?1')
        .bind(orderId)
        .first();
    } catch {
      return skip('ledger_unreadable');
    }
    if (!row || !Number.isInteger(row.chat_id) || !Number.isInteger(row.message_id)) {
      return skip('no_message');
    }
    const chatId = row.chat_id;
    const messageId = row.message_id;
    if (status === 'new') {
      try {
        await callTelegramApi(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: buildOrderKeyboard(adminUrl, orderId),
        });
      } catch {}
      return { sent: 1 };
    }
    const banner = STATUS_BANNERS[status];
    const base = stripBanner(typeof row.message_text === 'string' && row.message_text ? row.message_text : '');
    if (base) {
      try {
        await callTelegramApi(token, 'editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: `${base}\n\n${banner}`.slice(0, 4000),
          parse_mode: 'HTML',
        });
      } catch {}
    }
    try {
      await callTelegramApi(token, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
    } catch {}
    return { sent: 1 };
  } catch {
    return skip('error');
  }
}

/**
 * Owner ping on customer self-confirm (bell / tracking page "received").
 * Best-effort and silent — NEVER throws. Only the linked owner chat gets
 * it (customer name goes to the owner only, never to a public surface).
 */
export async function notifyOwnerReceived(db, token, { orderNumber, customerName }) {
  const skip = (reason) => ({ sent: 0, reason });
  try {
    if (!db || typeof token !== 'string' || !token) return skip('misconfigured');
    if (!Number.isInteger(orderNumber)) return skip('bad_order');
    let link = null;
    try {
      link = await readTelegramLink(db);
    } catch {
      return skip('link_unreadable');
    }
    if (!link) return skip('unlinked');
    const name = typeof customerName === 'string' && customerName.trim()
      ? escapeHtml(customerName.trim().slice(0, 60))
      : 'الزبون';
    const text = `📦 ${name} أكّد استلام الطلب ${bidi(`#${orderNumber}`)} بنجاح ✅`;
    const res = await callTelegramApi(token, 'sendMessage', {
      chat_id: link.chatId,
      text,
      parse_mode: 'HTML',
    });
    return res.ok ? { sent: 1 } : skip(String(res.error || 'send_failed').slice(0, 60));
  } catch {
    return skip('error');
  }
}

/**
 * Owner ping on SYSTEM auto-complete (12h without customer confirm).
 * Best-effort and silent — NEVER throws. Same channel as the customer
 * confirm ping, distinct wording so the owner knows the system did it.
 */
export async function notifyOwnerAutoCompleted(db, token, { orderNumber, customerName }) {
  const skip = (reason) => ({ sent: 0, reason });
  try {
    if (!db || typeof token !== 'string' || !token) return skip('misconfigured');
    if (!Number.isInteger(orderNumber)) return skip('bad_order');
    let link = null;
    try {
      link = await readTelegramLink(db);
    } catch {
      return skip('link_unreadable');
    }
    if (!link) return skip('unlinked');
    const name = typeof customerName === 'string' && customerName.trim()
      ? escapeHtml(customerName.trim().slice(0, 60))
      : 'الزبون';
    const text = `⏰ النظام علّم الطلب ${bidi(`#${orderNumber}`)} (${name}) مكتمل تلقائيًا — مرت 12 ساعة بدون تأكيد استلام ✅`;
    const res = await callTelegramApi(token, 'sendMessage', {
      chat_id: link.chatId,
      text,
      parse_mode: 'HTML',
    });
    return res.ok ? { sent: 1 } : skip(String(res.error || 'send_failed').slice(0, 60));
  } catch {
    return skip('error');
  }
}

/**
 * Owner ping on CUSTOMER self-cancel (bell/tracking "cancel order").
 * Best-effort and silent — NEVER throws. Mirror of notifyOwnerReceived.
 */
export async function notifyOwnerCustomerCancelled(db, token, { orderNumber, customerName }) {
  const skip = (reason) => ({ sent: 0, reason });
  try {
    if (!db || typeof token !== 'string' || !token) return skip('misconfigured');
    if (!Number.isInteger(orderNumber)) return skip('bad_order');
    let link = null;
    try {
      link = await readTelegramLink(db);
    } catch {
      return skip('link_unreadable');
    }
    if (!link) return skip('unlinked');
    const name = typeof customerName === 'string' && customerName.trim()
      ? escapeHtml(customerName.trim().slice(0, 60))
      : 'الزبون';
    const text = `❌ ${name} ألغى الطلب ${bidi(`#${orderNumber}`)}`;
    const res = await callTelegramApi(token, 'sendMessage', {
      chat_id: link.chatId,
      text,
      parse_mode: 'HTML',
    });
    return res.ok ? { sent: 1 } : skip(String(res.error || 'send_failed').slice(0, 60));
  } catch {
    return skip('error');
  }
}

/**
 * Owner ping when the 2-minute customer-cancel window lapses with the
 * order still `new`: the order is now final — proceed normally.
 * Best-effort and silent — NEVER throws.
 */
export async function notifyOwnerOrderLocked(db, token, { orderNumber, customerName }) {
  const skip = (reason) => ({ sent: 0, reason });
  try {
    if (!db || typeof token !== 'string' || !token) return skip('misconfigured');
    if (!Number.isInteger(orderNumber)) return skip('bad_order');
    let link = null;
    try {
      link = await readTelegramLink(db);
    } catch {
      return skip('link_unreadable');
    }
    if (!link) return skip('unlinked');
    const name = typeof customerName === 'string' && customerName.trim()
      ? escapeHtml(customerName.trim().slice(0, 60))
      : 'الزبون';
    const text = `🔒 الطلب ${bidi(`#${orderNumber}`)} (${name}) أصبح نهائيًا — انتهت مهلة الإلغاء، جاهز للتنفيذ ✅`;
    const res = await callTelegramApi(token, 'sendMessage', {
      chat_id: link.chatId,
      text,
      parse_mode: 'HTML',
    });
    return res.ok ? { sent: 1 } : skip(String(res.error || 'send_failed').slice(0, 60));
  } catch {
    return skip('error');
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
