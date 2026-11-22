/**
 * UniMTX (Unimatrix) OTP API — SMS fallback for members without WhatsApp.
 *
 * Docs: https://www.unimtx.com/docs/api/send-otp and /verify-otp
 * Endpoint: https://api.unimtx.com/?action=otp.send&accessKeyId=…
 *
 * Simple mode only needs UNIMTX_ACCESS_KEY_ID. HMAC mode is used
 * automatically when UNIMTX_ACCESS_KEY_SECRET is set: all query params are
 * sorted, signed with HMAC-SHA256, and sent as Base64. The JSON body is not
 * signed. Secrets are never logged.
 */

import { normalizePhoneDigits } from './validate-auth.js';

const DEFAULT_API_BASE = 'https://api.unimtx.com';
const DEFAULT_INTENT = 'phone_verification';
const DEFAULT_TTL_SEC = 300;
const REQUEST_TIMEOUT_MS = 10000;

function trimEnv(env, key) {
  const value = env && typeof env[key] === 'string' ? env[key].trim() : '';
  return value;
}

export function isUnimtxConfigured(env) {
  return !!trimEnv(env, 'UNIMTX_ACCESS_KEY_ID');
}

/**
 * Optional pre-approved SMS template code (the "Custom code" from the
 * UniMTX console). When set, the SMS fallback sends OUR hashed 6-digit code
 * through `sms.message.send` instead of the built-in OTP text, so the message
 * is branded and readable.
 */
export function getUnimtxTemplateId(env) {
  return trimEnv(env, 'UNIMTX_SMS_TEMPLATE_ID');
}

/** Digits → E.164. Returns null for a number outside 8–15 digits. */
export function toUnimtxPhone(value) {
  const digits = normalizePhoneDigits(String(value || ''));
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

function randomNonce() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function hmacBase64(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return base64(new Uint8Array(sig));
}

/**
 * Build the signed/simple query for one action. Exported for tests.
 * Returns null when the AccessKey ID is missing.
 */
export async function buildUnimtxQuery(env, action, nowMs = Date.now()) {
  const accessKeyId = trimEnv(env, 'UNIMTX_ACCESS_KEY_ID');
  if (!accessKeyId) return null;
  const secret = trimEnv(env, 'UNIMTX_ACCESS_KEY_SECRET');
  const params = { action, accessKeyId };
  if (secret) {
    params.algorithm = 'hmac-sha256';
    params.timestamp = String(nowMs);
    params.nonce = randomNonce();
    const keys = Object.keys(params).sort();
    const text = keys.map((key) => `${key}=${params[key]}`).join('&');
    params.signature = await hmacBase64(secret, text);
  }
  return { params, base: trimEnv(env, 'UNIMTX_API_BASE') || DEFAULT_API_BASE };
}

async function postUnimtx(env, action, body, fetchFn) {
  const built = await buildUnimtxQuery(env, action);
  if (!built) return { ok: false, error: 'not_configured', status: 0 };
  const url = new URL(built.base);
  for (const [key, value] of Object.entries(built.params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchFn(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    const code = json && typeof json.code === 'string' ? json.code : '';
    const message = json && typeof json.message === 'string' ? json.message.slice(0, 200) : `http_${res.status}`;
    const ok = res.ok && code === '0';
    return { ok, status: res.status, code, message, data: json ? json.data : null };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return { ok: false, status: 0, code: '', message: aborted ? 'timeout' : 'network', data: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a 6-digit OTP. `channel` is 'sms' (default) or 'call'. We deliberately
 * do not use 'auto' (it prefers SMS) or 'whatsapp' (our reverse Cloud API flow
 * is free and already primary).
 */
export async function sendUnimtxOtp(env, { to, channel = 'sms', intent = DEFAULT_INTENT, ttl = DEFAULT_TTL_SEC, digits = 6 }, fetchFn = fetch) {
  const recipient = toUnimtxPhone(to);
  if (!recipient) return { ok: false, error: 'phone_invalid', status: 0 };
  if (channel !== 'sms' && channel !== 'call') return { ok: false, error: 'bad_channel', status: 0 };
  return postUnimtx(env, 'otp.send', {
    to: recipient,
    digits,
    intent: String(intent).slice(0, 36),
    channel,
    ttl: Math.max(60, Math.min(1800, Number(ttl) || DEFAULT_TTL_SEC)),
  }, fetchFn);
}

/**
 * Send OUR generated code through a pre-approved UniMTX SMS template.
 *
 * The template is created in the UniMTX console and referenced by its custom
 * code (e.g. `chou3abelak_verify`). It must contain a `{code}` variable; we
 * pass `templateData: { code }` and nothing else. The message text, brand and
 * wording live in the approved template — no built-in OTP copy is used.
 *
 * Returns `providerId` (the UniMTX message id) for the pending row.
 */
export async function sendUnimtxTemplateSms(
  env,
  { to, templateId, templateData, signature },
  fetchFn = fetch
) {
  const recipient = toUnimtxPhone(to);
  if (!recipient) return { ok: false, error: 'phone_invalid', status: 0 };
  const id = typeof templateId === 'string' ? templateId.trim().slice(0, 64) : '';
  if (!id) return { ok: false, error: 'template_missing', status: 0 };
  const data = templateData && typeof templateData === 'object' ? templateData : {};
  const body = {
    to: recipient,
    templateId: id,
    templateData: data,
  };
  const sig = typeof signature === 'string' ? signature.trim().slice(0, 16) : '';
  if (sig) body.signature = sig;

  const result = await postUnimtx(env, 'sms.message.send', body, fetchFn);
  if (!result.ok) return result;
  const messages = result.data && Array.isArray(result.data.messages) ? result.data.messages : [];
  const providerId = messages[0] && typeof messages[0].id === 'string' ? messages[0].id : null;
  return { ...result, providerId };
}

/** Verify a user-entered OTP with the same `to` + `intent`. */
export async function verifyUnimtxOtp(env, { to, code, intent = DEFAULT_INTENT, ttl = DEFAULT_TTL_SEC }, fetchFn = fetch) {
  const recipient = toUnimtxPhone(to);
  const digits = String(code || '').replace(/[^0-9]/g, '');
  if (!recipient) return { ok: false, valid: false, error: 'phone_invalid', status: 0 };
  if (digits.length < 4 || digits.length > 8) return { ok: false, valid: false, error: 'code_invalid', status: 0 };
  const result = await postUnimtx(env, 'otp.verify', {
    to: recipient,
    code: digits,
    intent: String(intent).slice(0, 36),
    ttl: Math.max(60, Math.min(1800, Number(ttl) || DEFAULT_TTL_SEC)),
  }, fetchFn);
  const valid = !!(result.ok && result.data && result.data.valid === true);
  return { ...result, valid };
}
