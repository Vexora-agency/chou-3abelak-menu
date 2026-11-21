/**
 * GET/PATCH /api/account/profile
 *
 * The signed-in customer's own profile. Name/email/image live in Better
 * Auth's user table (name updates go through authClient.updateUser); the
 * optional phone/address live in customer_profiles.
 *
 * Every request is session-gated; the user id always comes from the session.
 */

import { jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { checkCustomerApiHeaders, requireCustomer } from '../../_shared/auth-session.js';
import { getCustomerProfile, upsertCustomerProfile } from '../../_shared/repositories/customers.repo.js';
import { findValidVerification } from '../../_shared/repositories/phone-verifications.repo.js';
import { verificationValidUntil } from '../../_shared/phone-verification.js';
import { authErrorMessage, normalizePhoneDigits, validateProfileAddress, validateProfileLocation, validateProfilePhone } from '../../_shared/validate-auth.js';

function publicUser(user) {
  return {
    id: user.id,
    name: typeof user.name === 'string' ? user.name : '',
    email: typeof user.email === 'string' ? user.email : '',
    image: typeof user.image === 'string' && user.image ? user.image : null,
    createdAt: user.createdAt || null,
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'PATCH') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, PATCH' });
  }

  const gate = checkCustomerApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const auth = await requireCustomer(request, env);
  if (!auth.ok) return auth.response;

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable' }, 503);

  if (request.method === 'GET') {
    try {
      const row = await getCustomerProfile(db, auth.user.id);
      return jsonNoStore({
        user: publicUser(auth.user),
        profile: {
          phone: row && row.phone ? row.phone : null,
          phoneVerified: !!(row && row.phoneVerified),
          phoneVerifiedUntil: (row && row.phoneVerifiedUntil) || null,
          address: row && row.address ? row.address : null,
          location: row && row.location ? row.location : null,
          updatedAt: row && row.profileUpdatedAt ? row.profileUpdatedAt : null,
        },
      });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  let body;
  try {
    body = await readJsonBody(request, 8 * 1024);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  const phone = validateProfilePhone(body && body.phone);
  if (!phone.ok) {
    return jsonNoStore({ error: phone.code, message: authErrorMessage(phone.code) }, 400);
  }
  if (!phone.phone) {
    return jsonNoStore({ error: 'phone_required', message: authErrorMessage('phone_required') }, 400);
  }
  const address = validateProfileAddress(body && body.address);
  if (!address.ok) {
    return jsonNoStore({ error: address.code, message: authErrorMessage(address.code) }, 400);
  }
  if (!address.address) {
    return jsonNoStore({ error: 'address_required', message: authErrorMessage('address_required') }, 400);
  }
  const location = validateProfileLocation(body && body.location);
  if (!location.ok) {
    return jsonNoStore({ error: location.code, message: authErrorMessage(location.code) }, 400);
  }
  // The map pin is OPTIONAL. The written default address is enough; a pin
  // only sharpens the kitchen ticket. Keep the stored point in sync with the
  // submitted one (null clears it), never inventing a point for the text.

  try {
    const current = await getCustomerProfile(db, auth.user.id);
    const currentPhone = current && typeof current.phone === 'string'
      ? normalizePhoneDigits(current.phone)
      : '';
    const nextPhone = normalizePhoneDigits(phone.phone);
    // A NEW number must be proven first (reverse WhatsApp verification).
    // An unchanged number keeps its existing state: the order gate still
    // refuses an unverified number, but saving the address is not blocked.
    if (nextPhone && nextPhone !== currentPhone) {
      const approved = await findValidVerification(db, auth.user.id, nextPhone, Date.now());
      if (!approved) {
        return jsonNoStore({
          error: 'phone_verification_required',
          phone: nextPhone,
          message: {
            en: 'Verify this phone number on WhatsApp before saving it.',
            ar: 'أكّد رقم الهاتف هذا عبر واتساب قبل حفظه.',
          },
        }, 403);
      }
    }

    const saved = await upsertCustomerProfile(
      db,
      auth.user.id,
      {
        phone: phone.phone,
        address: address.address,
        location: address.address ? location.location : null,
      },
      new Date().toISOString()
    );
    const approved = await findValidVerification(db, auth.user.id, saved.phone, Date.now());
    return jsonNoStore({
      ok: true,
      profile: {
        ...saved,
        phoneVerified: !!approved,
        phoneVerifiedUntil: approved ? verificationValidUntil(approved) : null,
      },
    });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
