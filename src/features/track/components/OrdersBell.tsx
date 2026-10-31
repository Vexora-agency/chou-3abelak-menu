import React, { useEffect, useState } from 'react';
import { BellRing, X, Loader2, PackageSearch, ExternalLink } from 'lucide-react';
import { loadCustomerOrders, type StoredCustomerOrder } from '@/src/utils/customerOrders';
import { formatPrice } from '@/src/utils/pricing';
import { ReceivedButton } from './ReceivedButton';

interface OrdersBellProps {
  lang: 'en' | 'ar';
  darkMode?: boolean;
}

interface BellOrder extends StoredCustomerOrder {
  status: 'new' | 'confirmed' | 'completed' | 'cancelled' | 'unknown';
  total: number | null;
  itemsCount: number | null;
}

function timeAgo(at: string, isAr: boolean, nowMs: number): string {
  const dt = Date.parse(at);
  if (Number.isNaN(dt)) return '';
  const mins = Math.max(0, Math.floor((nowMs - dt) / 60000));
  if (mins < 1) return isAr ? 'الآن' : 'now';
  if (mins < 60) return isAr ? `منذ ${mins} د` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return isAr ? `منذ ${hours} س` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return isAr ? `منذ ${days} يوم` : `${days}d ago`;
}

/** Pure fetch: statuses for a shelf (no setState — the caller applies). */
async function fetchOrderStates(list: StoredCustomerOrder[]): Promise<Record<number, BellOrder>> {
  const next: Record<number, BellOrder> = {};
  await Promise.all(
    list.map(async (o) => {
      try {
        const res = await fetch(`/api/track?number=${o.n}&t=${encodeURIComponent(o.t)}`);
        if (!res.ok) {
          next[o.n] = { ...o, status: 'unknown', total: null, itemsCount: null };
          return;
        }
        const d = (await res.json()) as {
          status?: string; total?: number; items?: unknown[];
        };
        const st = d?.status;
        next[o.n] = {
          ...o,
          status: st === 'new' || st === 'confirmed' || st === 'completed' || st === 'cancelled' ? st : 'unknown',
          total: typeof d?.total === 'number' ? d.total : null,
          itemsCount: Array.isArray(d?.items) ? d.items.length : null,
        };
      } catch {
        next[o.n] = { ...o, status: 'unknown', total: null, itemsCount: null };
      }
    })
  );
  return next;
}

const STATUS_STYLE: Record<string, string> = {
  new: 'text-amber-400 border-amber-800 bg-amber-950/60',
  confirmed: 'text-sky-400 border-sky-800 bg-sky-950/60',
  completed: 'text-green-400 border-green-800 bg-green-950/60',
  cancelled: 'text-red-400 border-red-800 bg-red-950/60',
  unknown: 'text-neutral-400 border-neutral-700 bg-black',
};

/**
 * Floating order bell: every order placed on this device stays reachable
 * for 48h ("Track live", "Did you receive it?") with zero accounts.
 * Signature touch: gold bell with a live count badge, opening a dark
 * bottom card in the brand's voice. Hidden when the shelf is empty.
 */
