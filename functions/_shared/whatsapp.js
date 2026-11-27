/**
 * WhatsApp Cloud API helpers for the inbound verification webhook.
 *
 * The member messages the business first, so a 24-hour customer service window
 * is open and the reply is a free-form service message — no template and no
 * Authentication-template eligibility. Meta still verifies the webhook
 * signature; every inbound message id is claimed once before any work.
 *
 * No SQL and no env-specific routes here (see
 * `repositories/phone-verifications.repo.js` and `api/whatsapp/webhook.js`).
 */

import { safeCompareStrings } from './session.js';
import { normalizePhoneDigits } from './validate-auth.js';

/** Current supported Graph version fallback; override with env if needed. */
export const DEFAULT_GRAPH_VERSION = 'v24.0';

/** Verification reply copy, in the member's site language. */
export const WHATSAPP_REPLIES = Object.freeze({
  en: {
    success: '✅ Your phone number is verified. You can return to the site now.',
    wrong:
      '❌ The code you entered is incorrect. Please try again with the correct code, or request a new one on the site.',
    expired:
      '⌛ This code expired or the request is no longer active. Request a new code on the site, then send it here.',
    missing: '✍️ Send the 6-digit verification code shown on the site.',
    conflict:
      'This number is linked to another member account. Use your own number or contact us.',
    wrongNumber:
      '⚠️ This code is for a different phone number. Open the site, check the number you entered, then send the code from that same WhatsApp number.',
  },
  ar: {
    success: '✅ تم تأكيد رقمك بنجاح. يمكنك العودة إلى الموقع الآن.',
    wrong:
      '❌ لقد كتبت كودًا خاطئًا لتأكيد هاتفك. يرجى إعادة المحاولة بالرمز الصحيح، أو اطلب رمزًا جديدًا من الموقع.',
    expired:
      '⌛ انتهت صلاحية رمز التحقق أو لم يعد الطلب فعالًا. اطلب رمزًا جديدًا من الموقع ثم أرسله هنا.',
    missing: '✍️ أرسل رمز التحقق المكوّن من 6 أرقام كما يظهر في الموقع.',
    conflict: 'هذا الرقم مرتبط بحساب عضو آخر. استخدم رقمك أو تواصل معنا.',
    wrongNumber:
      '⚠️ هذا الرمز يخص رقم هاتف آخر. افتح الموقع، وتحقق من الرقم الذي أدخلته، ثم أرسل الرمز من رقم واتساب نفسه.',
  },
});

/** Pick a reply by kind + language. Unknown kinds fall back to the wrong text. */
export function whatsappReply(kind, lang) {
  const set = WHATSAPP_REPLIES[lang === 'ar' ? 'ar' : 'en'];
  return set[kind] || set.wrong;
}

/**
 * The stored row language wins (the site knows what the member chose). Legacy
 * rows before migration 0039 default to English, so a bare code with no text
 * falls back to Arabic (the restaurant's primary language).
 */
export function pickReplyLanguage(rowLang, text, fallback = 'ar') {
  if (rowLang === 'ar' || rowLang === 'en') return rowLang;
  if (/[\u0600-\u06FF]/.test(String(text || ''))) return 'ar';
  if (/[A-Za-z]/.test(String(text || ''))) return 'en';
  return fallback;
}

/** Digits only; Meta sends `from` in international format without a plus. */
export function normalizeWhatsAppPhone(value) {
  const digits = normalizePhoneDigits(typeof value === 'string' ? value : '');
  return digits.length >= 6 && digits.length <= 15 ? digits : '';
}

/** First standalone 6-digit sequence (the code line), or null. */
export function extractVerificationCode(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/(?:^|\D)(\d{6})(?:\D|$)/);
  return match ? match[1] : null;
}

/**
 * True when the message is plausibly about PHONE verification. Normal
 * customer messages on the same business number are left untouched (no
 * auto-reply). The match is deliberately narrow: a generic "code" / "رمز"
 * word (promo code, discount code, order question) must NOT trigger a
 * verification reply.
 */
