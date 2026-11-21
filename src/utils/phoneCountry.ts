import { DIAL_CODES, DEFAULT_DIAL_ISO, splitDialCode } from '@/src/config/dialCodes';
import { phoneDigitsOnly } from './digits';

export interface DialCountry {
  iso: string;
  code: string;
}

export type PhoneCheckReason = 'empty' | 'too_short' | 'too_long' | 'country';

export interface PhoneCheck {
  ok: boolean;
  /** Full international digits, no plus (what the order/profile stores). */
  normalized: string;
  /** National part for the prefixed input. */
  national: string;
  reason: PhoneCheckReason | null;
}

const DEFAULT_DIAL: DialCountry = (() => {
  const found = DIAL_CODES.find((c) => c.iso === DEFAULT_DIAL_ISO);
  return found ? { iso: found.iso, code: found.code } : { iso: 'LB', code: '961' };
})();

/**
 * The restaurant's dial code is whatever the owner picked in the admin
 * WhatsApp country picker (falling back to the restaurant phone when WhatsApp
 * is empty). That single choice drives the customer phone gate everywhere.
 *
 * An unrecognised stored number returns an empty code and disables the
 * country gate instead of guessing and rejecting real customers.
 */
export function dialFromSettings(
  settings: { whatsapp?: string; phone?: string } | null | undefined,
): DialCountry {
  const raw = (settings?.whatsapp || '').trim() || (settings?.phone || '').trim();
  if (!raw) return DEFAULT_DIAL;
  const clean = raw.replace(/\D/g, '').replace(/^00/, '');
  if (!clean) return DEFAULT_DIAL;
  const split = splitDialCode(clean);
  return split.code ? { iso: split.iso, code: split.code } : { iso: '', code: '' };
}

/** True when the raw input explicitly claims an international number. */
export function isInternationalInput(raw: string): boolean {
  const text = (raw || '').trim();
  return text.startsWith('+') || text.startsWith('00');
}

/** National part for a prefixed input (no dial code, no leading trunk 0). */
export function nationalPart(raw: string, dialCode: string): string {
  const digits = phoneDigitsOnly(raw);
  if (!digits) return '';
  if (dialCode && digits.startsWith(dialCode)) {
    return digits.slice(dialCode.length).replace(/^0+/, '');
  }
  return digits.replace(/^0+/, '');
}

/** Compose the stored full-international value from the national field. */
export function composeNational(national: string, dialCode: string): string {
  const digits = phoneDigitsOnly(national).replace(/^0+/, '');
  if (!digits) return '';
  return dialCode ? `${dialCode}${digits}` : digits;
}

/**
 * Validate a phone against the restaurant's dial code.
 *
 * - `+20...` / `0020...` for a +961 restaurant -> `country` (blocked).
 * - `70 123 456` (national) -> accepted and normalized to `96170123456`.
 * - A long plain number that starts with a different known country code is
 *   also treated as foreign (covers stored account numbers without a plus).
 */
export function checkPhone(raw: string, dialCode: string): PhoneCheck {
  const text = (raw || '').trim();
  // 00 is the international access prefix; strip it before the dial-code test
  // (001234... and 1234... must behave the same once validated).
  const digits = phoneDigitsOnly(text).replace(/^00/, '');
  if (!digits) return { ok: false, normalized: '', national: '', reason: 'empty' };

  const explicit = isInternationalInput(text);

  if (!dialCode) {
    if (digits.length < 6) return { ok: false, normalized: '', national: digits, reason: 'too_short' };
    if (digits.length > 15) return { ok: false, normalized: '', national: digits, reason: 'too_long' };
    return { ok: true, normalized: digits, national: digits, reason: null };
  }

  if (explicit && !digits.startsWith(dialCode)) {
    return { ok: false, normalized: '', national: digits, reason: 'country' };
  }

  // No plus/00 but the number is clearly a full international one (long and
  // prefixed with another known code). National numbers are short enough that
  // this cannot misclassify them.
  if (!explicit && !digits.startsWith(dialCode)) {
    const foreign = splitDialCode(digits);
    if (foreign.code && foreign.code !== dialCode && digits.length >= 10) {
      return { ok: false, normalized: '', national: digits, reason: 'country' };
    }
  }

  const national = digits.startsWith(dialCode)
    ? digits.slice(dialCode.length).replace(/^0+/, '')
    : digits.replace(/^0+/, '');
  // A 3-digit "national number" is never a real phone number, even if the
  // total including the dial code happens to be six digits.
  if (national.length < 4) return { ok: false, normalized: '', national, reason: 'too_short' };
  const normalized = `${dialCode}${national}`;
  if (normalized.length > 15) return { ok: false, normalized: '', national, reason: 'too_long' };
  return { ok: true, normalized, national, reason: null };
}

/** True when a stored account number clearly belongs to another country. */
export function isForeignNumber(raw: string, dialCode: string): boolean {
  if (!dialCode) return false;
  const check = checkPhone(raw, dialCode);
  return !check.ok && check.reason === 'country';
}

/**
 * True when the cart's entered number differs from the account's saved number
 * for the same dial code. An EMPTY saved number counts as a change: the first
 * number a member enters must be verified too. Empty/invalid entered values
 * never count as a change.
 */
export function isDifferentAccountPhone(
  entered: string,
  saved: string | null | undefined,
  dialCode: string,
): boolean {
  const enteredCheck = checkPhone(entered, dialCode);
  if (!enteredCheck.ok) return false;
  const savedCheck = saved ? checkPhone(saved, dialCode) : null;
  if (!savedCheck || !savedCheck.ok) return true;
  return enteredCheck.normalized !== savedCheck.normalized;
}
