import { useState, useEffect, useRef, useCallback } from 'react';
import type { CronHealth, Order, OrderStatus } from '../components/OrdersDashboard';
import { prevMonthStartISO } from '@/src/utils/tz';
import { isRecord, readJson } from '@/src/utils/safeJson';
import { adminFetch } from '@/src/lib/api-client';

interface AdminOrdersOptions {
  isAr: boolean;
  timezone: string;
  activeTab: string;
  /** Plan gate: starter never fetches (no orders UI, endpoint 404s anyway). */
  enabled?: boolean;
}

/** Orders dashboard data: load + 5s poll + optimistic status changes. */
export function useAdminOrders({ isAr, timezone, activeTab, enabled = true }: AdminOrdersOptions) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);
  // Kitchen health signal (order-nag heartbeat): parsed alongside orders on
  // every poll, so the dashboard banner tracks staleness without its own
  // request. Null until the first successful fetch (or when the endpoint
  // predates the field).
  const [cronHealth, setCronHealth] = useState<CronHealth | null>(null);
  // Grace-pipeline count (number only, no PII): parsed alongside orders so
  // the dashboard can show "N in grace window" with zero extra requests.
  const [graceHidden, setGraceHidden] = useState(0);
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
      const rawHealth = isRecord(data) ? data.cronHealth : undefined;
      // Light shape check (booleans the banner branches on); a malformed
      // payload hides the banner instead of rendering garbage.
      const healthOk = isRecord(rawHealth)
        && typeof rawHealth.stale === 'boolean'
        && typeof rawHealth.critical === 'boolean';
      setCronHealth(healthOk ? (rawHealth as unknown as CronHealth) : null);
      const rawGrace = isRecord(data) ? data.graceHidden : undefined;
      setGraceHidden(typeof rawGrace === 'number' && Number.isFinite(rawGrace) && rawGrace >= 0 ? Math.floor(rawGrace) : 0);
      setOrders((prev) => {
        const prevIds = new Set(prev.map((o) => o.id));
        const freshIds = list.filter((o) => !prevIds.has(o.id)).map((o) => o.id);
        if (prev.length > 0 && freshIds.length > 0 && typeof document !== 'undefined') {
          document.title = `(${freshIds.length}) ${isAr ? 'طلبات جديدة' : 'New orders'}`;
        }
        // Skip no-op polls: a new array identity with identical content
        // re-runs layout/count-up/chart animations under the owner's finger.
        // (Orders are immutable except status/total/updatedBy, so those +
        // id suffice.)
        if (prev.length === list.length && freshIds.length === 0) {
          let same = true;
          for (let i = 0; i < list.length; i++) {
            const a = prev[i];
            const b = list[i];
            if (!a || !b || a.id !== b.id || a.status !== b.status || a.total !== b.total || a.updatedBy !== b.updatedBy || a.needsReview !== b.needsReview) {
              same = false;
              break;
            }
          }
          if (same) return prev;
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

  // Initial load + 5s poll while the tab is visible (fetch trigger: all
  // setStates happen async inside fetchOrders, no cascading render).
  // 5s: this is a kitchen screen — a new order must surface and sound in
  // seconds. Payload is capped (limit=2000) and tiny; visible-tab only.
  // Deliberately NOT 1s: every poll is a full range query + Worker request,
  // and 1s polling from one open dashboard burns ~86k requests/day — the
  // whole free-plan budget — for at most 4s of gain. The real latency is
  // the grace window (minutes, owner-tunable), never this poll.
  // Skipped entirely when the plan hides orders (starter).
  useEffect(() => {
    if (!enabled) {
      setOrdersLoading(false);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch trigger, see above
    void fetchOrders(false);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchOrders(true);
    }, 5000);
    // Instant catch-up the moment the owner looks back: focus/visible fires
    // a silent refetch, so the board is fresh without waiting for the tick.
    const catchUp = () => {
      if (document.visibilityState === 'visible') void fetchOrders(true);
    };
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('focus', catchUp);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', catchUp);
      window.removeEventListener('focus', catchUp);
    };
  }, [fetchOrders, enabled]);

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
      alert(isAr ? 'تعذر تحديث حالة الطلب. حاول مجددًا.' : 'Could not update the order status. Please try again.');
    }
  };

  return { orders, ordersLoading, ordersError, cronHealth, graceHidden, fetchOrders, handleOrderStatusChange };
}
