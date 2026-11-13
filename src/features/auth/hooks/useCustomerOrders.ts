import { useCallback, useEffect, useState } from 'react';
import { fetchMyOrders } from '../services/account.api';
import type { AccountOrder } from '../types';
import { useCustomerSession } from './useCustomerSession';

/** Last 12 months of the signed-in customer's orders. */
export function useCustomerOrders(enabled = true) {
  const { user } = useCustomerSession();
  const userId = user?.id ?? null;
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!enabled || !userId) {
      setOrders([]);
      setLoading(false);
      setError(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const data = await fetchMyOrders(365, 50);
        if (!alive) return;
        setOrders(Array.isArray(data.orders) ? data.orders : []);
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

  return { orders, loading, error, refetch };
}
