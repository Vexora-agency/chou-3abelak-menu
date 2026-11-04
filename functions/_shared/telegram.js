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
import { unitLabel } from './pricing.js';
import { safeCompareStrings } from './session.js';
import { findOrderById, countActiveKitchenOrders, updateOrderStatus } from './repositories/orders.repo.js';
import { orderDistanceKm, orderingEtaOrDefaults } from './eta.js';
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
 * Returns { code, expiresAt, role } — the raw code is shown ONCE to the admin.
 * role is 'owner' (default, legacy) or 'delivery' (crew codes). Extra field
 * is additive: existing `const { code, expiresAt } = ...` callers keep working.
 */
export async function issuePairingCode(db, role = 'owner') {
  const normRole = role === 'delivery' ? 'delivery' : 'owner';
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
  try {
    await db
      .prepare('INSERT INTO telegram_pairing_codes (code_hash, created_at, expires_at, used_at, consumed_by_chat, role) VALUES (?1, ?2, ?3, NULL, NULL, ?4)')
      .bind(codeHash, createdAt, expiresAt, normRole)
      .run();
  } catch {
    // Pre-0026 DB without the role column: legacy insert still works
    // (role defaults to 'owner' once the migration lands).
    await db
      .prepare('INSERT INTO telegram_pairing_codes (code_hash, created_at, expires_at, used_at, consumed_by_chat) VALUES (?1, ?2, ?3, NULL, NULL)')
      .bind(codeHash, createdAt, expiresAt)
      .run();
  }
  return { code, expiresAt, role: normRole };
}

/**
 * Atomically consume a code for a chat. Returns { role } on success.
 * Returns false for expired / reused / unknown identically (no oracle).
 * The { role } shape is truthy like the old `true`, so legacy
 * `if (!consumed)` gates keep working; callers needing the role read
 * `consumed.role` ('owner' default, 'delivery' for crew codes).
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
    if (changed !== 1) return false;
  } catch {
    return false;
  }
  try {
    const row = await db
      .prepare('SELECT role FROM telegram_pairing_codes WHERE code_hash = ?1')
      .bind(codeHash)
      .first();
    const r = row && typeof row.role === 'string' ? row.role : 'owner';
    return { role: r === 'delivery' ? 'delivery' : 'owner' };
  } catch {
    return { role: 'owner' };
  }
}

/* ---------- delivery-crew chats (multi-chat fan-out, migration 0026) ---------- */

/**
 * List linked delivery chats: [{ chatId, label, linkedAt }].
 * Best-effort, never throws — returns [] when unlinked/unmigrated.
 */