export const OrdersBell: React.FC<OrdersBellProps> = ({ lang, darkMode = true }) => {
  const isAr = lang === 'ar';
  const [shelf, setShelf] = useState<StoredCustomerOrder[]>(() => loadCustomerOrders());
  const [open, setOpen] = useState(false);
  const [states, setStates] = useState<Record<number, BellOrder>>({});
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Every setState below runs after an await (TrackView shape) so the
  // mount fetch never cascades renders.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const list = loadCustomerOrders();
      const next = list.length ? await fetchOrderStates(list) : {};
      if (stop) return;
      setShelf(list);
      setStates(next);
      setLoading(false);
      setNowMs(Date.now());
    };
    void tick();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, 30000);
    const onStorage = () => void tick();
    window.addEventListener('storage', onStorage);
    return () => {
      stop = true;
      window.clearInterval(id);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open ]);

  if (!shelf.length) return null;

  const orders = shelf.map((o) => states[o.n] ?? { ...o, status: 'unknown' as const, total: null, itemsCount: null });
  const activeCount = orders.filter((o) => o.status === 'new' || o.status === 'confirmed').length;

  const statusLabel = (s: string) =>
    s === 'new' ? (isAr ? 'قيد التحضير' : 'Preparing')
    : s === 'confirmed' ? (isAr ? 'في الطريق إليك' : 'On its way')
    : s === 'completed' ? (isAr ? 'تم الاستلام ✅' : 'Received ✅')
    : s === 'cancelled' ? (isAr ? 'ملغي' : 'Cancelled')
    : (isAr ? '…' : '…');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={isAr ? 'طلباتك' : 'Your orders'}
        aria-expanded={open}
        className="btn-tactile fixed bottom-[5.5rem] end-4 z-40 w-14 h-14 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center shadow-[0_8px_30px_rgba(0,0,0,0.45)] ring-1 ring-white/20"
      >
        <BellRing size={24} strokeWidth={2.5} />
        {activeCount > 0 && (
          <span className="absolute -top-1 -start-1 min-w-6 h-6 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-black flex items-center justify-center tabular-nums ring-2 ring-[#0A0A0A]">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={isAr ? 'طلباتك' : 'Your orders'}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            className={`absolute end-4 bottom-36 w-[calc(100%-2rem)] max-w-sm rounded-3xl border p-4 shadow-2xl anim-pop-in ${
              darkMode ? 'bg-[#141414] border-neutral-700 text-white' : 'bg-white border-neutral-200 text-[#0A0A0A]'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div>
                <h2 className="text-sm font-black">{isAr ? 'طلباتك' : 'Your orders'}</h2>
                <p className={`text-[11px] ${darkMode ? 'text-neutral-500' : 'text-neutral-500'}`}>
                  {isAr ? 'تظهر هنا لمدة 12 ساعة' : 'Kept here for 12 hours'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={isAr ? 'إغلاق' : 'Close'}
                className={`w-8 h-8 rounded-full flex items-center justify-center ${darkMode ? 'text-neutral-400 hover:bg-white/10' : 'text-neutral-500 hover:bg-black/5'}`}
              >
                <X size={16} />
              </button>
            </div>

            {loading && !orders.length ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
              </div>
            ) : (
              <div className="mt-2 space-y-2.5 max-h-[55vh] overflow-y-auto">
                {orders.map((o) => (
                  <div
                    key={o.n}
                    className={`rounded-2xl border p-3 ${darkMode ? 'border-neutral-800 bg-black/40' : 'border-neutral-200 bg-neutral-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-base font-black tabular-nums" dir="ltr">#{o.n}</span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${STATUS_STYLE[o.status]}`}>
                        {statusLabel(o.status)}
                      </span>
                    </div>
                    <p className={`mt-0.5 text-[11px] ${darkMode ? 'text-neutral-500' : 'text-neutral-500'}`}>
                      {timeAgo(o.at, isAr, nowMs)}
                      {typeof o.itemsCount === 'number' && typeof o.total === 'number' && (
                        <span> · <span className="tabular-nums">{o.itemsCount}</span> {isAr ? 'أصناف' : 'items'} · <span className="tabular-nums" dir="ltr">{formatPrice(o.total)}</span></span>
                      )}
                      {o.status === 'unknown' && (
                        <span className="inline-flex items-center gap-1 ms-1"><PackageSearch size={11} />{isAr ? 'تعذر التحديث' : 'unreachable'}</span>
                      )}
                    </p>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <a
                        href={`/?track=${o.n}&t=${encodeURIComponent(o.t)}`}
                        className={`h-9 px-4 rounded-full border text-xs font-extrabold inline-flex items-center gap-1.5 ${
                          darkMode ? 'border-neutral-700 text-neutral-200 hover:border-[var(--primary)] hover:text-[var(--primary)]' : 'border-neutral-300 text-neutral-700 hover:border-[var(--primary)]'
                        }`}
                      >
                        <ExternalLink size={13} />
                        {isAr ? 'تتبع مباشر' : 'Track live'}
                      </a>
                      {(o.status === 'new' || o.status === 'confirmed') && (
                        <ReceivedButton
                          number={o.n}
                          token={o.t}
                          lang={lang}
                          darkMode={darkMode}
                          compact
                          onConfirmed={() =>
                            setStates((prev) => (prev[o.n] ? { ...prev, [o.n]: { ...prev[o.n], status: 'completed' } } : prev))
                          }
                        />
                      )}
                    </div>
                    {(o.status === 'new' || o.status === 'confirmed') && (
                      <p className={`mt-2 text-[11px] font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                        {isAr ? 'هل استلمت طلبك؟' : 'Did you receive your order?'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
