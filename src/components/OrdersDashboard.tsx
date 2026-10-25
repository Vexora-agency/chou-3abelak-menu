import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion } from 'motion/react';
import {
  Banknote, BellRing, Check, ChevronDown, Inbox, MapPin, MessageCircle, Phone, Receipt,
  RefreshCw, ShoppingBag, Store, TrendingDown, TrendingUp, Truck, UtensilsCrossed, X,
} from 'lucide-react';

/* ---------- Types (the API should return exactly this shape) ---------- */
export type OrderStatus = 'new' | 'confirmed' | 'completed' | 'cancelled';
export type OrderType = 'delivery' | 'pickup' | 'dinein';

export interface OrderItem {
  id: string;
  name: { en: string; ar: string };
  variantId?: string;
  variantName?: { en: string; ar: string };
  addonIds?: string[];
  addonNames?: { en: string; ar: string }[];
  qty: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  number: number;
  createdAt: string; // ISO date
  status: OrderStatus;
  type: OrderType;
  customer: { name: string; phone: string; address?: string; table?: string };
  notes?: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
}

interface OrdersDashboardProps {
  lang: 'en' | 'ar';
  orders: Order[];
  currency: string;
  loading?: boolean;
  onStatusChange: (id: string, status: OrderStatus) => void;
  onRefresh?: () => void;
}

type Period = 'today' | '7d' | '30d';

const STR = {
  en: {
    today: 'Today', d7: '7 days', d30: '30 days', refresh: 'Refresh', live: 'Live',
    orders: 'Orders', revenue: 'Revenue', avg: 'Avg. order', pending: 'Awaiting you',
    vsPrev: 'vs previous', over: 'Orders over time', peak: 'Peak', ordersWord: 'orders',
    top: 'Top sellers', sold: 'sold',
    recent: 'Recent orders', all: 'All', showMore: 'Show more',
    new: 'New', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled',
    emptyTitle: 'No orders yet', emptyDesc: 'Orders placed from your menu will appear here instantly.',
    emptyView: 'No orders in this view.', noData: 'No data for this period.',
    itemsLabel: 'Items', phone: 'Phone', address: 'Address', table: 'Table', notes: 'Notes',
    subtotal: 'Subtotal', fee: 'Delivery fee', total: 'Total',
    complete: 'Mark completed', cancel: 'Cancel order', reopen: 'Reopen',
    wa: 'WhatsApp', call: 'Call', now: 'Just now',
    min: (n: number) => `${n} min ago`, hr: (n: number) => `${n}h ago`,
  },
  ar: {
    today: 'اليوم', d7: '7 أيام', d30: '30 يوماً', refresh: 'تحديث', live: 'مباشر',
    orders: 'الطلبات', revenue: 'الإيرادات', avg: 'متوسط الطلب', pending: 'بانتظارك',
    vsPrev: 'عن السابقة', over: 'الطلبات عبر الوقت', peak: 'الذروة', ordersWord: 'طلب',
    top: 'الأكثر مبيعاً', sold: 'مباع',
    recent: 'آخر الطلبات', all: 'الكل', showMore: 'عرض المزيد',
    new: 'جديد', confirmed: 'مؤكد', completed: 'مكتمل', cancelled: 'ملغي',
    emptyTitle: 'لا توجد طلبات بعد', emptyDesc: 'الطلبات القادمة من المنيو ستظهر هنا فوراً.',
    emptyView: 'لا توجد طلبات في هذا العرض.', noData: 'لا توجد بيانات لهذه الفترة.',
    itemsLabel: 'الأصناف', phone: 'الهاتف', address: 'العنوان', table: 'الطاولة', notes: 'ملاحظات',
    subtotal: 'المجموع الفرعي', fee: 'رسوم التوصيل', total: 'الإجمالي',
    complete: 'تم التسليم', cancel: 'إلغاء الطلب', reopen: 'إعادة فتح',
    wa: 'واتساب', call: 'اتصال', now: 'الآن',
    min: (n: number) => `قبل ${n} د`, hr: (n: number) => `قبل ${n} س`,
  },
} as const;

