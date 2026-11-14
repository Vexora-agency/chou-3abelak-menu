import type { CustomerProfile } from './types';

/** Window event fired after the signed-in customer saves their profile. */
export const MEMBER_PROFILE_CHANGED = 'member-profile-changed';

/**
 * A customer account is ready to place orders only when the phone, the
 * default address, and the address pin are all present. The same rule is
 * enforced by /api/account/profile and /api/orders.
 */
export function isProfileComplete(profile: CustomerProfile | null | undefined): boolean {
  return !!(
    profile &&
    typeof profile.phone === 'string' &&
    profile.phone.trim() &&
    typeof profile.address === 'string' &&
    profile.address.trim() &&
    profile.location &&
    Number.isFinite(profile.location.lat) &&
    Number.isFinite(profile.location.lng)
  );
}
