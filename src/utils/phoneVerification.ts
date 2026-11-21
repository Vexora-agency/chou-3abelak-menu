import { phoneDigitsOnly } from './digits';

/**
 * Client-side copy of the message the member sends. The API returns the same
 * text (and a ready wa.me URL); these helpers are the fallback when the member
 * revisits a cached code after the server response is gone.
 */
export function buildPhoneVerificationMessage(args: {
  code: string;
  reference: string;
  lang: 'en' | 'ar';
}): string {
  const code = /^[0-9]{6}$/.test(args.code) ? args.code : '------';
  const ref = String(args.reference || '').slice(0, 12);
  if (args.lang === 'ar') {
    return `مرحبًا! يرجى تأكيد رقم هاتفي.\nالرمز: ${code}\nالمرجع: ${ref}`;
  }
  return `Hello! Please verify my phone number.\nCode: ${code}\nRef: ${ref}`;
}

export function buildPhoneVerificationWhatsAppUrl(
  storeNumber: string | null | undefined,
  message: string,
): string | null {
  const digits = phoneDigitsOnly(storeNumber || '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
