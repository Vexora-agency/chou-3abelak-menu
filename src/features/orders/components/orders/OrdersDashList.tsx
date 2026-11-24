import { useMemo, useState, type FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BellRing, BadgeCheck, Check, ChevronDown, Inbox, Link2, Loader2, MapPin, MessageCircle, Phone, StickyNote, Store, X } from 'lucide-react';
import { STR } from './ordersDashTypes';
import type { Order, OrderStatus } from './ordersDashTypes';
import type { MenuData } from '@/src/types/menu';
import { OrderReviewBadge } from './OrderReviewBadge';
import { STATUS_STYLE, TYPE_ICON, digits, fmt, itemTitle, itemBaseTitle, lineIsSpicy, lineSpicyId, loc, relTime } from './ordersDashUtils';
import { OrderAddonPills } from './OrderAddonPills';
import { unitLabel } from '@/src/utils/pricing';
import { HeatPill } from '@/src/components/HeatPill';
import { card } from './OrdersDashBits';

interface OrdersDashListProps {
  lang: 'en' | 'ar';
  menu: MenuData;
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
  /** Optional confirm gate: when provided, cancelling an order asks
   *  "هل تود إلغاء الطلب؟" first (protects against accidental taps —
   *  cancelling notifies no one and is hard to undo mid-rush). */
  onConfirm?: (box: { title: string; body: string; confirmText: string; mode?: 'confirm' | 'info'; action?: () => void }) => void;
  /** Kitchen board: the section reads "Orders" (no "Recent"); the owner
   *  keeps "Recent orders". Display-only — one prop, no logic fork. */
  kitchen?: boolean;
}

interface OrderRowProps {
  o: Order;
  menu: MenuData;
  open: boolean;
  onToggleOpen: (id: string | null) => void;
  t: (typeof STR)[keyof typeof STR];
  isAr: boolean;
  currency: string;
  now: Date;
  flashId: string | null;
  onStatusChange: (id: string, status: OrderStatus) => void;
  onConfirm?: (box: { title: string; body: string; confirmText: string; mode?: 'confirm' | 'info'; action?: () => void }) => void;
  /** True when this row renders inside a joint-delivery GroupCard: the group
   *  owns the single advance button, so per-row ack/complete stay hidden
   *  (cancel + reopen stay per-order). */
  inGroup?: boolean;
}

/** Customer name: full width on its own row on phones (long names stay
 *  readable instead of being squeezed between the number and the total),
 *  inline on sm+ where there is room. */
const CustomerName: FC<{ name: string }> = ({ name }) => (
  <span className="min-w-0 flex-1 basis-full sm:basis-auto order-last sm:order-none text-sm font-semibold" title={name || undefined}>
    <span className="block truncate">{name || '—'}</span>
  </span>
);