/* ---------- Helpers ---------- */
const fmt = (n: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  if (Number.isInteger(r)) return r.toLocaleString('en-US');
  const parts = String(r).split('.');
  return `${Number(parts[0]).toLocaleString('en-US')}.${parts[1]}`;
};
const fmtCompact = (n: number) => {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return fmt(n);
};
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const digits = (s: string) => s.replace(/\D/g, '');
const loc = (lang: 'en' | 'ar') => (lang === 'ar' ? 'ar-u-nu-latn' : 'en-US');

const STATUS_STYLE: Record<OrderStatus, string> = {
  new: 'bg-[#FFC400] text-[#0A0A0A] border border-[#FFC400]',
  confirmed: 'bg-white/10 text-white border border-white/25',
  completed: 'bg-green-500/15 text-green-400 border border-green-500/30',
  cancelled: 'bg-red-500/10 text-red-400 border border-red-500/30',
};

const TYPE_ICON = { delivery: Truck, pickup: Store, dinein: UtensilsCrossed } as const;

function windowFor(period: Period, now: Date) {
  const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
  const start = startOfDay(now);
  start.setDate(start.getDate() - (days - 1));
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - days);
  return { days, start, prevStart };
}

function relTime(iso: string, lang: 'en' | 'ar', now: Date) {  const t = STR[lang];
  const d = new Date(iso);
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return t.now;
  if (mins < 60) return t.min(mins);
  if (mins < 60 * 12) return t.hr(Math.floor(mins / 60));
  return d.toLocaleString(loc(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ---------- Small pieces ---------- */

/** "Zaatar & Labneh (Mashrouha) + Extra vegetables" */
function itemTitle(it: OrderItem, lang: 'en' | 'ar'): string {
  const base = lang === 'ar' ? it.name.ar : it.name.en;
  const v = it.variantName ? ` (${lang === 'ar' ? it.variantName.ar : it.variantName.en})` : '';
  const a = it.addonNames?.length
    ? ` + ${it.addonNames.map((n) => (lang === 'ar' ? n.ar : n.en)).join(' + ')}`
    : '';
  return `${base}${v}${a}`;
}
const CountUp: React.FC<{ value: number; format: (n: number) => string }> = ({ value, format }) => {
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  const from = useRef(0);
  const [text, setText] = useState(() => format(reduce ? value : 0));
  useEffect(() => {
    if (reduce) { setText(format(value)); from.current = value; return; }
    const c = animate(from.current, value, {
      duration: 0.9, ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setText(format(v)),
      onComplete: () => { from.current = value; },
    });
    return () => c.stop();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{text}</>;
};

const Delta: React.FC<{ cur: number; prev: number }> = ({ cur, prev }) => {
  if (prev <= 0) return <span className="text-[11px] text-neutral-500">—</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${up ? 'text-green-400' : 'text-red-400'}`}>
      <Icon size={12} aria-hidden="true" />
      <span dir="ltr">{up ? '+' : ''}{pct}%</span>
    </span>
  );
};

const card = 'p-4 rounded-2xl bg-neutral-900 border border-neutral-800';

/* ---------- Main component ---------- */
const OrdersDashboard: React.FC<OrdersDashboardProps> = ({ lang, orders, currency, loading, onStatusChange, onRefresh }) => {
  const t = STR[lang];
  const isAr = lang === 'ar';
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  // Fresh clock for the stats window + relative times (refreshed every minute
  // so "today" and "x min ago" never go stale while the panel stays open).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const h2 = `text-sm font-extrabold text-[#FFC400] ${isAr ? '' : 'uppercase tracking-wider'}`;
  const lbl = `text-[11px] font-semibold text-neutral-400 ${isAr ? '' : 'uppercase tracking-wide'}`;

  const [period, setPeriod] = useState<Period>('7d');
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(6);
  const [sel, setSel] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [spin, setSpin] = useState(false);

  const sorted = useMemo(() => [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)), [orders]);

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

  const stats = useMemo(() => {
    const { days, start, prevStart } = windowFor(period, now);
    const live = (o: Order) => o.status !== 'cancelled';
    // Upper bound (<= now): a future-dated row must never inflate the KPIs
    // while being invisible in the chart buckets.
    const inWin = sorted.filter((o) => { const d = new Date(o.createdAt); return d >= start && d <= now && live(o); });
    const inPrev = sorted.filter((o) => { const d = new Date(o.createdAt); return d >= prevStart && d < start && live(o); });
    const sum = (a: Order[]) => a.reduce((s, o) => s + o.total, 0);
    const revenue = sum(inWin), prevRevenue = sum(inPrev);

    const n = period === 'today' ? 24 : days;
    const buckets = Array.from({ length: n }, (_, i) => ({ count: 0, revenue: 0, label: '', full: '' }));
    buckets.forEach((b, i) => {
      if (period === 'today') {
        b.label = i % 6 === 0 ? String(i).padStart(2, '0') : '';
        b.full = `${String(i).padStart(2, '0')}:00`;
      } else {
        const d = new Date(start); d.setDate(d.getDate() + i);
        b.full = d.toLocaleDateString(loc(lang), { weekday: 'short', day: 'numeric', month: 'short' });
        b.label = period === '7d' ? d.toLocaleDateString(loc(lang), { weekday: 'short' }) : (i % 5 === 0 || i === n - 1 ? String(d.getDate()) : '');
      }
    });
    inWin.forEach((o) => {
      const d = new Date(o.createdAt);
      const i = period === 'today' ? d.getHours() : Math.round((startOfDay(d).getTime() - start.getTime()) / 86400000);
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

    return { count: inWin.length, prevCount: inPrev.length, revenue, prevRevenue, avg: inWin.length ? revenue / inWin.length : 0,
      prevAvg: inPrev.length ? prevRevenue / inPrev.length : 0, buckets, max, peak, top };
  }, [sorted, period, lang, nowMs]);

  const pendingCount = sorted.filter((o) => o.status === 'new').length;
  const counts: Record<string, number> = { all: sorted.length, new: 0, completed: 0, cancelled: 0 };
  sorted.forEach((o) => { if (counts[o.status] !== undefined) counts[o.status] += 1; });
  const list = sorted.filter((o) => filter === 'all' || o.status === filter);
  const shownIdx = sel ?? stats.peak;
  const sb = stats.buckets[shownIdx];

  const rise = (delay: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  const kpis = [
    { key: 'orders', label: t.orders, icon: ShoppingBag, value: stats.count, format: fmt, delta: <Delta cur={stats.count} prev={stats.prevCount} /> },
    { key: 'revenue', label: t.revenue, icon: Banknote, value: stats.revenue, format: fmtCompact, unit: currency, delta: <Delta cur={stats.revenue} prev={stats.prevRevenue} /> },
    { key: 'avg', label: t.avg, icon: Receipt, value: stats.avg, format: fmtCompact, unit: currency, delta: <Delta cur={stats.avg} prev={stats.prevAvg} /> },
  ];

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Period + refresh */}
      <motion.div {...rise(0)} className="flex items-center justify-between gap-3">
        <div className="flex gap-1.5 p-1 bg-neutral-900 rounded-full border border-neutral-800" role="tablist" aria-label="Period">
          {(['today', '7d', '30d'] as const).map((p) => {
            const active = period === p;
            return (
              <button key={p} type="button" role="tab" aria-selected={active}
                onClick={() => { setPeriod(p); setSel(null); }}
                className={`relative px-3.5 h-8 rounded-full text-xs font-bold transition-colors ${active ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}>
                {active && <motion.span layoutId="dash-period" className="absolute inset-0 rounded-full bg-[#FFC400] shadow-md" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative z-10">{p === 'today' ? t.today : p === '7d' ? t.d7 : t.d30}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-neutral-400">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60 animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" /></span>
            {t.live}
          </span>
          <button type="button" aria-label={t.refresh}
            onClick={() => { setSpin(true); onRefresh?.(); window.setTimeout(() => setSpin(false), 700); }}
            className="btn-tactile w-9 h-9 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-[#FFC400] flex items-center justify-center">
            <RefreshCw size={15} className={spin ? 'animate-spin' : ''} />
          </button>
        </div>
      </motion.div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map((k, i) => (
          <motion.div key={k.key} {...rise(0.06 + i * 0.06)} className={card}>
            <div className="flex items-center justify-between">
              <span className={lbl}>{k.label}</span>
              <span className="w-8 h-8 rounded-xl bg-[#FFC400]/10 text-[#FFC400] flex items-center justify-center"><k.icon size={16} /></span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums" dir="ltr"><CountUp value={k.value} format={k.format} /></span>
              {k.unit && <span className="text-[11px] font-bold text-neutral-500">{k.unit}</span>}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">{k.delta}<span className="text-[10px] text-neutral-500 truncate">{t.vsPrev}</span></div>
          </motion.div>
        ))}
        <motion.button type="button" {...rise(0.24)}
          onClick={() => { setFilter('new'); document.getElementById('orders-list')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }}
          className={`${card} text-start btn-tactile ${pendingCount ? 'border-[#FFC400]/60! bg-[#FFC400]/[0.06]' : ''}`}>
          <div className="flex items-center justify-between">
            <span className={lbl}>{t.pending}</span>
            <span className="w-8 h-8 rounded-xl bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center">
              <BellRing size={16} className={pendingCount && !reduce ? 'animate-[wiggle_1.6s_ease-in-out_infinite]' : ''} />
            </span>
          </div>
          <div className="mt-2 text-2xl font-black tabular-nums" dir="ltr"><CountUp value={pendingCount} format={fmt} /></div>
          <div className="mt-1.5 text-[10px] text-neutral-500">{t.new}</div>
        </motion.button>
      </div>

      {/* Chart */}
      <motion.div {...rise(0.3)} className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 className={h2}>{t.over}</h2>
          <span className="text-[11px] text-neutral-400 text-end">
            {stats.count ? <><b className="text-white">{sb.full}</b> · {sb.count} {t.ordersWord} · <span dir="ltr">{fmtCompact(sb.revenue)} {currency}</span></> : t.noData}
          </span>
        </div>
        <div className="mt-4 flex items-end gap-[3px] h-36" dir="ltr" role="img"
          aria-label={`${t.over}: ${stats.count} ${t.ordersWord}`} onMouseLeave={() => setSel(null)}>
          {stats.buckets.map((b, i) => {
            const pct = b.count ? Math.max(6, (b.count / stats.max) * 100) : 2;
            const active = i === shownIdx && stats.count > 0;
            return (
              <button key={`${period}-${i}`} type="button" onMouseEnter={() => setSel(i)} onClick={() => setSel(i)}
                aria-label={`${b.full}: ${b.count} ${t.ordersWord}`} className="group relative flex-1 h-full flex items-end focus-visible:outline-none">
                <motion.span
                  className={`block w-full max-w-[48px] mx-auto rounded-t-[4px] transition-colors ${active ? 'bg-[#FFC400]' : b.count ? 'bg-[#FFC400]/45 group-hover:bg-[#FFC400]/75' : 'bg-neutral-800'}`}
                  initial={reduce ? false : { height: 0 }} animate={{ height: `${pct}%` }}
                  transition={{ duration: 0.6, delay: reduce ? 0 : i * 0.015, ease: [0.22, 1, 0.36, 1] }} />
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-[3px]" dir="ltr" aria-hidden="true">
          {stats.buckets.map((b, i) => <span key={i} className="flex-1 text-center text-[10px] text-neutral-500 whitespace-nowrap overflow-visible">{b.label}</span>)}
        </div>
      </motion.div>

      {/* Top items */}
      <motion.div {...rise(0.36)} className={card}>
        <h2 className={h2}>{t.top}</h2>
        <div className="mt-3 space-y-3">
          {stats.top.length === 0 && <p className="text-xs text-neutral-500">{t.noData}</p>}
          {stats.top.map((it, i) => (
            <div key={`${period}-${i}-${it.name.en}`}>
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="font-semibold truncate"><span className="text-neutral-500 me-1.5 tabular-nums">{i + 1}</span>{isAr ? it.name.ar : it.name.en}</span>
                <span className="shrink-0 text-xs text-neutral-400 tabular-nums"><b className="text-white">{it.qty}</b> {t.sold}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                <motion.div className="h-full rounded-full bg-[#FFC400]" initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${(it.qty / stats.top[0].qty) * 100}%` }} transition={{ duration: 0.7, delay: reduce ? 0 : 0.1 + i * 0.07, ease: [0.22, 1, 0.36, 1] }} />
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Orders list */}
      <motion.div {...rise(0.48)} id="orders-list" className="scroll-mt-4 pt-2">
        <h2 className={h2}>{t.recent}</h2>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          {(['all', 'new', 'completed', 'cancelled'] as const).map((s) => {
            const active = filter === s;
            return (
              <button key={s} type="button" onClick={() => { setFilter(s); setLimit(6); }} aria-pressed={active}
                className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold border transition-colors ${active ? 'bg-[#FFC400] text-[#0A0A0A] border-[#FFC400]' : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-neutral-600'}`}>
                {t[s]} <span className={`ms-1 tabular-nums ${active ? 'text-[#0A0A0A]/70' : 'text-neutral-500'}`}>{counts[s]}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 space-y-2.5">
          {loading && [0, 1, 2].map((i) => <div key={i} className="h-[72px] rounded-2xl bg-neutral-900 border border-neutral-800 animate-pulse" />)}
          {!loading && sorted.length === 0 && (
            <div className={`${card} py-10 text-center`}>
              <Inbox size={34} className="mx-auto text-[#FFC400]/70" />
              <p className="mt-3 text-sm font-extrabold">{t.emptyTitle}</p>
              <p className="mt-1 text-xs text-neutral-500">{t.emptyDesc}</p>
            </div>
          )}
          {!loading && sorted.length > 0 && list.length === 0 && <p className="text-center text-xs text-neutral-500 py-8">{t.emptyView}</p>}

          <AnimatePresence initial={false}>
            {list.slice(0, limit).map((o) => {
              const open = openId === o.id;
              const TypeIcon = TYPE_ICON[o.type as OrderType] ?? Store;
              return (
                <motion.div key={o.id} layout={reduce ? false : 'position'}
                  initial={reduce ? false : { opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className={`rounded-2xl bg-neutral-900 border transition-colors ${flashId === o.id ? 'border-[#FFC400] shadow-[0_0_0_3px_rgba(255,196,0,0.18)]' : 'border-neutral-800'}`}>
                  <button type="button" onClick={() => setOpenId(open ? null : o.id)} aria-expanded={open}
                    className="w-full text-start p-3.5 flex items-center gap-3">
                    <span className="shrink-0 w-10 h-10 rounded-xl bg-black border border-neutral-800 text-[#FFC400] flex items-center justify-center"><TypeIcon size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <b className="text-sm tabular-nums">#{o.number}</b>
                        <span className="text-sm font-semibold truncate">{o.customer.name}</span>
                      </span>
                      <span className="block text-[11px] text-neutral-500 truncate mt-0.5">
                        {relTime(o.createdAt, lang, now)} · {o.items.map((it) => `${it.qty}× ${itemTitle(it, lang)}`).join(', ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block text-sm font-extrabold tabular-nums" dir="ltr">{fmt(o.total)}</span>
                      <span className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${STATUS_STYLE[o.status]}`}>
                        {o.status === 'new' && <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A] animate-pulse" />}
                        {t[o.status]}
                      </span>
                    </span>
                    <ChevronDown size={16} className={`shrink-0 text-neutral-500 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                        <div className="px-3.5 pb-3.5 pt-3 border-t border-neutral-800 space-y-3 text-[13px]">
                          <div className="space-y-1.5">
                            <p className={`text-[11px] font-bold text-neutral-500 ${isAr ? '' : 'uppercase tracking-wide'}`}>{t.itemsLabel}</p>
                            {o.items.map((it, idx) => (
                              <div key={`${it.id}-${idx}`} className="flex justify-between gap-3">
                                <span><b className="tabular-nums">{it.qty}×</b> {itemTitle(it, lang)}</span>
                                <span className="text-neutral-400 tabular-nums whitespace-nowrap" dir="ltr">{fmt(it.qty)} × {fmt(it.unitPrice)} = {fmt(it.qty * it.unitPrice)}</span>
                              </div>
                            ))}
                            <div className="pt-1.5 border-t border-neutral-800 space-y-1 text-xs text-neutral-400">
                              <div className="flex justify-between"><span>{t.subtotal}</span><span className="tabular-nums" dir="ltr">{fmt(o.subtotal)}</span></div>
                              {o.deliveryFee > 0 && <div className="flex justify-between"><span>{t.fee}</span><span className="tabular-nums" dir="ltr">{fmt(o.deliveryFee)}</span></div>}
                              <div className="flex justify-between text-sm font-extrabold text-white"><span>{t.total}</span><span className="tabular-nums" dir="ltr">{fmt(o.total)} {currency}</span></div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center gap-2 text-neutral-300"><Phone size={14} className="text-[#FFC400] shrink-0" /><span dir="ltr">{o.customer.phone}</span></div>
                            {(o.customer.address || o.customer.table) && (
                              <div className="flex items-center gap-2 text-neutral-300"><MapPin size={14} className="text-[#FFC400] shrink-0" /><span>{o.customer.address ?? `${t.table} ${o.customer.table}`}</span></div>
                            )}
                          </div>
                          {o.notes && <p className="text-xs text-neutral-300 bg-black/50 rounded-xl border border-neutral-800 px-3 py-2"><b className="text-neutral-500">{t.notes}: </b>{o.notes}</p>}

                          <div className="flex flex-wrap gap-2 pt-1">
                            {/* One-step flow: a new order goes straight to completed.
                                ('confirmed' is only kept for old rows — the API still accepts it.) */}
                            {(o.status === 'new' || o.status === 'confirmed') && <button type="button" onClick={() => onStatusChange(o.id, 'completed')} className="btn-tactile h-10 px-4 rounded-full bg-[#FFC400] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5"><Check size={14} strokeWidth={3} />{t.complete}</button>}
                            {(o.status === 'completed' || o.status === 'cancelled') && <button type="button" onClick={() => onStatusChange(o.id, 'new')} className="btn-tactile h-10 px-4 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold">{t.reopen}</button>}
                            {(o.status === 'new' || o.status === 'confirmed') && <button type="button" onClick={() => onStatusChange(o.id, 'cancelled')} className="btn-tactile h-10 px-4 rounded-full border border-red-500/40 text-red-400 text-xs font-bold inline-flex items-center gap-1.5"><X size={14} />{t.cancel}</button>}
                            <a href={`https://wa.me/${digits(o.customer.phone)}`} target="_blank" rel="noopener noreferrer" className="btn-tactile h-10 px-4 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold inline-flex items-center gap-1.5"><MessageCircle size={14} className="text-[#FFC400]" />{t.wa}</a>
                            <a href={`tel:+${digits(o.customer.phone)}`} className="btn-tactile h-10 px-4 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold inline-flex items-center gap-1.5"><Phone size={14} className="text-[#FFC400]" />{t.call}</a>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {list.length > limit && (
          <button type="button" onClick={() => setLimit((l) => l + 6)} className="btn-tactile mt-3 w-full h-11 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold hover:bg-white/5">
            {t.showMore} ({list.length - limit})
          </button>
        )}
      </motion.div>
    </div>
  );
};

export default OrdersDashboard;