export async function listDeliveryChats(db) {
  try {
    if (!db) return [];
    const res = await db
      .prepare('SELECT chat_id, label, linked_at FROM telegram_chats WHERE role = ?1 ORDER BY chat_id ASC')
      .bind('delivery')
      .all();
    const rows = res && Array.isArray(res.results) ? res.results : [];
    const out = [];
    for (const r of rows) {
      if (!r || !Number.isInteger(r.chat_id)) continue;
      out.push({
        chatId: r.chat_id,
        label: typeof r.label === 'string' && r.label ? r.label : null,
        linkedAt: typeof r.linked_at === 'string' ? r.linked_at : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Persist a delivery link (INSERT OR REPLACE). Best-effort, never throws.
 */
export async function saveDeliveryLink(db, chatId, label = null) {
  try {
    if (!db || !Number.isInteger(chatId)) return false;
    const nowIso = new Date().toISOString();
    const lbl = typeof label === 'string' && label.trim() ? label.trim().slice(0, 120) : null;
    await db
      .prepare('INSERT OR REPLACE INTO telegram_chats (chat_id, role, label, linked_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(chatId, 'delivery', lbl, nowIso, nowIso)
      .run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a delivery link. Best-effort, never throws.
 * Order copies (telegram_order_chats) are kept for audit; fan-out stops
 * because it reads the live set via listDeliveryChats.
 */
export async function removeDeliveryChat(db, chatId) {
  try {
    if (!db || !Number.isInteger(chatId)) return false;
    await db
      .prepare('DELETE FROM telegram_chats WHERE chat_id = ?1')
      .bind(chatId)
      .run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Record a per-order delivery copy. Best-effort, never throws.
 */
export async function saveDeliveryMessage(db, { orderId, chatId, messageId, messageText, status }) {
  try {
    if (!db || typeof orderId !== 'string' || !orderId || !Number.isInteger(chatId)) return false;
    const mid = Number.isInteger(messageId) ? messageId : null;
    const mtext = typeof messageText === 'string' && messageText ? messageText.slice(0, 4000) : null;
    const st = typeof status === 'string' && status ? status.slice(0, 20) : null;
    await db
      .prepare(
        `INSERT INTO telegram_order_chats (order_id, chat_id, message_id, message_text, status)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(order_id, chat_id) DO UPDATE SET message_id = ?3, message_text = ?4, status = ?5`
      )
      .bind(orderId, chatId, mid, mtext, st)
      .run();
    return true;
  } catch {
    return false;
  }
}

/**
 * List delivery copies for an order: [{ chatId, messageId, messageText, status }].
 * Best-effort, never throws — returns [] when unmigrated/empty.
 */
export async function listOrderDeliveryMessages(db, orderId) {
  try {
    if (!db || typeof orderId !== 'string' || !orderId) return [];
    const res = await db
      .prepare('SELECT chat_id, message_id, message_text, status FROM telegram_order_chats WHERE order_id = ?1')
      .bind(orderId)
      .all();
    const rows = res && Array.isArray(res.results) ? res.results : [];
    const out = [];
    for (const r of rows) {
      if (!r || !Number.isInteger(r.chat_id)) continue;
      out.push({
        chatId: r.chat_id,
        messageId: Number.isInteger(r.message_id) ? r.message_id : null,
        messageText: typeof r.message_text === 'string' ? r.message_text : null,
        status: typeof r.status === 'string' ? r.status : null,
      });
    }
    return out;
  } catch {
    return [];
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
  // Follow-up badge (display-only, never merged): same customer ordered again
  // within minutes — kitchen keeps two separate tickets, this line only tells
  // them to prepare/deliver together. Renders in the first message AND every
  // rebuild (status taps) because it lives in formatNewOrderMessage itself.
  if (cleaned && Number.isInteger(cleaned.parentNumber)) {
    lines.push(`🔁 <b>تابع للطلب ${bidi(`#${cleaned.parentNumber}`)}</b> — نفس الزبون، يُجهَّز معه`);
  }
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
        // Split quantities: `name ×n` ONLY when 0 < count < line qty;
        // full counts (or legacy lines without addonQty) render plain.
        // Zero-count options apply to zero units, so they are hidden.
        // Spicy renders as `حار 🌶️` (no `+`): `• سجق (حار 🌶️) × 2 = …`.
        const hasQty = !!(it.addonQty && typeof it.addonQty === 'object' && !Array.isArray(it.addonQty));
        const lineQty = Number.isFinite(it.qty) ? it.qty : 0;
        const isSpicyExtra = (fid, label) => {
          if (typeof fid === 'string' && fid.trim().toLowerCase() === 'spicy') return true;
          const t = typeof label === 'string' ? label.trim().toLowerCase() : '';
          return t === 'حار' || t === 'سبايسي' || t === 'spicy';
        };
        for (let ai = 0; ai < it.addonNames.length; ai++) {
          const a = it.addonNames[ai];
          const n = pickName(a);
          if (!n) continue;
          const fid = Array.isArray(it.addonIds) ? it.addonIds[ai] : null;
          const spicy = isSpicyExtra(fid, n);
          const base = spicy ? escapeHtml(String(n).trim()) + ' 🌶️' : '+' + escapeHtml(n);
          if (!hasQty) {
            extras.push(base);
            continue;
          }
          const raw = fid && Object.prototype.hasOwnProperty.call(it.addonQty, fid)
            ? it.addonQty[fid]
            : lineQty;
          const c = typeof raw === 'number' && Number.isInteger(raw) ? raw : lineQty;
          if (c === 0) continue;
          if (c === lineQty) {
            extras.push(base);
          } else if (c > 0 && c < lineQty) {
            extras.push(`${base} ×${bidi(escapeHtml(String(c)))}`);
          } else {
            extras.push(base);
          }
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
 * login — zero auth surface); row 2 = action buttons for the CURRENT
 * status (callbacks, fully validated server-side in handleOrderCallback).
 * New orders: Start-preparing / Cancel. Confirmed orders: the kitchen is
 * already preparing -> Mark delivered (customer handoff done) / Cancel.
 * (The old "جاهز / Mark ready" step is removed — no new message ever
 * offers tg:rdy; old in-flight tg:rdy:* callbacks from already-sent
 * messages still validate and move to `ready` for backward compat.)
 * "بدء التحضير" = the OWNER confirming receipt: the kitchen saw the
 * order and is preparing it -> status `confirmed` (DB value kept;
 * everywhere the customer looks it reads "قيد التحضير / Preparing",
 * NOT delivered). The customer tap "received" in the bell/tracking
 * (or the 12h auto-complete, or the owner "تم التسليم" above) ->
 * `completed`. callback_data is capped by Telegram at 64 bytes:
 * prefix + 36-char order id fits.
 */
export function buildOrderKeyboard(adminUrl, orderId, status) {
  const rows = [];
  if (typeof adminUrl === 'string' && adminUrl) {
    rows.push([{ text: '👁 عرض الطلب', url: adminUrl }]);
  }
  if (typeof orderId !== 'string' || !orderId) {
    return { inline_keyboard: rows };
  }
  if (status === 'confirmed') {
    rows.push([
      { text: '📦 تم التسليم', callback_data: `tg:rcv:${orderId}` },
      { text: '❌ إلغاء', callback_data: `tg:cnl:${orderId}` },
    ]);
  } else {
    rows.push([
      { text: '🔥 بدء التحضير', callback_data: `tg:cfm:${orderId}` },
      { text: '❌ إلغاء', callback_data: `tg:cnl:${orderId}` },
    ]);
  }
  return { inline_keyboard: rows };
}

/* ---------- Phase 5: Confirm / Cancel callbacks ---------- */

export const ORDER_ACTIONS = { cfm: 'confirmed', rdy: 'ready', cnl: 'cancelled', rcv: 'completed' };
/**
 * Telegram may only move orders forward along these edges: new is
 * acknowledged, preparation finishes into ready (handoff), receipt
 * completes. Terminal states (completed/cancelled) accept nothing further.
 */
const TG_TRANSITIONS = {
  new: ['confirmed', 'ready', 'cancelled', 'completed'],
  confirmed: ['ready', 'cancelled', 'completed'],
  ready: ['completed', 'cancelled'],
};

const CONFIRMED_BANNER = '🔥 الطلب قيد التحضير';
const RECEIVED_BANNER = '📦 تم الاستلام';
/** Ready banners are type-aware (chosen at stamp time, see readyBannerFor). */
const READY_DELIVERY_BANNER = '🛵 الطلب خارج للتوصيل';
const READY_PICKUP_BANNER = '✅ الطلب جاهز للاستلام';

/** Ready banner by order type: delivery goes out, pickup/dine-in waits. */
export function readyBannerFor(orderType) {
  return orderType === 'delivery' ? READY_DELIVERY_BANNER : READY_PICKUP_BANNER;
}

/** Customer push/sync label for the ready state, by order type. */
export function readyLabelFor(orderType, lang) {
  const isAr = lang === 'ar';
  if (orderType === 'delivery') return isAr ? 'خارج للتوصيل' : 'Out for delivery';
  return isAr ? 'جاهز للاستلام' : 'Ready for pickup';
}

export function parseOrderCallback(data) {
  if (typeof data !== 'string') return null;
  const m = /^tg:(cfm|rdy|cnl|rcv):([A-Za-z0-9-]{1,128})$/.exec(data.trim());
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
      // Delivery-crew fan-out (best-effort, never fails the owner send):
      // same text, no admin-url row, each copy recorded for later sync.
      try {
        const crew = await listDeliveryChats(db);
        if (Array.isArray(crew) && crew.length) {
          const crewKeyboard = buildOrderKeyboard('', orderId);
          for (const dc of crew) {
            try {
              if (!dc || !Number.isInteger(dc.chatId)) continue;
              const cres = await callTelegramApi(token, 'sendMessage', {
                chat_id: dc.chatId,
                text,
                parse_mode: 'HTML',
                reply_markup: crewKeyboard,
              });
              if (cres && cres.ok) {
                const cmsg = cres.result && typeof cres.result === 'object' ? cres.result : null;
                const cid = cmsg && Number.isInteger(cmsg.message_id) ? cmsg.message_id : null;
                await saveDeliveryMessage(db, {
                  orderId,
                  chatId: dc.chatId,
                  messageId: cid,
                  messageText: text,
                  status: 'sent',
                });
              } else {
                await saveDeliveryMessage(db, {
                  orderId,
                  chatId: dc.chatId,
                  messageId: null,
                  messageText: text,
                  status: 'failed',
                });
              }
            } catch {}
          }
        }
      } catch {}
      return { sent: 1 };
    }
    await stampLedger(db, orderId, 'failed', attempts, String(res.error || 'send_failed').slice(0, 200), false);
    return fail(String(res.error || 'send_failed').slice(0, 60));
  } catch {
    return fail('error');
  }
}

/**
 * Map a raw `orders` DB row to the `cleaned` shape formatNewOrderMessage
 * reads (single source — used by the live order route, the release sweep,
 * and rebuildOrderMessage below).
 */
export function orderRowToCleaned(order) {
  const o = order && typeof order === 'object' ? order : {};
  let items = [];
  try {
    const parsed = JSON.parse(o.items_json || '[]');
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    items = [];
  }
  return {
    type: o.type,
    name: o.customer_name || '',
    phone: o.customer_phone || '',
    address: o.customer_address || null,
    table: o.customer_table || null,
    notes: o.notes || null,
    items,
    subtotal: o.subtotal,
    // camelCase: formatNewOrderMessage reads deliveryFee (snake_case here
    // used to silently drop the delivery fee line).
    deliveryFee: o.delivery_fee,
    total: o.total,
    lang: o.lang,
    // Follow-up link (migration 0023): integer or null, never 0/''.
    parentNumber: Number.isInteger(o.parent_number) ? o.parent_number : null,
    location: (o.location_lat !== null && o.location_lat !== undefined &&
      o.location_lng !== null && o.location_lng !== undefined)
      ? { lat: o.location_lat, lng: o.location_lng }
      : null,
  };
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
    if (!Number.isInteger(order.number)) return null;
    try {
      JSON.parse(order.items_json || '[]');
    } catch {
      return null;
    }
    const cleaned = orderRowToCleaned(order);
    let currency = '';
    try {
      const kv = env && env.MENU_KV ? env.MENU_KV : null;
      // Currency string only — safe to edge-cache for minutes.
      const menu = kv ? await kv.get('menu', { type: 'json', cacheTtl: 300 }) : null;
      const cur = menu && menu.settings && menu.settings.currency;
      // Arabic-first to match the message language (ل.ل), English fallback.
      if (cur && typeof cur === 'object') currency = String(cur.ar || cur.en || '');
    } catch {}
    return formatNewOrderMessage(cleaned, order.number, currency);
  } catch {
    return null;
  }
}

/**
 * Handle a Confirm/Cancel button press. NEVER throws — every failure path
 * answers the callback (so the client spinner never hangs) and returns a
 * reason. Validation order: linked chat → known action → frozen-step
 * reject (`rdy`) → order exists → idempotent repeat → allowed transition
 * → write → announce.
 *
 * Only the linked owner chat or a linked delivery chat can act (clicker
 * AND message chat must equal the stored chat_id — usernames never
 * trusted; delivery clicks additionally require clickerId === chatId and
 * membership in the delivery set). Terminal states
 * (completed/cancelled) reject further presses; Cancel is allowed from
 * new/confirmed/ready. The write goes through the same
 * updateOrderStatus repository as the dashboard (one status model).
 */
export async function handleOrderCallback(db, token, { callbackId, clickerId, chatId, messageId, data, messageText, env }) {
  const noop = (reason) => ({ handled: false, reason });
  // alert=true renders a modal dialog (must-tap-to-dismiss) instead of a
  // fading toast — right for "action gone, go elsewhere". Plain text only
  // (alerts have no parse_mode), ≤200 chars, never cached.
  const answer = async (text, alert = false) => {
    if (!token || typeof callbackId !== 'string' || !callbackId) return;
    try {
      const params = {
        callback_query_id: callbackId,
        text: String(text || '').slice(0, 200),
      };
      if (alert) {
        params.show_alert = true;
        params.cache_time = 0;
      }
      await callTelegramApi(token, 'answerCallbackQuery', params);
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
    const isOwner = !!(link && clickerId === link.chatId && chatId === link.chatId);
    let isDelivery = false;
    if (!isOwner) {
      try {
        // Delivery auth: clicker must be messaging from its own linked chat.
        if (Number.isInteger(clickerId) && Number.isInteger(chatId) && clickerId === chatId) {
          const crew = await listDeliveryChats(db);
          if (Array.isArray(crew)) {
            for (const c of crew) {
              if (c && c.chatId === chatId) {
                isDelivery = true;
                break;
              }
            }
          }
        }
      } catch {}
    }
    if (!isOwner && !isDelivery) {
      await answer('Not linked.');
      return noop('unauthorized');
    }
    const parsed = parseOrderCallback(data);
    if (!parsed) {
      await answer('Unknown action.');
      return noop('bad_data');
    }
    // Frozen step: the "جاهز / mark-ready" button was removed from the
    // product — old in-flight `tg:rdy:*` buttons in already-sent messages
    // must NOT move orders to `ready` anymore. Answer with a modal alert
    // (must be read, never cached) and strip the dead buttons best-effort.
    // Legacy `ready` ROWS keep working: sync/stamp/complete paths below
    // still accept the status, only new presses are frozen.
    if (parsed.action === 'rdy') {
      await answer('خطوة "جاهز" اتلغت — كمّل من الداشبورد', true);
      try {
        await callTelegramApi(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] },
        });
      } catch {}
      return noop('deprecated');
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
        : parsed.status === 'ready'
          ? 'Already marked ready ✅'
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
      // Confirm stamping inputs (migration 0022): piggyback the ALREADY-
      // LOADED order row + one edge-cached menu read (confirm taps only —
      // other transitions add no reads). Degrades to ETA defaults + a live
      // kitchen count on any failure; the stamp never blocks the write.
      let confirmOpts;
      if (parsed.status === 'confirmed') {
        confirmOpts = {};
        try {
          let menu = null;
          try {
            const kv = env && env.MENU_KV ? env.MENU_KV : null;
            menu = kv ? await kv.get('menu', { type: 'json', cacheTtl: 300 }) : null;
          } catch {
            menu = null;
          }
          confirmOpts.settings = orderingEtaOrDefaults(menu && menu.settings ? menu.settings.ordering : null);
          confirmOpts.distanceKm = orderDistanceKm(order, menu);
          confirmOpts.queueLen = await countActiveKitchenOrders(db);
        } catch {
          confirmOpts = {};
        }
      }
      updated = await updateOrderStatus(db, parsed.orderId, parsed.status, confirmOpts);
    } catch {
      updated = null;
    }
    if (!updated) {
      await answer('Could not update — try again.');
      return noop('write_failed');
    }
    const banner = parsed.status === 'confirmed'
      ? CONFIRMED_BANNER
      : parsed.status === 'ready'
        ? readyBannerFor(order && order.type)
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
    // Delivery taps heal their own copy row, never the owner ledger.
    try {
      const healedText = typeof rebuilt === 'string' && rebuilt
        ? rebuilt.slice(0, 4000)
        : (typeof messageText === 'string' && messageText ? messageText.slice(0, 4000) : null);
      if (isDelivery) {
        await saveDeliveryMessage(db, {
          orderId: parsed.orderId,
          chatId,
          messageId: Number.isInteger(messageId) ? messageId : null,
          messageText: healedText,
          status: parsed.status,
        });
      } else {
        await db
          .prepare(
            'UPDATE telegram_notifications SET chat_id = COALESCE(chat_id, ?2), message_id = COALESCE(message_id, ?3), message_text = COALESCE(message_text, ?4) WHERE order_id = ?1'
          )
          .bind(
            parsed.orderId,
            Number.isInteger(chatId) ? chatId : null,
            Number.isInteger(messageId) ? messageId : null,
            healedText
          )
          .run();
      }
    } catch {}
    await answer(banner);
    // Next-step buttons (no double-tap): a confirmed order now offers
    // Mark-delivered/Cancel inline (no admin URL in callback context, so no
    // View row here — the dashboard keeps full controls); every other
    // terminal move freezes the keyboard. Then stamp the status.
    try {
      const nextKeyboard =
        parsed.status === 'confirmed'
          ? buildOrderKeyboard('', parsed.orderId, 'confirmed')
          : { inline_keyboard: [] };
      await callTelegramApi(token, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: nextKeyboard,
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
        orderType: order.type,
        lang: order.lang === 'ar' ? 'ar' : 'en',
        trackUrl: '',
        subject: undefined,
      });
    } catch {}
    // Customer email (confirmed/completed/cancelled): best-effort only,
    // never blocks the callback answer. 'ready' counts as 'confirmed'.
    try {
      const map = { confirmed: 'confirmed', ready: 'confirmed', completed: 'completed', cancelled: 'cancelled' };
      const ev = map[parsed.status];
      if (ev && updated && updated.customer && typeof updated.customer.email === 'string' && updated.customer.email) {
        const { notifyCustomerOrderEvent } = await import('./customer-email.js');
        // No request URL in callback context: build the track link from the
        // configured SITE_URL (same anti-spoofing convention as access.js).
        // Empty when unconfigured → email sends without the button, as before.
        let trackOrigin = '';
        try {
          trackOrigin = ((env && env.SITE_URL) || '').trim().replace(/\/+$/, '');
        } catch {}
        await notifyCustomerOrderEvent(db, env, { order: updated, event: ev, origin: trackOrigin });
      }
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
  for (const b of [...Object.values(STATUS_BANNERS), READY_DELIVERY_BANNER, READY_PICKUP_BANNER, ...legacy]) {
    const tail = `\n\n${b}`;
    if (out.endsWith(tail)) out = out.slice(0, -tail.length);
  }
  return out;
}

/**
 * Site -> Telegram sync: a dashboard status change stamps the SAME order
 * message the owner got at order time (two-way sync with the buttons),
 * plus every delivery-crew copy (same banner+keyboard, no admin-url row).
 * Best-effort and silent — NEVER throws, NEVER blocks the dashboard action:
 *   - no ledger row / no message refs (pre-0015 message, unlinked chat,
 *     deleted message) -> skipped with a reason, no error surfaced.
 *   - confirmed/ready -> banner stamped + delivered+cancel keyboard kept
 *     (TG_TRANSITIONS allows rcv/cnl from both, so dashboard-confirm no
 *     longer freezes while Telegram-confirm already offered delivered).
 *   - completed/cancelled (terminal) -> banner stamped + buttons frozen.
 *   - new (reopened) -> buttons restored so the owner/crew can act again.
 */
export async function syncOrderStatusToTelegram(db, token, { orderId, status, adminUrl }) {
  const skip = (reason) => ({ sent: 0, reason });
  try {
    if (!db || typeof token !== 'string' || !token) return skip('misconfigured');
    if (typeof orderId !== 'string' || !orderId) return skip('bad_order');
    if (typeof status !== 'string' || !(status === 'new' || status === 'ready' || STATUS_BANNERS[status])) return skip('bad_status');
    // Ready banners are type-aware (delivery goes out, pickup/dine-in
    // waits): read the order type once, fall back to delivery wording.
    let banner = null;
    if (status !== 'new') {
      banner = STATUS_BANNERS[status];
      if (status === 'ready') {
        let orderType = 'delivery';
        try {
          const ord = await findOrderById(db, orderId);
          if (ord && typeof ord.type === 'string' && ord.type) orderType = ord.type;
        } catch {}
        banner = readyBannerFor(orderType);
      }
    }
    const keepDelivered = status === 'confirmed' || status === 'ready';
    let ownerDone = false;
    let ownerSkipReason = 'no_message';
    try {
      let row = null;
      try {
        row = await db
          .prepare('SELECT chat_id, message_id, message_text FROM telegram_notifications WHERE order_id = ?1')
          .bind(orderId)
          .first();
      } catch {
        ownerSkipReason = 'ledger_unreadable';
        row = null;
      }
      if (row && Number.isInteger(row.chat_id) && Number.isInteger(row.message_id)) {
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
          ownerDone = true;
        } else {
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
              reply_markup: keepDelivered
                ? buildOrderKeyboard(adminUrl, orderId, 'confirmed')
                : { inline_keyboard: [] },
            });
          } catch {}
          ownerDone = true;
        }
      } else if (ownerSkipReason !== 'ledger_unreadable') {
        ownerSkipReason = 'no_message';
      }
    } catch {
      ownerSkipReason = 'error';
    }
    // Delivery copies: mirror owner logic, never the admin-url row.
    let deliveryDone = false;
    try {
      const copies = await listOrderDeliveryMessages(db, orderId);
      if (Array.isArray(copies)) {
        for (const cp of copies) {
          try {
            if (!cp || !Number.isInteger(cp.chatId) || !Number.isInteger(cp.messageId)) continue;
            if (status === 'new') {
              try {
                await callTelegramApi(token, 'editMessageReplyMarkup', {
                  chat_id: cp.chatId,
                  message_id: cp.messageId,
                  reply_markup: buildOrderKeyboard('', orderId),
                });
              } catch {}
              deliveryDone = true;
            } else {
              const cbase = stripBanner(typeof cp.messageText === 'string' && cp.messageText ? cp.messageText : '');
              if (cbase) {
                try {
                  await callTelegramApi(token, 'editMessageText', {
                    chat_id: cp.chatId,
                    message_id: cp.messageId,
                    text: `${cbase}\n\n${banner}`.slice(0, 4000),
                    parse_mode: 'HTML',
                  });
                } catch {}
              }
              try {
                await callTelegramApi(token, 'editMessageReplyMarkup', {
                  chat_id: cp.chatId,
                  message_id: cp.messageId,
                  reply_markup: keepDelivered
                    ? buildOrderKeyboard('', orderId, 'confirmed')
                    : { inline_keyboard: [] },
                });
              } catch {}
              deliveryDone = true;
            }
          } catch {}
        }
      }
    } catch {}
    if (ownerDone || deliveryDone) return { sent: 1 };
    return skip(ownerSkipReason);
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
 * Owner ping when the 5-minute customer-cancel window lapses with the
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
