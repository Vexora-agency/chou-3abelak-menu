/**
 * Store phone settings shared by every customer-facing phone gate.
 *
 * Two different numbers live here:
 *  - `whatsapp`: where the member sends the verification message. A dedicated
 *    Cloud API number (WHATSAPP_VERIFICATION_NUMBER) may override the public
 *    restaurant WhatsApp.
 *  - `dialCode`: the country customers' own numbers belong to. It always comes
 *    from the PUBLIC restaurant WhatsApp/phone setting, never from the Cloud
 *    API infrastructure number, which can live in another country.
 *
 * Best effort: a KV failure returns empty values instead of blocking a code.
 * Callers treat an empty dial code as "legacy digits only".
 */

import { dialCodeFromNumber } from './dial-codes.js';

export async function getStorePhoneSettings(env) {
  const override = env && typeof env.WHATSAPP_VERIFICATION_NUMBER === 'string'
    ? env.WHATSAPP_VERIFICATION_NUMBER.trim()
    : '';
  let whatsapp = override;
  let dialSource = '';
  try {
    const menu = await env.MENU_KV.get('menu', { type: 'json' });
    const settings = menu && menu.settings ? menu.settings : {};
    const publicWhatsApp = typeof settings.whatsapp === 'string' ? settings.whatsapp : '';
    const publicPhone = typeof settings.phone === 'string' ? settings.phone : '';
    if (!whatsapp) whatsapp = publicWhatsApp;
    dialSource = publicWhatsApp || publicPhone;
  } catch {
    // Keep the legacy digits-only behaviour when settings are unavailable.
  }
  return { whatsapp, dialCode: dialCodeFromNumber(dialSource) };
}
