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
  phone_invalid: 'Phone must be 6–15 digits.',
  phone_required: 'Please enter your phone number.',
  address_invalid: 'Address must be 200 characters or fewer.',
  address_required: 'Please enter your default address.',
  location_invalid: 'The pinned location is invalid.',
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

/** Eastern Arabic + Persian digits to Western, then strip non-digits. */
export function normalizePhoneDigits(value) {
  if (typeof value !== 'string') return '';
  const western = value.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return String(code - 0x06f0);
  });
  return western.replace(/[^0-9]/g, '');
}

/**
 * Account phone: optional. Empty clears the field; otherwise 6–15 digits.
 * @returns {{ ok: true, phone: string|null } | { ok: false, code: string }}
 */
export function validateProfilePhone(value) {
  if (value === undefined || value === null || value === '') return { ok: true, phone: null };
  if (typeof value !== 'string') return { ok: false, code: 'phone_invalid' };
  const digits = normalizePhoneDigits(value);
  if (!digits) return { ok: true, phone: null };
  if (digits.length < 6 || digits.length > 15) return { ok: false, code: 'phone_invalid' };
  return { ok: true, phone: digits };
}

/**
 * Account address: optional. Trim + collapse whitespace, max 200 chars.
 * @returns {{ ok: true, address: string|null } | { ok: false, code: string }}
 */
export function validateProfileAddress(value) {
  if (value === undefined || value === null || value === '') return { ok: true, address: null };
  if (typeof value !== 'string') return { ok: false, code: 'address_invalid' };
  const address = value.replace(/\s+/g, ' ').trim().slice(0, 200);
  return { ok: true, address: address || null };
}

/**
 * A customer account is order-ready when phone and default address are
 * present. The map pin is OPTIONAL: the written address is the source of
 * truth, and a pin only sharpens the kitchen ticket. One predicate shared by
 * the profile route, the order route and the policy tests.
 * @param {{ phone?: unknown, address?: unknown, location?: unknown } | null | undefined} profile
 */
export function isProfileComplete(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const phone = typeof profile.phone === 'string' ? profile.phone.trim() : '';
  const address = typeof profile.address === 'string' ? profile.address.trim() : '';
  return !!(phone && address);
}

/**
 * Account default-address pin: optional shape; lat/lng must be finite and in
 * range. Accuracy is coerced to a sane non-negative metre value.
 * @returns {{ ok: true, location: {lat:number,lng:number,accuracy:number}|null } | { ok: false, code: string }}
 */
export function validateProfileLocation(value) {
  if (value === undefined || value === null) return { ok: true, location: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'location_invalid' };
  const rawLat = value.lat;
  const rawLng = value.lng;
  // Reject null/undefined/empty coordinates before Number() can turn them
  // into 0,0 — a missing pin must never be stored as the Gulf of Guinea.
  if (
    (typeof rawLat !== 'number' && typeof rawLat !== 'string') ||
    (typeof rawLng !== 'number' && typeof rawLng !== 'string') ||
    rawLat === '' ||
    rawLng === ''
  ) {
    return { ok: false, code: 'location_invalid' };
  }
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, code: 'location_invalid' };
  }
  const rawAccuracy = Number(value.accuracy);
  const accuracy = Number.isFinite(rawAccuracy)
    ? Math.max(0, Math.min(100000, Math.round(rawAccuracy)))
    : 0;
  return { ok: true, location: { lat, lng, accuracy } };
}

