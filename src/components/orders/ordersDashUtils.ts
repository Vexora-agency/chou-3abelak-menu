import { Store, Truck, UtensilsCrossed } from 'lucide-react';
import { STR } from '@/src/components/orders/ordersDashTypes';
import type { OrderItem, OrderStatus } from '@/src/components/orders/ordersDashTypes';

/* ---------- Helpers ---------- */
export const fmt = (n: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  if (Number.isInteger(r)) return r.toLocaleString('en-US');
  const parts = String(r).split('.');
  return `${Number(parts[0]).toLocaleString('en-US')}.${parts[1]}`;
};
export const fmtCompact = (n: number) => {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return fmt(n);
};
export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const digits = (s: string) => s.replace(/\D/g, '');
export const loc = (lang: 'en' | 'ar') => (lang === 'ar' ? 'ar-u-nu-latn' : 'en-US');

export const STATUS_STYLE: Record<OrderStatus, string> = {
  new: 'bg-[var(--primary)] text-[#0A0A0A] border border-[var(--primary)]',
  confirmed: 'bg-white/10 text-white border border-white/25',
  completed: 'bg-green-500/15 text-green-400 border border-green-500/30',
  cancelled: 'bg-red-500/10 text-red-400 border border-red-500/30',
};

export const TYPE_ICON = { delivery: Truck, pickup: Store, dinein: UtensilsCrossed } as const;

export const DAY_MS = 86400000;
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Calendar-based windows. "month" is month-to-date and is compared with the same number of days of the previous month. */
export function windowFor(period: 'today' | '7d' | 'month' | 'lastMonth', now: Date) {
  const today = startOfDay(now);
  const y = today.getFullYear(), m = today.getMonth();
  let start: Date, end: Date, prevStart: Date, prevEnd: Date, buckets: number;
  if (period === 'today') {
    start = today; end = addDays(today, 1); prevStart = addDays(today, -1); prevEnd = today; buckets = 24;
  } else if (period === '7d') {
    start = addDays(today, -6); end = addDays(today, 1); prevStart = addDays(start, -7); prevEnd = start; buckets = 7;
  } else if (period === 'month') {
    start = new Date(y, m, 1); end = addDays(today, 1); prevStart = new Date(y, m - 1, 1);
    const elapsed = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    prevEnd = new Date(Math.min(addDays(prevStart, elapsed).getTime(), start.getTime()));
    buckets = new Date(y, m + 1, 0).getDate();
  } else {
    start = new Date(y, m - 1, 1); end = new Date(y, m, 1); prevStart = new Date(y, m - 2, 1); prevEnd = start;
    buckets = new Date(y, m, 0).getDate();
  }
  return { start, end, prevStart, prevEnd, buckets };
}

export function relTime(iso: string, lang: 'en' | 'ar', now: Date) {  const t = STR[lang];
  const d = new Date(iso);
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return t.now;
  if (mins < 60) return t.min(mins);
  if (mins < 60 * 12) return t.hr(Math.floor(mins / 60));
  return d.toLocaleString(loc(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ---------- Small pieces ---------- */

/** "Zaatar & Labneh (Mashrouha) + Extra vegetables" */
export function itemTitle(it: OrderItem, lang: 'en' | 'ar'): string {
  const base = lang === 'ar' ? it.name.ar : it.name.en;
  const v = it.variantName ? ` (${lang === 'ar' ? it.variantName.ar : it.variantName.en})` : '';
  const a = it.addonNames?.length
    ? ` + ${it.addonNames.map((n) => (lang === 'ar' ? n.ar : n.en)).join(' + ')}`
    : '';
  return `${base}${v}${a}`;
}
