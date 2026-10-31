/**
 * Eastern Arabic numerals (٠١٢٣٤٥٦٧٨٩, U+0660–U+0669) and Extended
 * Arabic-Indic / Persian numerals (۰۱۲۳۴۵۶۷۸۹, U+06F0–U+06F9) to Western
 * digits. Mobile keyboards on Arabic locales emit these by default — an
 * input filter like /[^0-9]/ would strip them and the field LOOKS DEAD
 * (the reported "can't type phone on phones" bug). Normalize FIRST, then
 * filter. Pure, no dependencies.
 */
export function toWesternDigits(input: string | null | undefined): string {
  if (typeof input !== 'string' || !input) return '';
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return String(code - 0x06f0);
  });
}

/** Phone-shaped cleanup: Western digits first, then keep dial characters. */
export function cleanPhoneInput(input: string | null | undefined): string {
  return toWesternDigits(input).replace(/[^0-9+\s-]/g, '');
}

/** Backend mirror (validateOrderInput): digits only, for length checks. */
export function phoneDigitsOnly(input: string | null | undefined): string {
  return toWesternDigits(input).replace(/[^0-9]/g, '');
}
