import React, { useEffect, useRef, useState } from 'react';
import { BellRing, Volume2, VolumeX, Check, X, Loader2, PackageSearch, ExternalLink } from 'lucide-react';
import {
  isSoundOff,
  loadCustomerOrders,
  loadRung,
  markRung,
  setSoundOff,
  type StoredCustomerOrder,
} from '@/src/utils/customerOrders';
import { formatPrice } from '@/src/utils/pricing';
import { playBellChime, unlockBellAudio, vibrateBell } from '@/src/utils/bellSound';
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
  confirmed: 'text-[var(--primary)] border-[var(--primary)]/40 bg-[var(--primary)]/10',
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
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [soundOff, setSoundOffState] = useState<boolean>(() => isSoundOff());
  const [ringing, setRinging] = useState(false);
  // Order numbers already seen: only a number appearing AFTER mount rings
  // (sound fires at order time only — a fresh order rings normally).
  const knownRef = useRef<Set<number> | null>(null);
  const ringTimerRef = useRef(0);
  const activeRef = useRef(false);
  // Orders whose chime could not play yet (context still locked). Flushed
  // on every later gesture/visibility/tick until one strike lands — the
  // sound is never dropped, only muted orders are skipped.
  const pendingSoundRef = useRef<Set<number>>(new Set());

  /** Visual swing only — never any sound (sound is order-time-only). */
  const dance = (ms: number) => {
    setRinging(true);
    window.clearTimeout(ringTimerRef.current);
    ringTimerRef.current = window.setTimeout(() => setRinging(false), ms);
  };

  // Every setState below runs after an await (TrackView shape) so the
  // mount fetch never cascades renders.
  // Try the pending chimes; clears on the first landed strike (one
  // ding-ding per flush no matter how many orders queued). While the
  // master switch is off the queue is dropped silently.
  const flushPendingSound = async () => {
    if (pendingSoundRef.current.size === 0) return;
    if (isSoundOff()) {
      pendingSoundRef.current.clear();
      return;
    }
    try {
      if (await playBellChime()) pendingSoundRef.current.clear();
    } catch {}
  };

  useEffect(() => {
    unlockBellAudio();
    let stop = false;
    const tick = async () => {
      const list = loadCustomerOrders();
      const next = list.length ? await fetchOrderStates(list) : {};
      if (stop) return;
      // New arrivals (never seen since mount) → premium ring: chime +
      // vibration + swing. Mount-time orders never ring. Sound fires at
      // order time ONLY — status polls stay silent. The master switch
      // gates everything: off = visual only, no chime, no queue.
      const known = knownRef.current;
      if (known) {
        const fresh = list.filter((o) => !known.has(o.n));
        for (const o of fresh) known.add(o.n);
        if (fresh.length > 0 && !isSoundOff()) {
          // Vibration never waits on audio: even a blocked chime still
          // buzzes, so the new order is never missed silently.
          vibrateBell();
          for (const o of fresh) pendingSoundRef.current.add(o.n);
          dance(2000);
          void flushPendingSound();
        }
      } else {
        knownRef.current = new Set(list.map((o) => o.n));
        // Catch-up on (re)mount: orders never rung on THIS device ring once
        // — this covers leaving the browser and coming back, even if the OS
        // killed the tab (a fresh mount would otherwise stay silent).
        // Skipped entirely while the master switch is off.
        if (!isSoundOff()) {
          const rung = loadRung();
          const missed = list.filter((o) => !rung.includes(o.n));
          if (missed.length > 0) {
            markRung(list.map((o) => o.n));
            for (const o of missed) pendingSoundRef.current.add(o.n);
            vibrateBell();
            dance(2000);
            void flushPendingSound();
          }
        } else {
          markRung(list.map((o) => o.n));
        }
      }
      activeRef.current = Object.values(next).some((s) => s.status === 'new' || s.status === 'confirmed');
      setShelf(list);
      setStates(next);
      setLoading(false);
      setNowMs(Date.now());
      // Retry anything still queued (audio may have unlocked since).
      void flushPendingSound();
    };
    void tick();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, 30000);
    // Same-tab saves don't emit storage events — the store pings us.
    const onLocal = () => void tick();
    const onStorage = () => void tick();
    // Any real interaction may have just unlocked audio: flush chimes
    // that were queued while the context was suspended.
    const onGesture = () => void flushPendingSound();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void tick();
        void flushPendingSound();
      }
    };
    window.addEventListener('customer-orders-changed', onLocal);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('touchend', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      window.clearInterval(id);
      window.clearTimeout(ringTimerRef.current);
      window.removeEventListener('customer-orders-changed', onLocal);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('touchend', onGesture);
      window.removeEventListener('keydown', onGesture);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Attention loop: while an order still needs the customer, the bell
  // re-dances silently every few seconds. Sound stays order-time-only.
  useEffect(() => {
    if (open) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && activeRef.current) dance(1700);
    }, 9000);
    return () => window.clearInterval(id);
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open ]);

  // The bell lives only while something needs attention: the moment every
  // order on the shelf is completed/cancelled it vanishes at once (the
  // confirm button already flips local state, so this is instant — the
  // next poll just confirms it). Unknown (not yet fetched) counts as
  // active so the bell never flickers on mount.
  const orders = shelf.map((o) => states[o.n] ?? { ...o, status: 'unknown' as const, total: null, itemsCount: null });
  const allTerminal = orders.length > 0 && orders.every((o) => o.status === 'completed' || o.status === 'cancelled');
  if (!shelf.length || allTerminal) return null;

  // Master sound switch: off = visual bell only, never a chime.
  // Unmuting plays a chime at once (a tap always unlocks audio).
  const toggleSound = () => {
    const off = !isSoundOff();
    setSoundOff(off);
    setSoundOffState(off);
    if (off) {
      pendingSoundRef.current.clear();
    } else {
      vibrateBell();
      void playBellChime();
    }
  };

  const activeCount = orders.filter((o) => o.status === 'new' || o.status === 'confirmed').length;

  // new = placed, owner hasn't confirmed yet; confirmed = the kitchen
  // confirmed receipt and is preparing; completed = delivered to you.
  const statusLabel = (s: string) =>
    s === 'new' ? (isAr ? 'بانتظار التأكيد' : 'Awaiting confirm')
    : s === 'confirmed' ? (isAr ? 'قيد التحضير' : 'Being prepared')
    : s === 'completed' ? (isAr ? 'تم التوصيل' : 'Delivered')
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
        {ringing && (
          <span aria-hidden="true" className="anim-bell-glow absolute inset-0 rounded-full bg-[var(--primary)]" />
        )}
        <span className={ringing ? 'anim-bell-ring inline-flex' : 'inline-flex'}>
          <BellRing size={24} strokeWidth={2.5} />
        </span>
        {activeCount > 0 && (
          <span className="absolute -top-1 -start-1 min-w-6 h-6 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-black flex items-center justify-center tabular-nums ring-2 ring-[#0A0A0A]">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={isAr ? 'طلباتك' : 'Your orders'}>
          <div className="absolute inset-0 bg-black/60 anim-fade-in" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            className={`relative z-10 w-full max-w-md max-h-[78dvh] overflow-y-auto overscroll-contain rounded-t-[28px] border border-b-0 border-t-[3px] border-t-[var(--primary)] px-5 sm:px-6 pt-3 pb-[max(1.75rem,env(safe-area-inset-bottom))] shadow-2xl anim-drawer-in [touch-action:pan-y] ${
              darkMode ? 'bg-[#141414] border-neutral-700 text-white' : 'bg-white border-neutral-200 text-[#0A0A0A]'
            }`}
          >
            <div aria-hidden="true" className={`mx-auto mb-2 h-1.5 w-12 rounded-full ${darkMode ? 'bg-neutral-700' : 'bg-neutral-300'}`} />
            <div className={`sticky top-0 z-10 -mx-5 sm:-mx-6 px-5 sm:px-6 py-2 -mt-1 mb-1 flex items-center justify-between backdrop-blur-md ${darkMode ? 'bg-[#141414]/90' : 'bg-white/90'}`}>
              <div>
                <h2 className="text-sm font-black">{isAr ? 'طلباتك' : 'Your orders'}</h2>
                <p className="text-[11px] text-neutral-500">
                  {isAr ? 'تظهر هنا لمدة 12 ساعة' : 'Kept here for 12 hours'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSound}
                  aria-pressed={!soundOff}
                  aria-label={isAr ? 'كتم صوت الجرس' : 'Mute bell sound'}
                  title={isAr ? 'كتم صوت الجرس' : 'Mute bell sound'}
                  className={`btn-tactile h-9 px-4 rounded-full border text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors ${
                    soundOff
                      ? darkMode
                        ? 'border-neutral-700 text-neutral-400 hover:text-white'
                        : 'border-neutral-300 text-neutral-500 hover:text-black'
                      : 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10'
                  }`}
                >
                  {soundOff ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  {isAr ? (soundOff ? 'الصوت مكتوم' : 'الصوت شغال') : (soundOff ? 'Muted' : 'Sound on')}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={isAr ? 'إغلاق' : 'Close'}
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${darkMode ? 'text-neutral-400 hover:bg-white/10' : 'text-neutral-500 hover:bg-black/5'}`}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {loading && !orders.length ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
              </div>
            ) : (
              <div className="mt-2 space-y-2.5 pb-1">
                {orders.map((o) => (
                <div
                  key={o.n}
                  className={`relative overflow-hidden rounded-2xl border p-3 ${darkMode ? 'border-neutral-800 bg-black/40' : 'border-neutral-200 bg-neutral-50'}`}
                >
                  {(o.status === 'new' || o.status === 'confirmed') && (
                    <span aria-hidden="true" className="absolute top-0 inset-x-10 h-[2px] rounded-full bg-gradient-to-r from-transparent via-[var(--primary)] to-transparent" />
                  )}
                  <div className="flex items-center justify-between gap-2">
                      <span className="text-base font-black tabular-nums" dir="ltr">#{o.n}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${STATUS_STYLE[o.status]}`}>
                          {o.status === 'completed' && <Check size={11} strokeWidth={3.5} aria-hidden="true" />}
                          {statusLabel(o.status)}
                        </span>
                      </div>
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
