import { useCallback, useEffect, useState } from 'react';
import { MEMBER_PROFILE_CHANGED } from '../profile';
import { fetchMyProfile } from '../services/account.api';
import type { CustomerProfile } from '../types';
import { useCustomerSession } from './useCustomerSession';

/**
 * Profile phone/address for the signed-in customer. Fetches only while the
 * consumer is open (cart drawer / account sheet) so guests make no request.
 */
export function useCustomerProfile(enabled = true) {
  const { user, isPending } = useCustomerSession();
  const userId = user?.id ?? null;
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  // The account sheet saves the profile; every mounted consumer (checkout,
  // header, another account view) must see the new phone/address/pin without
  // a reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setVersion((v) => v + 1);
    window.addEventListener(MEMBER_PROFILE_CHANGED, sync);
    return () => window.removeEventListener(MEMBER_PROFILE_CHANGED, sync);
  }, []);

  useEffect(() => {
    if (!enabled || !userId) {
      setProfile(null);
      setLoading(false);
      setError(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const data = await fetchMyProfile();
        if (!alive) return;
        setProfile(data.profile);
      } catch {
        if (!alive) return;
        setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, userId, version]);

  // Treat "signed in but the first profile fetch has not resolved yet" as
  // loading, not as an incomplete profile: avoids a false banner/block on
  // the first render. A failed fetch sets error, so it stops counting.
  const awaitingProfile = !!userId && !profile && !error;
  return { user, profile, loading: isPending || loading || awaitingProfile, error, refetch };
}
