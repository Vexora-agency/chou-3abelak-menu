import { useMemo } from 'react';
import { DAY_MS, loc, startOfDay, windowFor } from '../components/orders/ordersDashUtils';
import type { Order, OrderStatus, Period } from '../components/orders/ordersDashTypes';

interface DashStatsArgs {
  orders: Order[];
  period: Period;
  lang: 'en' | 'ar';
  now: Date;
  filter: 'all' | OrderStatus;
  sel: number | null;
}

export function useOrdersDashStats({ orders, period, lang, now, filter, sel }: DashStatsArgs) {
  const sorted = useMemo(() => [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)), [orders]);

  const stats = useMemo(() => {
    const { start, end, prevStart, prevEnd, buckets: bucketCount } = windowFor(period, now);
    // Revenue logic: money counts ONLY when the order is fulfilled
    // (status completed). New/confirmed are pipeline — visible via the
    // pending badge and status filters, never in revenue/avg/count.
    const done = (o: Order) => o.status === 'completed';
    const inPeriod = sorted.filter((o) => { const d = new Date(o.createdAt); return d >= start && d < end && d <= now; });
    const inWin = inPeriod.filter(done);
    const inPrev = sorted.filter((o) => { const d = new Date(o.createdAt); return d >= prevStart && d < prevEnd && done(o); });
    const sum = (a: Order[]) => a.reduce((s, o) => s + o.total, 0);
    const revenue = sum(inWin), prevRevenue = sum(inPrev);

    const n = bucketCount;
    const buckets = Array.from({ length: n }, () => ({ count: 0, revenue: 0, label: '', full: '' }));
    buckets.forEach((b, i) => {
      if (period === 'today') {
        // 12-hour clock, compact axis + full readout:
        // EN "6p" / "6:00 PM" — AR "6م" / "6:00 م" (18:00 never shows).
        const am = i < 12;
        const h12 = i % 12 === 0 ? 12 : i % 12;
        if (lang === 'ar') {
          b.label = i % 6 === 0 ? `${h12}${am ? 'ص' : 'م'}` : '';
          b.full = `${h12}:00 ${am ? 'ص' : 'م'}`;
        } else {
          b.label = i % 6 === 0 ? `${h12}${am ? 'a' : 'p'}` : '';
          b.full = `${h12}:00 ${am ? 'AM' : 'PM'}`;
        }
      } else {
        const d = new Date(start); d.setDate(d.getDate() + i);
        b.full = d.toLocaleDateString(loc(lang), { weekday: 'short', day: 'numeric', month: 'short' });
        b.label = period === '7d' ? d.toLocaleDateString(loc(lang), { weekday: 'short' }) : (i % 5 === 0 || i === n - 1 ? String(d.getDate()) : '');
      }
    });
    inWin.forEach((o) => {
      const d = new Date(o.createdAt);
      const i = period === 'today' ? d.getHours() : Math.round((startOfDay(d).getTime() - start.getTime()) / DAY_MS);
      if (buckets[i]) { buckets[i].count += 1; buckets[i].revenue += o.total; }
    });
    const max = Math.max(1, ...buckets.map((b) => b.count));
    const peak = buckets.reduce((bi, b, i, arr) => (b.count > arr[bi].count ? i : bi), 0);

    const itemMap = new Map<string, { name: { en: string; ar: string }; qty: number; revenue: number }>();
    inWin.forEach((o) => o.items.forEach((it) => {
      const e = itemMap.get(it.id) ?? { name: it.name, qty: 0, revenue: 0 };
      e.qty += it.qty; e.revenue += it.qty * it.unitPrice; itemMap.set(it.id, e);
    }));
    const top = [...itemMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

    return { inPeriod, count: inWin.length, prevCount: inPrev.length, revenue, prevRevenue, avg: inWin.length ? revenue / inWin.length : 0,
      prevAvg: inPrev.length ? prevRevenue / inPrev.length : 0, buckets, max, peak, top };
  }, [sorted, period, lang, now]);

  const pendingCount = sorted.filter((o) => o.status === 'new').length;
  const counts: Record<string, number> = { all: stats.inPeriod.length, new: 0, completed: 0, cancelled: 0 };
  stats.inPeriod.forEach((o) => { if (counts[o.status] !== undefined) counts[o.status] += 1; });
  const list = stats.inPeriod.filter((o) => filter === 'all' || o.status === filter);
  const shownIdx = sel ?? stats.peak;
  const sb = stats.buckets[shownIdx];

  return { sorted, stats, pendingCount, counts, list, shownIdx, sb };
}
