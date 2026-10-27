import { useEffect, useRef, useState, type FC } from 'react';
import type { Order, OrderItem, OrderStatus, OrderType, OrdersDashboardProps, Period } from '@/src/components/orders/ordersDashTypes';
import { useOrdersDashClock } from '@/src/hooks/useOrdersDashClock';
import { useOrdersDashStats } from '@/src/hooks/useOrdersDashStats';
import { OrdersDashChart, OrdersDashKpis, OrdersDashPeriodBar, OrdersDashTopItems } from '@/src/components/orders/OrdersDashPanels';
import { OrdersDashList } from '@/src/components/orders/OrdersDashList';

export type { Order, OrderItem, OrderStatus, OrderType, Period };

/* ---------- Main component ---------- */
const OrdersDashboard: FC<OrdersDashboardProps> = ({ lang, orders, currency, loading, onStatusChange, onRefresh }) => {
  const isAr = lang === 'ar';
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  const { now } = useOrdersDashClock();

  const [period, setPeriod] = useState<Period>('7d');
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(6);
  const [sel, setSel] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  const { sorted, stats, pendingCount, counts, list } = useOrdersDashStats({
    orders, period, lang, now, filter, sel,
  });

  // Flash the newest order when a new one arrives
  const topId = sorted[0]?.id;
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (seen.current && topId && topId !== seen.current) {
      setFlashId(topId);
      setFilter('all');
      const x = window.setTimeout(() => setFlashId(null), 3200);
      seen.current = topId;
      return () => window.clearTimeout(x);
    }
    seen.current = topId;
  }, [topId]);

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <OrdersDashPeriodBar
        lang={lang}
        period={period}
        onPeriodChange={(p) => { setPeriod(p); setSel(null); }}
        onRefresh={onRefresh}
      />
      <OrdersDashKpis
        lang={lang}
        currency={currency}
        stats={stats}
        pendingCount={pendingCount}
        onShowNew={() => { setFilter('new'); document.getElementById('orders-list')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }}
      />
      <OrdersDashChart
        lang={lang}
        currency={currency}
        period={period}
        stats={stats}
        sel={sel}
        onSelChange={(i) => setSel(i)}
      />
      <OrdersDashTopItems lang={lang} period={period} stats={stats} />
      <OrdersDashList
        lang={lang}
        currency={currency}
        loading={loading}
        totalCount={sorted.length}
        list={list}
        counts={counts}
        filter={filter}
        onFilterChange={(s) => { setFilter(s); setLimit(6); }}
        limit={limit}
        onShowMore={() => setLimit((l) => l + 6)}
        openId={openId}
        onToggleOpen={(id) => setOpenId(id)}
        flashId={flashId}
        now={now}
        onStatusChange={onStatusChange}
      />
    </div>
  );
};

export default OrdersDashboard;