/** Single order card (row + expandable detail). Pure presentational. */
const OrderRow: FC<OrderRowProps> = ({ o, menu, open, onToggleOpen, t, isAr, currency, now, flashId, onStatusChange, onConfirm, inGroup = false }) => {
  const TypeIcon = TYPE_ICON[o.type] ?? Store;
  // Smart ETA: absolute 12h time while on-time, mins-late once passed.
  const etaMs = typeof o.etaAt === 'string' && o.etaAt ? Date.parse(o.etaAt) : NaN;
  const showEta = (o.status === 'confirmed' || o.status === 'ready') && Number.isFinite(etaMs);
  const etaTime = showEta
    ? new Date(etaMs).toLocaleTimeString(loc(isAr ? 'ar' : 'en'), { hour: 'numeric', minute: '2-digit', hour12: true })
    : '';
  const etaLateMins = showEta ? Math.floor((now.getTime() - etaMs) / 60000) : 0;
  const etaLate = showEta ? now.getTime() > etaMs : false;
  return (
    <motion.div key={o.id} layout="position"
      initial={{ opacity: 1, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl bg-neutral-900 border transition-colors ${flashId === o.id ? 'border-[var(--primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_18%,transparent)]' : 'border-neutral-800'}`}>
      <button type="button" onClick={() => onToggleOpen(open ? null : o.id)} aria-expanded={open}
        className="w-full text-start p-3.5 flex items-center gap-3">
        <span className="shrink-0 w-10 h-10 rounded-xl bg-black border border-neutral-800 text-[var(--primary)] flex items-center justify-center"><TypeIcon size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <b className="text-sm tabular-nums" dir="ltr">#{o.number}</b>
            {typeof o.parentNumber === 'number' && (
              <span dir="auto" className="shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-amber-400/40 bg-amber-400/10 text-amber-300">
                {t.linkedShort(o.parentNumber)}
              </span>
            )}
            <CustomerName name={o.customer.name} />
            {o.customerUserId && (
              <span
                title={t.registeredTip}
                aria-label={t.registered}
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
              >
                <BadgeCheck size={11} aria-hidden="true" />
                <span className="hidden sm:inline">{t.registered}</span>
              </span>
            )}
            <OrderReviewBadge lang={isAr ? 'ar' : 'en'} needsReview={o.needsReview} riskReasons={o.riskReasons} />
          </span>
          <span className="block text-[11px] text-neutral-500 truncate mt-0.5" dir="auto">
            <bdi>{relTime(o.createdAt, isAr ? 'ar' : 'en', now)}</bdi> · {o.items.map((it) => `${it.qty}× ${typeof it.unit === 'string' && it.unit ? `${unitLabel(it.unit, it.qty, isAr ? 'ar' : 'en')} ` : ''}${itemTitle(it, isAr ? 'ar' : 'en')}`).join(isAr ? '، ' : ', ')}
          </span>
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-sm font-extrabold tabular-nums" dir="ltr">{fmt(o.total)}</span>
          <span className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${STATUS_STYLE[o.status]}`}>
            {o.status === 'new' && <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A] animate-pulse" />}
            {t[o.status]}
          </span>
          {typeof o.updatedBy === 'string' && o.updatedBy.trim() !== '' && (
            <span className="mt-0.5 block text-[10px] font-bold text-neutral-500 truncate max-w-[110px]" dir="auto">
              {t.by(o.updatedBy.trim())}
            </span>
          )}
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
                  <div key={`${it.id}-${idx}`} className="py-1.5">
                    <span className="block min-w-0 break-words">
                      <bdi dir="ltr" className="tabular-nums">{it.qty}</bdi>
                      <span dir="ltr">×</span>{' '}
                      {typeof it.unit === 'string' && it.unit ? `${unitLabel(it.unit, it.qty, isAr ? 'ar' : 'en')} ` : ''}
                      <span dir="auto">{itemBaseTitle(it, isAr ? 'ar' : 'en')}</span>
                    </span>
                    {(lineIsSpicy(it) || (Array.isArray(it.addonNames) && it.addonNames.length > 0)) && (
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {lineIsSpicy(it) && (
                          <HeatPill featureId={lineSpicyId(it) ?? undefined} lang={isAr ? 'ar' : 'en'} size="sm" />
                        )}
                        <OrderAddonPills it={it} menu={menu} lang={isAr ? 'ar' : 'en'} />
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-neutral-500 tabular-nums" dir="ltr">
                      {fmt(it.qty)} × {fmt(it.unitPrice)} = {fmt(it.qty * it.unitPrice)}
                    </span>
                  </div>
                ))}
                {o.notes && (
                  <div
                    role="note"
                    className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100"
                  >
                    <StickyNote size={14} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                    <p className="min-w-0 break-words">
                      <b className="text-amber-300">{t.notes}: </b>
                      <span dir="auto">{o.notes}</span>
                    </p>
                  </div>
                )}
                <div className="pt-1.5 border-t border-neutral-800 space-y-1 text-xs text-neutral-400">
                  <div className="flex justify-between"><span>{t.subtotal}</span><span className="tabular-nums" dir="ltr">{fmt(o.subtotal)}</span></div>
                  {o.deliveryFee > 0 && <div className="flex justify-between"><span>{t.fee}</span><span className="tabular-nums" dir="ltr">{fmt(o.deliveryFee)}</span></div>}
                  <div className="flex justify-between text-sm font-extrabold text-white"><span>{t.total}</span><span className="tabular-nums"><bdi dir="ltr">{fmt(o.total)}</bdi> <span dir="auto">{currency}</span></span></div>
                  <div className="flex justify-between items-center pt-0.5">
                    <span>{t.payment}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold border border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]" dir="auto">
                      {t.cod}
                    </span>
                  </div>
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

              <div className="flex flex-wrap gap-2 pt-1">
                {/* Kitchen flow (simplified: new = acknowledge (start preparing),
                    confirmed = complete on delivery/pickup. Legacy `ready`
                    orders keep their complete button — no new order ever
                    enters `ready`. Group members hide their own advance
                    buttons: the GroupCard owns the single advance button for
                    the whole pair. Cancel + reopen stay per-order. */}
                {!inGroup && o.status === 'new' && <button type="button" onClick={() => onStatusChange(o.id, 'confirmed')} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><BellRing size={14} strokeWidth={2.5} />{t.ack}</button>}
                {!inGroup && o.status === 'confirmed' && <button type="button" onClick={() => onStatusChange(o.id, 'completed')} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><Check size={14} strokeWidth={3} />{t.complete}</button>}
                {!inGroup && o.status === 'ready' && <button type="button" onClick={() => onStatusChange(o.id, 'completed')} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><Check size={14} strokeWidth={3} />{t.complete}</button>}
                {(o.status === 'completed' || o.status === 'cancelled') && <button type="button" onClick={() => onStatusChange(o.id, 'new')} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">{t.reopen}</button>}
                {(o.status === 'new' || o.status === 'confirmed' || o.status === 'ready') && <button type="button" onClick={() => {
                  if (onConfirm) {
                    onConfirm({
                      title: isAr ? `هل تود إلغاء الطلب #${o.number}؟` : `Cancel order #${o.number}?`,
                      body: isAr ? 'سيتم إلغاء الطلب نهائيًا. لن يتم إشعار الزبون تلقائيًا — تواصل معه إذا لزم.' : 'The order will be cancelled for good. The customer is not notified automatically — contact them if needed.',
                      confirmText: isAr ? 'تأكيد الإلغاء' : 'Confirm cancel',
                      action: () => onStatusChange(o.id, 'cancelled'),
                    });
                  } else {
                    onStatusChange(o.id, 'cancelled');
                  }
                }} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full border border-red-500/40 text-red-400 text-xs font-bold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><X size={14} />{t.cancel}</button>}
                <a href={`https://wa.me/${digits(o.customer.phone)}`} target="_blank" rel="noopener noreferrer" className="btn-tactile h-11 min-h-[44px] px-5 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><MessageCircle size={14} className="text-[var(--primary)]" />{t.wa}</a>
                <a href={`tel:+${digits(o.customer.phone)}`} className="btn-tactile h-11 min-h-[44px] px-5 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><Phone size={14} className="text-[var(--primary)]" />{t.call}</a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

interface GroupCardProps extends Omit<OrderRowProps, 'o' | 'open'> {
  members: Order[];
  openId: string | null;
}

/**
 * Joint-delivery container: a linked parent + follow-up(s) in ONE card with
 * ONE advance button ("both go together"). The button aligns the laggards
 * first (mixed new + preparing -> ack the new ones), then moves the whole
 * pair forward together (ack all -> complete all). Cancel stays per-order
 * (cancelling one must never silently kill the other).
 */
const GroupCard: FC<GroupCardProps> = ({ members, openId, onToggleOpen, menu, t, isAr, currency, now, flashId, onStatusChange, onConfirm }) => {
  const [busy, setBusy] = useState(false);
  const active = members.filter((m) => m.status === 'new' || m.status === 'confirmed' || m.status === 'ready');
  const allNew = active.length > 0 && active.every((m) => m.status === 'new');
  const allPrep = active.length > 0 && active.every((m) => m.status === 'confirmed' || m.status === 'ready');
  let action: { label: string; targets: { id: string; status: OrderStatus }[] } | null = null;
  if (active.length > 0) {
    if (allNew) {
      action = { label: t.ackBoth(active.length), targets: active.map((m) => ({ id: m.id, status: 'confirmed' as OrderStatus })) };
    } else if (allPrep) {
      action = { label: t.completeBoth(active.length), targets: active.map((m) => ({ id: m.id, status: 'completed' as OrderStatus })) };
    } else {
      action = { label: t.alignBoth(active.length), targets: active.filter((m) => m.status === 'new').map((m) => ({ id: m.id, status: 'confirmed' as OrderStatus })) };
    }
  }
  const combined = members.reduce((s, m) => s + (typeof m.total === 'number' && Number.isFinite(m.total) ? m.total : 0), 0);
  const run = async () => {
    if (!action || busy) return;
    setBusy(true);
    try {
      for (const tg of action.targets) {
        await onStatusChange(tg.id, tg.status);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.div layout="position"
      initial={{ opacity: 1, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border-2 border-[var(--primary)]/40 bg-neutral-900/80 overflow-hidden">
      <div className="px-3.5 pt-3 pb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--primary)]/20">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[var(--primary)]" dir="auto">
          <Link2 size={13} />{t.jointTitle(members.length)}
        </span>
        <span className="text-[11px] font-extrabold tabular-nums text-neutral-200" dir="ltr">
          #{members.map((m) => m.number).join(' + #')}
        </span>
        <span className="ms-auto text-[11px] font-extrabold tabular-nums text-neutral-300" dir="ltr">
          {fmt(combined)} <span dir="auto">{currency}</span>
        </span>
      </div>
      <div className="p-1.5 space-y-2">
        {members.map((m) => (
          <OrderRow
            key={m.id}
            o={m}
            menu={menu}
            open={openId === m.id}
            onToggleOpen={onToggleOpen}
            t={t}
            isAr={isAr}
            currency={currency}
            now={now}
            flashId={flashId}
            onStatusChange={onStatusChange}
            onConfirm={onConfirm}
            inGroup
          />
        ))}
      </div>
      {action && (
        <div className="px-3.5 pb-3.5">
          <button type="button" onClick={() => void run()} disabled={busy}
            className="btn-tactile w-full h-11 min-h-[44px] rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}{action.label}
          </button>
        </div>
      )}
    </motion.div>
  );
};

export const OrdersDashList: FC<OrdersDashListProps> = ({
  lang, menu, currency, loading, totalCount, list, counts, filter, onFilterChange,
  limit, onShowMore, openId, onToggleOpen, flashId, now, onStatusChange, onConfirm, kitchen,
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

  // Joint-delivery groups over the VISIBLE slice: a follow-up attaches to
  // its parent when the parent is on screen, otherwise it renders
  // standalone (its linked badge still explains the relation). Parents
  // render with their whole subtree as ONE container + ONE advance button.
  type PlanEntry = { kind: 'single'; order: Order } | { kind: 'group'; key: string; members: Order[] };
  const visible = list.slice(0, limit);
  const plan = useMemo<PlanEntry[]>(() => {
    const byNumber = new Map<number, Order>();
    for (const o of visible) if (!byNumber.has(o.number)) byNumber.set(o.number, o);
    const childrenOf = new Map<string, Order[]>();
    for (const o of visible) {
      if (typeof o.parentNumber !== 'number') continue;
      const p = byNumber.get(o.parentNumber);
      if (!p || p.id === o.id) continue;
      const arr = childrenOf.get(p.id) ?? [];
      arr.push(o);
      childrenOf.set(p.id, arr);
    }
    const claimed = new Set<string>();
    const out: PlanEntry[] = [];
    const collect = (root: Order): Order[] => {
      const members = [root];
      const seen = new Set([root.id]);
      const queue = [root];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const ch of childrenOf.get(cur.id) ?? []) {
          if (seen.has(ch.id)) continue;
          seen.add(ch.id);
          members.push(ch);
          queue.push(ch);
        }
      }
      members.sort((a, b) => a.number - b.number);
      return members;
    };
    for (const o of visible) {
      if (claimed.has(o.id)) continue;
      // Walk up to the visible root (cycle-guarded), then emit its group
      // at the first encountered member so pairs stay adjacent.
      let root = o;
      const chain = new Set<string>();
      while (typeof root.parentNumber === 'number' && !chain.has(root.id)) {
        chain.add(root.id);
        const p = byNumber.get(root.parentNumber);
        if (!p || p.id === root.id) break;
        root = p;
      }
      const members = collect(root);
      if (members.length > 1) {
        for (const m of members) claimed.add(m.id);
        out.push({ kind: 'group', key: `g-${root.id}`, members });
      } else {
        claimed.add(o.id);
        out.push({ kind: 'single', order: o });
      }
    }
    return out;
  }, [list, limit]);

  return (
    <motion.div {...rise(0.48)} id="orders-list" className="scroll-mt-4 pt-2">
      <h2 className={h2}>{kitchen ? t.orders : t.recent}</h2>
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {(['all', 'new', 'confirmed', 'completed', 'cancelled'] as const).map((s) => {
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
          {plan.map((entry) =>
            entry.kind === 'single' ? (
              <OrderRow
                key={entry.order.id}
                o={entry.order}
                menu={menu}
                open={openId === entry.order.id}
                onToggleOpen={onToggleOpen}
                t={t}
                isAr={isAr}
                currency={currency}
                now={now}
                flashId={flashId}
                onStatusChange={onStatusChange}
                onConfirm={onConfirm}
              />
            ) : (
              <GroupCard
                key={entry.key}
                members={entry.members}
                openId={openId}
                menu={menu}
                onToggleOpen={onToggleOpen}
                t={t}
                isAr={isAr}
                currency={currency}
                now={now}
                flashId={flashId}
                onStatusChange={onStatusChange}
                onConfirm={onConfirm}
              />
            )
          )}
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
