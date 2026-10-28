import { useState, useEffect, useRef, useCallback } from 'react';
import type { Order, OrderStatus } from '../components/OrdersDashboard';
import { prevMonthStartISO } from '@/src/utils/tz';
import { isRecord, readJson } from '@/src/utils/safeJson';
import { adminFetch } from '@/src/lib/api-client';

interface AdminOrdersOptions {
  isAr: boolean;
  timezone: string;
  activeTab: string;
}

/** Orders dashboard data: load + 30s poll + optimistic status changes. */
export function useAdminOrders({ isAr, timezone, activeTab }: AdminOrdersOptions) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);
  const ordersTitleBase = useRef(typeof document !== 'undefined' ? document.title : '');

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) {
      setOrdersLoading(true);
      setOrdersError(false);
    }
    try {
      // from = first day of the previous month (business timezone) so the
      // Today / 7 days / This month / Last month views all work; the
      // limit=2000 cap bounds the payload.
      const tz = timezone || 'Asia/Beirut';
      const res = await adminFetch(`/api/admin/orders?from=${encodeURIComponent(prevMonthStartISO(tz))}&limit=2000`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await readJson(res);
      const rawOrders = isRecord(data) ? data.orders : undefined;
      const list: Order[] = Array.isArray(rawOrders) ? (rawOrders as Order[]) : [];
      setOrders((prev) => {
        const prevIds = new Set(prev.map((o) => o.id));
        const freshIds = list.filter((o) => !prevIds.has(o.id)).map((o) => o.id);
        if (prev.length > 0 && freshIds.length > 0 && typeof document !== 'undefined') {
          document.title = `(${freshIds.length}) ${isAr ? 'طلبات جديدة' : 'New orders'}`;
        }
        return list;
      });
      if (!silent) setOrdersLoading(false);
    } catch {
      if (!silent) {
        setOrdersLoading(false);
        setOrdersError(true);
      }
    }
  }, [isAr, timezone]);

  // Initial load + 30s poll while the tab is visible (fetch trigger: all
  // setStates happen async inside fetchOrders, no cascading render).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch trigger, see above
    void fetchOrders(false);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchOrders(true);
    }, 30000);
    return () => window.clearInterval(id);
  }, [fetchOrders]);

  // Restore the page title when the dashboard tab is viewed
  useEffect(() => {
    if (activeTab === 'dashboard' && typeof document !== 'undefined') {
      document.title = ordersTitleBase.current || document.title;
    }
  }, [activeTab]);

  const handleOrderStatusChange = async (id: string, status: OrderStatus) => {
    const prev = orders;
    setOrders((cur) => cur.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      const res = await adminFetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void fetchOrders(true);
    } catch {
      setOrders(prev);
      alert(isAr ? 'تعذر تحديث حالة الطلب. حاول مجدداً.' : 'Could not update the order status. Please try again.');
    }
  };

  return { orders, ordersLoading, ordersError, fetchOrders, handleOrderStatusChange };
}
