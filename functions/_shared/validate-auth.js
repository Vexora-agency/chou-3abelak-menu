/**
 * Customer-auth validation primitives.
 *
 * Pure functions only: no env access, no D1, no Better Auth imports.
 * `functions/_shared/auth.js` uses these inside Better Auth hooks so the
 * same rules are enforced server-side for signup, profile updates and
 * password reset (the UI mirrors them for a friendly inline checklist).
 */

export const AUTH_NAME_MAX = 80;
export const AUTH_PASSWORD_MIN = 10;
export const AUTH_PASSWORD_MAX = 128;

/** Small denylist of passwords that pass length/complexity but are still weak. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'admin123',
  'welcome123',
  'letmein123',
  'chou3abelak',
  'chou-3abelak',
]);

export const AUTH_ERROR_MESSAGES = Object.freeze({
  name_required: 'Please enter your name.',
  name_too_long: `Name must be ${AUTH_NAME_MAX} characters or fewer.`,
  password_too_short: `Password must be at least ${AUTH_PASSWORD_MIN} characters.`,
  password_too_long: `Password must be ${AUTH_PASSWORD_MAX} characters or fewer.`,
  password_letter_required: 'Password must include at least one letter.',
  password_number_required: 'Password must include at least one number.',
  password_too_common: 'Choose a stronger password.',
});

/** Collapse whitespace and trim; never returns null/undefined. */
export function normalizeAuthName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * @returns {{ ok: true, name: string } | { ok: false, code: string }}
 */
export function validateAuthName(value) {
  const name = normalizeAuthName(value);
  if (!name) return { ok: false, code: 'name_required' };
  if (name.length > AUTH_NAME_MAX) return { ok: false, code: 'name_too_long' };
  return { ok: true, name };
}

/**
 * @param {unknown} password
 * @param {{ email?: unknown }} [context]
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
export function validateAuthPassword(password, context = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, code: 'password_too_short' };
  }
  if (password.length < AUTH_PASSWORD_MIN) {
    return { ok: false, code: 'password_too_short' };
  }
  if (password.length > AUTH_PASSWORD_MAX) {
    return { ok: false, code: 'password_too_long' };
  }
  // Unicode-aware so Arabic (and other scripts) count as letters.
  if (!/\p{L}/u.test(password)) {
    return { ok: false, code: 'password_letter_required' };
  }
  if (!/\p{Nd}/u.test(password)) {
    return { ok: false, code: 'password_number_required' };
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, code: 'password_too_common' };
  }
  if (typeof context.email === 'string' && context.email.trim()) {
    if (lower === context.email.trim().toLowerCase()) {
      return { ok: false, code: 'password_too_common' };
    }
  }
  return { ok: true };
}

/** Stable English message for a validation code; the UI can translate by code. */
export function authErrorMessage(code) {
  return AUTH_ERROR_MESSAGES[code] || 'Invalid input.';
}

/**
 * True only for relative paths or absolute URLs whose origin is explicitly
 * trusted. Rejects protocol-relative URLs, backslashes, credentials and
 * non-http(s) schemes.
 */
export function isSafeCallbackTarget(value, trustedOrigins = []) {
  if (typeof value !== 'string') return false;
  const target = value.trim();
  if (!target || target.length > 2048) return false;
  if (/[\u0000-\u001F\u007F]/.test(target)) return false;
  if (target.includes('\\')) return false;
  if (target.startsWith('//')) return false;

  if (target.startsWith('/')) return true;

  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return Array.isArray(trustedOrigins) && trustedOrigins.includes(url.origin);
}

/** Parse a positive safe integer (order numbers), or null. */
export function parseOrderNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
