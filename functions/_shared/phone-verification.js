/**
 * Reverse WhatsApp phone verification — pure helpers.
 *
 * The member enters a phone number, the site mints a 6-digit code, and the
 * member sends that code FROM the entered number to the restaurant's
 * WhatsApp. Receiving the message proves control of the number without an
 * outbound template, a paid provider, or Meta business verification.
 *
 * What is stored: a keyed hash of the code + a short public reference.
 * What is never stored: the plaintext code (it exists only in the member's
 * browser and in the WhatsApp message).
 *
 * No SQL here — see `repositories/phone-verifications.repo.js`.
 */

import { getSessionSecret, safeCompareStrings } from './session.js';
import { normalizePhoneDigits } from './validate-auth.js';

/** Code lives in the message for 5 minutes. */
export const VERIFICATION_CODE_TTL_MS = 5 * 60 * 1000;
/** A "call me" request stays on the dashboard for 15 minutes. */
export const VERIFICATION_CALLBACK_TTL_MS = 15 * 60 * 1000;
/** An approved number stays verified for a year. */
export const VERIFICATION_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;
/** One new code per member+number per five minutes (the code's own lifetime). */
export const VERIFICATION_COOLDOWN_SEC = 300;
/** Per member+number hourly / daily caps (manual approval is owner work). */
export const VERIFICATION_HOURLY_MAX = 5;
export const VERIFICATION_DAILY_MAX = 15;
/** Reference length shown in WhatsApp and the admin dashboard. */
export const VERIFICATION_REFERENCE_LENGTH = 8;

/**
 * One verified phone belongs to ONE member account. Every write surface
 * (profile save, code request, code approval, order gate) uses this same
 * error code + bilingual copy so the customer sees one clear reason.
 */
export const PHONE_LINKED_ERROR = 'phone_linked_other_account';
export const PHONE_LINKED_MESSAGE = Object.freeze({
  en: 'This number is linked to another member account. Use your own number or contact us.',
  ar: 'هذا الرقم مرتبط بحساب عضو آخر. استخدم رقمك أو تواصل معنا.',
});

/**
 * Signing key for code hashes. A dedicated secret wins; otherwise the admin
 * session secret (already required in production) is reused. Returns null
 * when neither is configured so the route can fail closed.
 */
export function getVerificationSecret(env) {
  let raw = env && typeof env.PHONE_VERIFICATION_SECRET === 'string'
    ? env.PHONE_VERIFICATION_SECRET.trim()
    : '';
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
    raw = raw.slice(1, -1).trim();
  }
  if (raw) return new TextEncoder().encode(raw);
  return getSessionSecret(env);
}

function randomBytes(length) {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** 6 digits, uniformly distributed, no leading-zero special case. */
export function generateVerificationCode() {
  const buf = randomBytes(4);
  const n = ((buf[0] << 24) >>> 0) + (buf[1] << 16) + (buf[2] << 8) + buf[3];
  return String(n % 1000000).padStart(6, '0');
}

export function isVerificationCodeFormat(value) {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value);
}

export function newVerificationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = randomBytes(16);
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(secretBytes, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Short, non-secret handle derived from the row id. Shown in the WhatsApp
 * message and in the admin pending list; the owner matches on it.
 */
export async function verificationReference(id) {
  const hex = await sha256Hex(`phone-verify-ref:v1:${String(id || '')}`);
  return hex.slice(0, VERIFICATION_REFERENCE_LENGTH).toUpperCase();
}

/** Keyed hash bound to the row id and phone (a leaked hash is not reusable). */
export async function hashVerificationCode(secretBytes, { id, phone, code }) {
  if (!secretBytes || !secretBytes.length) throw new Error('missing_secret');
  if (!isVerificationCodeFormat(code)) throw new Error('bad_code');
  return hmacSha256Hex(
    secretBytes,
    `phone-verify-code:v1:${String(id || '')}:${normalizePhoneDigits(phone)}:${code}`
  );
}

/** Constant-time check used by the (future) inbound webhook matcher. */
export function verificationCodeMatches(secretBytes, row, code) {
  if (!row || typeof row.id !== 'string' || typeof row.code_hash !== 'string') return Promise.resolve(false);
  return hashVerificationCode(secretBytes, { id: row.id, phone: row.phone, code })
    .then((hash) => safeCompareStrings(hash, row.code_hash))
    .catch(() => false);
}

/** Accepted shape for a number that can be verified. */
export function normalizeVerificationPhone(value) {
  const digits = normalizePhoneDigits(value);
  if (digits.length < 6 || digits.length > 15) return null;
  return digits;
}

export function isApprovedVerification(row, nowMs = Date.now()) {
  if (!row || row.status !== 'approved') return false;
  const approvedAt = Date.parse(row.decided_at || row.approved_at || '');
  if (!Number.isFinite(approvedAt)) return false;
  return approvedAt + VERIFICATION_VALIDITY_MS > nowMs && nowMs >= approvedAt;
}

export function verificationValidUntil(row) {
  const approvedAt = Date.parse((row && (row.decided_at || row.approved_at)) || '');
  if (!Number.isFinite(approvedAt)) return null;
  return new Date(approvedAt + VERIFICATION_VALIDITY_MS).toISOString();
}

/**
 * The exact text the member sends. Short, bilingual-friendly, and it always
 * carries the code + reference so the owner can match it in WhatsApp.
 */
export function buildVerificationMessage({ code, reference, lang = 'en' }) {
  const safeCode = isVerificationCodeFormat(code) ? code : '------';
  const ref = typeof reference === 'string' ? reference.slice(0, 12) : '';
  if (lang === 'ar') {
    return `مرحبًا! يرجى تأكيد رقم هاتفي.\nالرمز: ${safeCode}\nالمرجع: ${ref}`;
  }
  return `Hello! Please verify my phone number.\nCode: ${safeCode}\nRef: ${ref}`;
}

/** wa.me link with the message pre-filled. Null when the store has no number. */
export function buildVerificationWhatsAppUrl(storeNumber, message) {
  const digits = normalizePhoneDigits(storeNumber);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(String(message || ''))}`;
}

/** ISO expiry for a code created at `createdMs`. */
export function codeExpiresAt(createdMs) {
  return new Date(createdMs + VERIFICATION_CODE_TTL_MS).toISOString();
}

/** ISO expiry for a callback request created at `createdMs`. */
export function callbackExpiresAt(createdMs) {
  return new Date(createdMs + VERIFICATION_CALLBACK_TTL_MS).toISOString();
}
