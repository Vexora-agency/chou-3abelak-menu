import type { CustomerProfile } from './types';

/** Window event fired after the signed-in customer saves their profile. */
export const MEMBER_PROFILE_CHANGED = 'member-profile-changed';

/**
 * A customer account is ready to place orders when the phone and the default
 * address are present. The map pin is OPTIONAL: the written address is the
 * source of truth for delivery, and a pin only sharpens the kitchen ticket.
 * The same rule is enforced by /api/account/profile and /api/orders.
 */
export function isProfileComplete(profile: CustomerProfile | null | undefined): boolean {
  return !!(
    profile &&
    typeof profile.phone === 'string' &&
    profile.phone.trim() &&
    typeof profile.address === 'string' &&
    profile.address.trim()
  );
}