export function looksLikeVerificationMessage(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const value = text.trim();

  // The prefilled site message and the common "verify my number" phrasings.
  const verifyIntent = /(?:verify|verification)\s+(?:my\s+)?(?:phone|number|whatsapp)|(?:phone|number)\s+verification|تأكيد\s+(?:رقم|هاتف|رقمي|رقم\s+هاتفي)|تحقق\s+من\s+(?:الرقم|رقم|الهاتف)|رمز\s+التحقق/i;
  if (verifyIntent.test(value)) return true;

  // A labelled code line: "Code: 123456", "my code is 123456",
  // "الرمز: 123456", "الرمز هو 123456". Not "my order code is 123456".
  if (/(?:^|\n)\s*(?:my\s+)?(?:code|رمز|كود)\s*(?:is|هو)?\s*[:：]?\s*\d{6}\b/i.test(value)) return true;

  // A short message that is essentially just the code is also a valid attempt.
  return !!extractVerificationCode(value) && value.length <= 20;
}

/**
 * Meta's `X-Hub-Signature-256: sha256=<hex>` over the raw request body.
 * Never accepts a missing secret or a malformed header.
 */
export async function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (typeof rawBody !== 'string' || typeof appSecret !== 'string' || !appSecret) return false;
  if (typeof signatureHeader !== 'string') return false;
  const provided = signatureHeader.trim();
  if (!/^sha256=/i.test(provided)) return false;
  const hex = provided.slice(7).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  return safeCompareStrings(expected, hex);
}

/**
 * Extract inbound text messages from a Cloud API webhook payload. Delivery
 * statuses, reactions and media are ignored (the verification flow is text).
 */
export function readWhatsAppMessages(payload) {
  const out = [];
  if (!payload || typeof payload !== 'object') return out;
  if (payload.object !== 'whatsapp_business_account') return out;
  if (!Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value = change && change.value;
      if (!value || typeof value !== 'object' || !Array.isArray(value.messages)) continue;
      for (const msg of value.messages) {
        if (!msg || typeof msg.id !== 'string' || !msg.id) continue;
        if (msg.type !== 'text') continue;
        const body = msg.text && typeof msg.text.body === 'string' ? msg.text.body : '';
        if (!body.trim()) continue;
        const from = normalizeWhatsAppPhone(msg.from);
        if (!from) continue;
        out.push({
          id: msg.id,
          from,
          text: body.slice(0, 2000),
          timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : null,
        });
      }
    }
  }
  return out;
}

/**
 * Send a free-form service message. Only valid while the 24-hour customer
 * service window is open — we call it immediately after the inbound message.
 * Never throws; returns { ok, error, status }.
 */
export async function sendWhatsAppText(env, to, body, fetchFn = fetch) {
  const token = env && typeof env.WHATSAPP_ACCESS_TOKEN === 'string' ? env.WHATSAPP_ACCESS_TOKEN.trim() : '';
  const phoneId = env && typeof env.WHATSAPP_PHONE_NUMBER_ID === 'string' ? env.WHATSAPP_PHONE_NUMBER_ID.trim() : '';
  const version = env && typeof env.WHATSAPP_GRAPH_VERSION === 'string' && env.WHATSAPP_GRAPH_VERSION.trim()
    ? env.WHATSAPP_GRAPH_VERSION.trim()
    : DEFAULT_GRAPH_VERSION;
  const recipient = normalizeWhatsAppPhone(to);
  if (!token || !phoneId) return { ok: false, error: 'not_configured', status: 0 };
  if (!recipient || typeof body !== 'string' || !body) return { ok: false, error: 'bad_message', status: 0 };

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, 6000);
  try {
    const res = await fetchFn(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { body: body.slice(0, 4096), preview_url: false },
      }),
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (res.ok && data && Array.isArray(data.messages) && data.messages.length > 0) {
      return { ok: true, error: null, status: res.status };
    }
    const message = data && data.error && typeof data.error.message === 'string'
      ? data.error.message.slice(0, 200)
      : `http_${res.status}`;
    return { ok: false, error: message, status: res.status };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return { ok: false, error: aborted ? 'timeout' : 'network', status: 0 };
  } finally {
    clearTimeout(timer);
  }
}
