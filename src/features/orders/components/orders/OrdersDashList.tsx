import type { FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BellRing, Check, ChevronDown, Inbox, MapPin, MessageCircle, Phone, Store, X } from 'lucide-react';
import { STR } from './ordersDashTypes';
import type { Order, OrderStatus } from './ordersDashTypes';
import { STATUS_STYLE, TYPE_ICON, digits, fmt, itemTitle, loc, relTime } from './ordersDashUtils';
import { unitLabel } from '@/src/utils/pricing';
import { card } from './OrdersDashBits';

interface OrdersDashListProps {
  lang: 'en' | 'ar';
  currency: string;
  loading?: boolean;
  totalCount: number;
  list: Order[];
  counts: Record<string, number>;
  filter: 'all' | OrderStatus;
  onFilterChange: (s: 'all' | OrderStatus) => void;
  limit: number;
  onShowMore: () => void;
  openId: string | null;
  onToggleOpen: (id: string | null) => void;
  flashId: string | null;
  now: Date;
  onStatusChange: (id: string, status: OrderStatus) => void;
}

export const OrdersDashList: FC<OrdersDashListProps> = ({
  lang, currency, loading, totalCount, list, counts, filter, onFilterChange,
  limit, onShowMore, openId, onToggleOpen, flashId, now, onStatusChange,
}) => {
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
    <motion.div {...rise(0.48)} id="orders-list" className="scroll-mt-4 pt-2">
      <h2 className={h2}>{t.recent}</h2>
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {(['all', 'new', 'confirmed', 'ready', 'completed', 'cancelled'] as const).map((s) => {
          const active = filter === s;
          return (
            <button key={s} type="button" onClick={() => { onFilterChange(s); }} aria-pressed={active}
              className={`shrink-0 h-11 min-h-[44px] px-4 rounded-full text-xs font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${active ? 'bg-[var(--primary)] text-[#0A0A0A] border-[var(--primary)]' : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-neutral-600'}`}>
              {t[s]} <span className={`ms-1 tabular-nums ${active ? 'text-[#0A0A0A]/70' : 'text-neutral-500'}`}>{counts[s]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 space-y-2.5">
        {loading && [0, 1, 2].map((i) => <div key={i} className="h-[72px] rounded-2xl bg-neutral-900 border border-neutral-800 animate-pulse" />)}
        {!loading && totalCount === 0 && (
          <div className={`${card} py-10 text-center`}>
            <Inbox size={34} className="mx-auto text-[var(--primary)]/70" />
            <p className="mt-3 text-sm font-extrabold">{t.emptyTitle}</p>
            <p className="mt-1 text-xs text-neutral-500">{t.emptyDesc}</p>
          </div>
        )}
        {!loading && totalCount > 0 && list.length === 0 && <p className="text-center text-xs text-neutral-500 py-8">{t.emptyView}</p>}

        <AnimatePresence initial={false}>
          {list.slice(0, limit).map((o) => {
            const open = openId === o.id;
            const TypeIcon = TYPE_ICON[o.type] ?? Store;
            // Smart ETA: absolute 12h time while on-time, mins-late once passed.
            const etaMs = typeof o.etaAt === 'string' && o.etaAt ? Date.parse(o.etaAt) : NaN;
            const showEta = (o.status === 'confirmed' || o.status === 'ready') && Number.isFinite(etaMs);
            const etaTime = showEta
              ? new Date(etaMs).toLocaleTimeString(loc(lang), { hour: 'numeric', minute: '2-digit', hour12: true })
              : '';
            const etaLateMins = showEta ? Math.floor((now.getTime() - etaMs) / 60000) : 0;
            const etaLate = showEta ? now.getTime() > etaMs : false;
            return (
              <motion.div key={o.id} layout={reduce ? false : 'position'}
                initial={reduce ? false : { opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className={`rounded-2xl bg-neutral-900 border transition-colors ${flashId === o.id ? 'border-[var(--primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_18%,transparent)]' : 'border-neutral-800'}`}>
                <button type="button" onClick={() => onToggleOpen(open ? null : o.id)} aria-expanded={open}
                  className="w-full text-start p-3.5 flex items-center gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-xl bg-black border border-neutral-800 text-[var(--primary)] flex items-center justify-center"><TypeIcon size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <b className="text-sm tabular-nums" dir="ltr">#{o.number}</b>
                      {typeof o.parentNumber === 'number' && (
                        <span dir="auto" className="shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-amber-400/40 bg-amber-400/10 text-amber-300">
                          {t.linkedShort(o.parentNumber)}
                        </span>
                      )}
                      <span className="text-sm font-semibold truncate">{o.customer.name}</span>
                    </span>
                    <span className="block text-[11px] text-neutral-500 truncate mt-0.5" dir="auto">
                      <bdi>{relTime(o.createdAt, lang, now)}</bdi> · {o.items.map((it) => `${it.qty}× ${typeof it.unit === 'string' && it.unit ? `${unitLabel(it.unit, it.qty, lang)} ` : ''}${itemTitle(it, lang)}`).join(isAr ? '، ' : ', ')}
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
                        {typeof o.parentNumber === 'number' && (
                          <p dir="auto" className="text-[11px] font-bold text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-xl px-3 py-1.5">
                            {`🔗 ${t.linkedLong(o.parentNumber)}`}
                          </p>
                        )}
                        <div className="space-y-1.5">
                          <p className={`text-[11px] font-bold text-neutral-500 ${isAr ? '' : 'uppercase tracking-wide'}`}>{t.itemsLabel}</p>
                          {o.items.map((it, idx) => (
                            <div key={`${it.id}-${idx}`} className="flex justify-between gap-3">
                              <span className="min-w-0 flex-1 break-words"><bdi dir="ltr" className="tabular-nums">{it.qty}</bdi><span dir="ltr">×</span> {typeof it.unit === 'string' && it.unit ? `${unitLabel(it.unit, it.qty, lang)} ` : ''}<span dir="auto">{itemTitle(it, lang)}</span></span>
                              <span className="text-neutral-400 tabular-nums whitespace-nowrap shrink-0"><bdi dir="ltr" className="tabular-nums">{fmt(it.qty)}</bdi><span dir="ltr"> × </span><bdi dir="ltr" className="tabular-nums">{fmt(it.unitPrice)}</bdi><span dir="ltr"> = </span><bdi dir="ltr" className="tabular-nums">{fmt(it.qty * it.unitPrice)}</bdi></span>
                            </div>
                          ))}
                          <div className="pt-1.5 border-t border-neutral-800 space-y-1 text-xs text-neutral-400">
                            <div className="flex justify-between"><span>{t.subtotal}</span><span className="tabular-nums" dir="ltr">{fmt(o.subtotal)}</span></div>
                            {o.deliveryFee > 0 && <div className="flex justify-between"><span>{t.fee}</span><span className="tabular-nums" dir="ltr">{fmt(o.deliveryFee)}</span></div>}
                            <div className="flex justify-between text-sm font-extrabold text-white"><span>{t.total}</span><span className="tabular-nums"><bdi dir="ltr" className="tabular-nums">{fmt(o.total)}</bdi> <span dir="auto">{currency}</span></span></div>
                          </div>
                          {showEta && (
                            <p dir="auto" className={`text-[11px] tabular-nums truncate ${etaLate ? 'text-amber-400 font-bold' : 'text-neutral-500'}`}>
                              {etaLate ? t.late(etaLateMins) : t.arrives(etaTime)}
                            </p>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-2 text-neutral-300 min-w-0"><Phone size={14} className="text-[var(--primary)] shrink-0" /><span dir="ltr" className="tabular-nums truncate">{o.customer.phone}</span></div>
                          {(o.customer.address || o.customer.table) && (
                            <div className="flex items-center gap-2 text-neutral-300 min-w-0"><MapPin size={14} className="text-[var(--primary)] shrink-0" /><span dir="auto" className="truncate">{o.customer.address ?? `${t.table} ${o.customer.table}`}</span></div>
                          )}
                          {o.location && Number.isFinite(o.location.lat) && Number.isFinite(o.location.lng) && (
                            <a
                              href={`https://www.google.com/maps?q=${o.location.lat},${o.location.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-tactile h-10 px-4 rounded-full border border-[var(--primary)]/50 text-[var(--primary)] text-xs font-bold inline-flex items-center gap-1.5"
                            >
                              <MapPin size={14} />{t.openMaps}
                            </a>
                          )}
                        </div>
                        {o.notes && <p className="text-xs text-neutral-300 bg-black/50 rounded-xl border border-neutral-800 px-3 py-2"><b className="text-neutral-500">{t.notes}: </b>{o.notes}</p>}

                      <div className="flex flex-wrap gap-2 pt-1">
                        {/* Kitchen flow (simplified): new = acknowledge (start preparing),
                            confirmed = complete on delivery/pickup. Legacy `ready`
                            orders keep their complete button — no new order ever
                            enters `ready`. Cancel stays available until
                            completion; terminal orders can only reopen. */}
                        {o.status === 'new' && <button type="button" onClick={() => onStatusChange(o.id, 'confirmed')} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><BellRing size={14} strokeWidth={2.5} />{t.ack}</button>}
                        {o.status === 'confirmed' && <button type="button" onClick={() => onStatusChange(o.id, 'completed')} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><Check size={14} strokeWidth={3} />{t.complete}</button>}
                        {o.status === 'ready' && <button type="button" onClick={() => onStatusChange(o.id, 'completed')} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><Check size={14} strokeWidth={3} />{t.complete}</button>}
                        {(o.status === 'completed' || o.status === 'cancelled') && <button type="button" onClick={() => onStatusChange(o.id, 'new')} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">{t.reopen}</button>}
                        {(o.status === 'new' || o.status === 'confirmed' || o.status === 'ready') && <button type="button" onClick={() => onStatusChange(o.id, 'cancelled')} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full border border-red-500/40 text-red-400 text-xs font-bold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><X size={14} />{t.cancel}</button>}
                          <a href={`https://wa.me/${digits(o.customer.phone)}`} target="_blank" rel="noopener noreferrer" className="btn-tactile h-11 min-h-[44px] px-5 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><MessageCircle size={14} className="text-[var(--primary)]" />{t.wa}</a>
                          <a href={`tel:+${digits(o.customer.phone)}`} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><Phone size={14} className="text-[var(--primary)]" />{t.call}</a>
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
        <button type="button" onClick={() => onShowMore()} className="btn-tactile mt-3 w-full h-11 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold hover:bg-white/5">
          {t.showMore} ({list.length - limit})
        </button>
      )}
    </motion.div>
  );
};
