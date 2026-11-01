/**
 * Shared validation primitives for restaurant menu documents.
 * No imports — every other validate-*.js module builds on this one,
 * so the dependency graph stays acyclic by construction.
 */

export const ID_REGEX = /^[a-z0-9_-]{1,40}$/i;
export const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const PHONE_REGEX = /^\+?[0-9\s-]{6,20}$/;
export const WHATSAPP_REGEX = /^[1-9][0-9]{7,14}$/;

// Control characters (including newlines/tabs) are stripped from every
// validated string so stored text can never break layouts or logs.
export function stripControls(v) {
  // eslint-disable-next-line no-control-regex -- intentional: this sanitizer must match C0 controls + DEL.
  return String(v ?? '').replace(/[\x00-\x1F\x7F]/g, '');
}

export function validateBilingual(errors, field, name, max = 80) {
  if (!field || typeof field !== 'object') {
    errors.push(`settings.${name} must be an object with en and ar strings`);
    return { en: '', ar: '' };
  }
  const en = typeof field.en === 'string' ? stripControls(field.en).slice(0, max) : '';
  const ar = typeof field.ar === 'string' ? stripControls(field.ar).slice(0, max) : '';
  return { en, ar };
}

// Optional bilingual blocks: missing means empty, never an error
// (real menus ship without them).
export function validateBilingualOpt(field, max = 80) {
  if (!field || typeof field !== 'object') return { en: '', ar: '' };
  const en = typeof field.en === 'string' ? stripControls(field.en).slice(0, max) : '';
  const ar = typeof field.ar === 'string' ? stripControls(field.ar).slice(0, max) : '';
  return { en, ar };
}
