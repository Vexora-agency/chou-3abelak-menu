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
import {
  expireStaleApproved,
  findValidVerification,
  phoneOwnedByAnotherUser,
  revokeUserVerifications,
} from '../../_shared/repositories/phone-verifications.repo.js';
import { PHONE_LINKED_ERROR, PHONE_LINKED_MESSAGE, verificationValidUntil } from '../../_shared/phone-verification.js';
import { authErrorMessage, validateProfileAddress, validateProfileLocation, validateProfilePhone } from '../../_shared/validate-auth.js';

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
    // Saving a changed number is intentionally NOT gated by verification:
    // the member can keep their profile current, and the order route still
    // refuses to place an order on an unverified number. This keeps "Save
    // changes" fast while the ownership gate stays at checkout.
    //
    // Two security rules sit beside that choice:
    //  1. a number already verified by ANOTHER member is refused here too, so
    //     the member gets the reason immediately (and the order gate repeats
    //     it);
    //  2. changing the saved number revokes every live proof for this member.
    //     Moving to a sibling's number and back therefore requires a fresh
    //     verification of the original number.
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const previous = await getCustomerProfile(db, auth.user.id);
    const previousPhone = previous && previous.phone ? previous.phone : null;
    const phoneChanged = previousPhone !== phone.phone;

    await expireStaleApproved(db, nowMs, phone.phone);
    if (await phoneOwnedByAnotherUser(db, phone.phone, auth.user.id, nowMs)) {
      return jsonNoStore({ error: PHONE_LINKED_ERROR, message: PHONE_LINKED_MESSAGE }, 409);
    }
    if (phoneChanged) {
      await revokeUserVerifications(db, auth.user.id, nowIso, 'profile_phone_changed');
    }

    const saved = await upsertCustomerProfile(
      db,
      auth.user.id,
      {
        phone: phone.phone,
        address: address.address,
        location: address.address ? location.location : null,
      },
      nowIso
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
