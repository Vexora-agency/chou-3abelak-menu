import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Banknote, BellRing, Receipt, RefreshCw, ShoppingBag } from 'lucide-react';
import { STR } from '@/src/components/orders/ordersDashTypes';
import type { Period } from '@/src/components/orders/ordersDashTypes';
import { fmt, fmtCompact } from '@/src/components/orders/ordersDashUtils';
import { CountUp, Delta, card } from '@/src/components/orders/OrdersDashBits';

/* ---------- Period + refresh ---------- */

interface OrdersDashPeriodBarProps {
  lang: 'en' | 'ar';
  period: Period;
  onPeriodChange: (p: Period) => void;
  onRefresh?: () => void;
}

export const OrdersDashPeriodBar: React.FC<OrdersDashPeriodBarProps> = ({ lang, period, onPeriodChange, onRefresh }) => {
  const t = STR[lang];
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  const [spin, setSpin] = useState(false);
  const rise = (delay: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <motion.div {...rise(0)} className="flex items-center justify-between gap-3">
      <div className="flex gap-1 p-1 bg-neutral-900 rounded-full border border-neutral-800 max-w-full overflow-x-auto" style={{ scrollbarWidth: 'none' }} role="tablist" aria-label="Period">
        {(['today', '7d', 'month', 'lastMonth'] as const).map((p) => {
          const active = period === p;
          return (
            <button key={p} type="button" role="tab" aria-selected={active}
              onClick={() => { onPeriodChange(p); }}
              className={`relative shrink-0 px-3 h-8 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${active ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}>
              {active && <motion.span layoutId="dash-period" className="absolute inset-0 rounded-full bg-[var(--primary)] shadow-md" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span className="relative z-10">{p === 'today' ? t.today : p === '7d' ? t.d7 : p === 'month' ? t.thisMonth : t.lastMonth}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-neutral-400" title={t.liveTip}>
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60 animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" /></span>
          {t.live}
        </span>
        <button type="button" aria-label={t.refresh}
          onClick={() => { setSpin(true); onRefresh?.(); window.setTimeout(() => setSpin(false), 700); }}
          className="btn-tactile w-9 h-9 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-[var(--primary)] flex items-center justify-center">
          <RefreshCw size={15} className={spin ? 'animate-spin' : ''} />
        </button>
      </div>
    </motion.div>
  );
};

/* ---------- KPI cards ---------- */

interface OrdersDashKpisProps {
  lang: 'en' | 'ar';
  currency: string;
  stats: { count: number; prevCount: number; revenue: number; prevRevenue: number; avg: number; prevAvg: number };
  pendingCount: number;
  onShowNew: () => void;
}

export const OrdersDashKpis: React.FC<OrdersDashKpisProps> = ({ lang, currency, stats, pendingCount, onShowNew }) => {
  const t = STR[lang];
  const isAr = lang === 'ar';
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  const lbl = `text-[11px] font-semibold text-neutral-400 ${isAr ? '' : 'uppercase tracking-wide'}`;
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
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {kpis.map((k, i) => (
        <motion.div key={k.key} {...rise(0.06 + i * 0.06)} className={card}>
          <div className="flex items-center justify-between">
            <span className={lbl}>{k.label}</span>
            <span className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center"><k.icon size={16} /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums" dir="ltr"><CountUp value={k.value} format={k.format} /></span>
            {k.unit && <span className="text-[11px] font-bold text-neutral-500">{k.unit}</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">{k.delta}<span className="text-[10px] text-neutral-500 truncate">{t.vsPrev}</span></div>
        </motion.div>
      ))}
      <motion.button type="button" {...rise(0.24)}
        onClick={() => { onShowNew(); }}
        className={`${card} text-start btn-tactile ${pendingCount ? 'border-[var(--primary)]/60! bg-[var(--primary)]/[0.06]' : ''}`}>
        <div className="flex items-center justify-between">
          <span className={lbl}>{t.pending}</span>
          <span className="w-8 h-8 rounded-xl bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center">
            <BellRing size={16} className={pendingCount && !reduce ? 'animate-[wiggle_1.6s_ease-in-out_infinite]' : ''} />
          </span>
        </div>
        <div className="mt-2 text-2xl font-black tabular-nums" dir="ltr"><CountUp value={pendingCount} format={fmt} /></div>
        <div className="mt-1.5 text-[10px] text-neutral-500">{t.new}</div>
      </motion.button>
    </div>
  );
};

/* ---------- Chart ---------- */

interface OrdersDashChartProps {
  lang: 'en' | 'ar';
  currency: string;
  period: Period;
  stats: { count: number; buckets: Array<{ count: number; revenue: number; label: string; full: string }>; max: number; peak: number };
  sel: number | null;
  onSelChange: (i: number | null) => void;
}

export const OrdersDashChart: React.FC<OrdersDashChartProps> = ({ lang, currency, period, stats, sel, onSelChange }) => {
  const t = STR[lang];
  const isAr = lang === 'ar';
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  const h2 = `text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`;
  const rise = (delay: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  });
  const shownIdx = sel ?? stats.peak;
  const sb = stats.buckets[shownIdx];

  return (
    <motion.div {...rise(0.3)} className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={h2}>{t.over}</h2>
        <span className="text-[11px] text-neutral-400 text-end">
          {stats.count ? <><b className="text-white">{sb.full}</b> · {sb.count} {t.ordersWord} · <span dir="ltr">{fmtCompact(sb.revenue)} {currency}</span></> : t.noData}
        </span>
      </div>
      <div className="mt-4 flex items-end gap-[3px] h-36" dir="ltr" role="img"
        aria-label={`${t.over}: ${stats.count} ${t.ordersWord}`} onMouseLeave={() => onSelChange(null)}>
        {stats.buckets.map((b, i) => {
          const pct = b.count ? Math.max(6, (b.count / stats.max) * 100) : 2;
          const active = i === shownIdx && stats.count > 0;
          return (
            <button key={`${period}-${i}`} type="button" onMouseEnter={() => onSelChange(i)} onClick={() => onSelChange(i)}
              aria-label={`${b.full}: ${b.count} ${t.ordersWord}`} className="group relative flex-1 h-full flex items-end focus-visible:outline-none">
              <motion.span
                className={`block w-full max-w-[48px] mx-auto rounded-t-[4px] transition-colors ${active ? 'bg-[var(--primary)]' : b.count ? 'bg-[var(--primary)]/45 group-hover:bg-[var(--primary)]/75' : 'bg-neutral-800'}`}
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
  );
};

/* ---------- Top items ---------- */

interface OrdersDashTopItemsProps {
  lang: 'en' | 'ar';
  period: Period;
  stats: { top: Array<{ name: { en: string; ar: string }; qty: number; revenue: number }> };
}

export const OrdersDashTopItems: React.FC<OrdersDashTopItemsProps> = ({ lang, period, stats }) => {
  const t = STR[lang];
  const isAr = lang === 'ar';
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  const h2 = `text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`;
  const rise = (delay: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
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
              <motion.div className="h-full rounded-full bg-[var(--primary)]" initial={reduce ? false : { width: 0 }}
                animate={{ width: `${(it.qty / stats.top[0].qty) * 100}%` }} transition={{ duration: 0.7, delay: reduce ? 0 : 0.1 + i * 0.07, ease: [0.22, 1, 0.36, 1] }} />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};
