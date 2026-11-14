import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMyOrders } from '../services/account.api';
import type { AccountOrder } from '../types';
import { useCustomerSession } from './useCustomerSession';

/** How often the open account sheet refreshes active order states. */
const LIVE_REFRESH_MS = 30000;

/**
 * Last 12 months of the signed-in customer's orders.
 *
 * While the account sheet is open this also acts as the member's live order
 * surface (the floating bell is guest-only): a silent 30 s refresh plus a
 * catch-up refresh when the tab becomes visible keeps statuses, unlock
 * countdowns and actions current without flashing skeletons.
 */
export function useCustomerOrders(enabled = true, activeOnly = false) {
  const { user } = useCustomerSession();
  const userId = user?.id ?? null;
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const silentRef = useRef(false);

  const refetch = useCallback((silent = false) => {
    silentRef.current = silent;
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !userId) {
      setOrders([]);
      setLoading(false);
      setLoaded(false);
      setError(false);
      return;
    }
    let alive = true;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) setLoading(true);
    setError(false);
    void (async () => {
      try {
        const data = await fetchMyOrders(365, activeOnly ? 20 : 50, activeOnly);
        if (!alive) return;
        setOrders(Array.isArray(data.orders) ? data.orders : []);
      } catch {
        if (!alive) return;
        setError(true);
      } finally {
        if (alive) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, userId, version, activeOnly]);

  // Members have no floating bell: keep the open sheet fresh instead.
  useEffect(() => {
    if (!enabled || !userId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refetch(true);
    }, LIVE_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, userId, refetch]);

  // Checkout/account actions ping this event so the header badge and the
  // open sheet update immediately instead of waiting for the next poll.
  useEffect(() => {
    if (!enabled || !userId) return;
    const onChange = () => refetch(true);
    window.addEventListener('member-orders-changed', onChange);
    window.addEventListener('customer-orders-changed', onChange);
    return () => {
      window.removeEventListener('member-orders-changed', onChange);
      window.removeEventListener('customer-orders-changed', onChange);
    };
  }, [enabled, userId, refetch]);

  return { orders, loading, loaded, error, refetch };
}
