import { useCallback, useEffect, useState } from 'react';
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

  return { user, profile, loading: isPending || loading, error, refetch };
}
