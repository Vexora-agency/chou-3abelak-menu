import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, CookingPot, ArrowUp, XCircle, ArrowLeft, BellRing, Loader2, Truck } from 'lucide-react';
import { formatPrice, unitLabel } from '@/src/utils/pricing';
import { formatMMSS } from '@/src/utils/countdown';
import { useNow } from '@/src/hooks/useNow';
import { etaRange, formatEtaRangeWithDay } from '@/src/utils/etaFormat';
import { CountUp } from '@/src/components/motion';
import { scrollPageToTop } from '@/src/lib/motion/smoothScroll';
import { ReceivedButton } from './components/ReceivedButton';
import { CancelOrderButton } from './components/CancelOrderButton';
import { InstallAppCard } from './components/InstallAppCard';
import { cancelWindowMsFromMenu, cancelWindowRemainingMs } from './orderPhases';

interface TrackViewProps {
  number: number;
  token: string;
  onBack: () => void;
}

interface TrackItem {
  qty: number;
  unitPrice: number;
  /** Pricing unit id (absent on orders placed before units shipped). */
  unit?: string;
  name: { en: string; ar: string };
  variantName?: { en: string; ar: string };
  /** Split-count entries carry `count` (present only for split lines —
   *  legacy entries omit it and render exactly as today). */
  addonNames?: { en: string; ar: string; count?: number }[];
}

interface TrackData {
  number: number;
  /** `ready` is legacy (pre-simplification orders) — mapped to preparing. */
  status: 'new' | 'confirmed' | 'ready' | 'completed' | 'cancelled';
  type?: 'delivery' | 'pickup' | 'dinein';
  /** Payment method (today always 'cod') + status. */
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  /** Follow-up link (server-computed): earlier order number or null. */
  parentNumber?: number | null;
  /**
   * Joint group (server-computed): OTHER member numbers + their combined
   * total. Present when this order rides with follow-ups — the page offers
   * one tap confirming them all. Null when solo.
   */
  linked?: { numbers: number[]; total: number } | null;
  items: TrackItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  lang: 'en' | 'ar';
  createdAt?: string;
  /**
   * Smart-ETA contract: both optional. Absent or invalid = old behavior
   * (button enabled once confirmed — never trap the user on a stale
   * backend that doesn't send these fields).
   * - `etaAt`: ISO instant the order is expected to arrive (banner range).
   * - `receivableAt`: ISO instant the receive button unlocks (delivery lock).
   */
  etaAt?: string | null;
  receivableAt?: string | null;
}

const pick = (v: { en: string; ar: string } | undefined, lang: 'en' | 'ar') => {
  if (!v) return '';
  return (lang === 'ar' ? v.ar : v.en) || (lang === 'ar' ? v.en : v.ar) || '';
};

/**
 * Customer order tracking (?track=N&t=token): standalone page, no menu data
 * needed. Polls the token-gated /api/track every 10s while visible — the
 * owner's dashboard status tap is what moves this timeline.
 */
/** Site language preference (same key the storefront writes). */
function siteLang(): 'en' | 'ar' | null {
  try {
    const v = window.localStorage.getItem('menu_lang_v1');
    return v === 'en' || v === 'ar' ? v : null;
  } catch {
    return null;
  }
}

export const TrackView: React.FC<TrackViewProps> = ({ number, token, onBack }) => {
  // Follow the site language when set; otherwise fall back to the order's.
  // (The manual toggle below always wins for this visit.)
  const [lang, setLang] = useState<'en' | 'ar'>(() => siteLang() ?? 'ar');
  const [data, setData] = useState<TrackData | null>(null);
  const [missing, setMissing] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [currency, setCurrency] = useState('LBP');
  // Store zone (Asia/Beirut default): the ETA day + clock share ONE zone so
  // the date and the time can never disagree with the confirmation email
  // (which formats in the same zone). Falls back to the device zone.
  const [storeTz, setStoreTz] = useState<string | undefined>(undefined);
  // Owner-tuned customer-cancel window (ms): read from the menu doc
  // (settings.ordering.cancelWindowMin, 1..30 min), default 5 min so old
  // menus behave exactly as today.
  const [cancelWindowMs, setCancelWindowMs] = useState<number>(() => cancelWindowMsFromMenu(null));
  // Render clock: poll stamp refreshed on every 10 s fetch (network stays
  // exactly at 10 s). While a delivery lock is armed the DISPLAY clock
  // below takes over at 1 s so the countdown ticks every second with zero
  // extra fetches. Read displayNowMs in render (never Date.now() inline —
  // hooks purity rule).
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showTop, setShowTop] = useState(false);
  const isAr = lang === 'ar';

  // iPhone-safe "back to top": a floating button that appears once the
  // page is scrolled down. Tapping the iOS status bar doesn't reliably
  // jump to the top inside this standalone view (sticky bar + 100dvh
  // toolbar resizing absorb the gesture), so this one-tap control is the
  // guaranteed way back — no gesture or browser quirk involved.
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Always enter at the top: a reload restores the old scroll position and
  // a bfcache return lands mid-page — the tracking page must start at its
  // header. Restores the browser default on unmount so menu navigation
  // keeps its native behavior. NOTE: leaving this page is always a FULL
  // navigation (back button = location.href), so the React cleanup below
  // never runs — the pagehide listener resets the value on the way out,
  // otherwise the tab stays poisoned on 'manual' and later menu
  // restores (swipe-back / reload after iOS discards the tab) wrongly
  // land at the top.
  useEffect(() => {
    let prev: ScrollRestoration = 'auto';
    try {
      if ('scrollRestoration' in window.history) {
        prev = window.history.scrollRestoration;
        window.history.scrollRestoration = 'manual';
      }
    } catch {}
    window.scrollTo(0, 0);
    const heal = () => {
      try {
        if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'auto';
      } catch {}
    };
    window.addEventListener('pagehide', heal);
    return () => {
      window.removeEventListener('pagehide', heal);
      try {
        if ('scrollRestoration' in window.history) window.history.scrollRestoration = prev;
      } catch {}
    };
  }, [number, token]);

  useEffect(() => {
    let stop = false;
    const loadMenu = async () => {
      try {
        const res = await fetch('/api/menu');
        if (!res.ok) return;
        const m = (await res.json()) as {
          settings?: { name?: { en: string; ar: string }; currency?: { en: string; ar: string }; timezone?: string; ordering?: unknown };
        };
        if (stop) return;
        const nm = m?.settings?.name;
        if (nm) setStoreName(lang === 'ar' ? nm.ar || nm.en : nm.en || nm.ar);
        const cur = m?.settings?.currency;
        if (cur) setCurrency(lang === 'ar' ? cur.ar || cur.en : cur.en || cur.ar);
        const tz = m?.settings?.timezone;
        if (typeof tz === 'string' && tz.trim()) setStoreTz(tz.trim());
        setCancelWindowMs(cancelWindowMsFromMenu(m));
      } catch {}
    };
    void loadMenu();
    return () => {
      stop = true;
    };
    // Re-runs on language toggle so the store name + currency word follow
    // the switch (stale ل.ل/LBP after toggling was the bug).
  }, [lang]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/track?number=${number}&t=${encodeURIComponent(token)}`);
        if (stop) return;
        if (res.status === 404) {
          setMissing(true);
          return;
        }
        if (!res.ok) return;
          const d = (await res.json()) as TrackData & { ok?: boolean };
          if (stop || !d || d.ok === false) return;
          setData(d);
          setNowMs(Date.now());
          if (!siteLang() && (d.lang === 'ar' || d.lang === 'en')) setLang(d.lang);
      } catch {}
    };
    void tick();
    // 10 s cadence: the kitchen-side change still lands within seconds of
    // opening the page (immediate tick above); the steady poll only needs
    // to catch up while the customer watches. Keeps per-order KV + D1
    // reads ~30% below the old 7 s rhythm with no felt difference.
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, 10000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [number, token]);

  // Simplified flow: new -> confirmed (owner tapped "بدء التحضير") ->
  // completed (customer tapped "نعم، استلمت"). Legacy `ready` orders map
  // to the preparing stage — no new order ever enters `ready` anymore.
  const steps = [
    { id: 'new', label: isAr ? 'استلمنا طلبك' : 'Order received', icon: Clock },
    { id: 'confirmed', label: isAr ? 'طلبك قيد التحضير' : 'Being prepared', icon: CookingPot },
    { id: 'completed', label: isAr ? 'تم التوصيل' : 'Delivered', icon: CheckCircle2 },
  ];
  const stage = data?.status === 'completed' ? 2 : data?.status === 'confirmed' || data?.status === 'ready' ? 1 : 0;
  const cancelled = data?.status === 'cancelled';
  // Customer receipt unlocks only after the place starts preparing.
  const awaitingConfirm = data?.status === 'new';
  // Phase-1 countdown (shared orderPhases rule with the bell): while a
  // `new` order is still inside its cancel window the button explains the
  // wait with a live countdown; afterwards it shows the static "waiting"
  // line until the kitchen confirms.
  const cancelRemainingPollMs =
    data?.status === 'new' ? cancelWindowRemainingMs(data.createdAt ?? null, nowMs, cancelWindowMs) : null;
  const cancelArmed = cancelRemainingPollMs !== null && cancelRemainingPollMs > 0;
  // Delivery lock (smart-ETA contract): while confirmed/ready AND the
  // server's `receivableAt` is still in the future, the button stays
  // disabled with a live countdown. Absent/invalid/past = today's behavior
  // (enabled once confirmed) — stale clients are never trapped.
  const receivableMs =
    data && typeof data.receivableAt === 'string' && data.receivableAt ? Date.parse(data.receivableAt) : NaN;
  // Arm the 1 s display ticker on the poll clock: while the server's
  // `receivableAt` is still in the future the countdown below must tick
  // every second (the 10 s fetch alone would visibly stall it).
  const lockArmed =
    !!data &&
    (data.status === 'confirmed' || data.status === 'ready') &&
    Number.isFinite(receivableMs) &&
    receivableMs > nowMs;
  // Either countdown (delivery lock or cancel window) drives the 1 s
  // display ticker so both tick every second with zero extra fetches.
  const liveArmed = lockArmed || cancelArmed;
  const tickNowMs = useNow(liveArmed, 1000);
  // Display clock: live 1 s ticks while a countdown runs, poll stamp otherwise.
  const displayNowMs = liveArmed ? tickNowMs : nowMs;
  const deliveryLocked =
    !!data &&
    (data.status === 'confirmed' || data.status === 'ready') &&
    Number.isFinite(receivableMs) &&
    receivableMs > displayNowMs;
  const receivedDisabled = awaitingConfirm || deliveryLocked;
  const lockedRemainingMs = deliveryLocked ? Math.max(0, receivableMs - displayNowMs) : 0;
  // Recompute the cancel countdown on the display clock so it ticks live.
  const cancelRemainingMs =
    data?.status === 'new' ? cancelWindowRemainingMs(data.createdAt ?? null, displayNowMs, cancelWindowMs) : null;
  const inCancelWindow = cancelRemainingMs !== null && cancelRemainingMs > 0;
  // ETA banner range: etaAt ±20% (min ±5 min each side), computed at render
  // so the poll keeps it fresh (live while locked). Day-aware ("اليوم /
  // غداً / 6 نوفمبر") in the STORE zone — the same zone + same instant the
  // confirmation email shows, so the two can never disagree. Invalid/absent
  // = no banner.
  const etaWindow = data && !cancelled && data.status !== 'completed' && typeof data.etaAt === 'string' && data.etaAt
    ? etaRange(data.etaAt, displayNowMs)
    : null;
  const etaLabel = etaWindow ? formatEtaRangeWithDay(etaWindow.fromIso, etaWindow.toIso, lang, storeTz, displayNowMs) : '';

  return (
    <div dir={isAr ? 'rtl' : 'ltr'} className="relative isolate min-h-dvh overflow-x-clip bg-[#0A0A0A] text-white flex flex-col items-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] sm:pb-12">
      {/* Ambient background: one continuous wash from top to bottom so the
          page never reads as two halves. Pure decoration, zero layout. */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <div className="absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(62%_100%_at_50%_0%,rgba(212,175,55,0.13),transparent_70%)]" />
        <div className="absolute inset-x-0 bottom-0 h-[340px] bg-[radial-gradient(72%_100%_at_50%_100%,rgba(212,175,55,0.05),transparent_70%)]" />
      </div>
      <div className="relative z-10 w-full max-w-[520px] sm:max-w-[560px]">
        {/* Top bar: sticky on phones (thumb reach), static card on desktop. */}
        <div className="sticky top-0 z-20 -mx-5 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-[#0A0A0A]/95 backdrop-blur-none border-b border-white/5 shadow-[0_12px_34px_-24px_rgba(0,0,0,0.9)] sm:static sm:mx-0 sm:mt-6 sm:rounded-2xl sm:border sm:border-white/10 sm:bg-white/[0.03] sm:px-4 sm:shadow-none">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex shrink-0 items-center gap-1.5 h-11 px-3 -ms-3 rounded-xl text-xs font-bold text-neutral-300 hover:text-[var(--primary)] active:text-[var(--primary)]"
            >
              <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} />
              {isAr ? 'القائمة' : 'Menu'}
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-neutral-500">
                {isAr ? 'تتبع الطلب' : 'Order tracking'}
              </p>
              <p className="truncate text-xs font-black text-white">
                {storeName || (isAr ? 'تتبع الطلب' : 'Order tracking')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLang(isAr ? 'en' : 'ar')}
              className="inline-flex shrink-0 items-center justify-center h-11 px-5 rounded-full border border-neutral-700 text-xs font-bold text-neutral-300 hover:border-[var(--primary)] hover:text-[var(--primary)] active:border-[var(--primary)]"
            >
              {isAr ? 'EN' : 'عربي'}
            </button>
          </div>
        </div>
        <div className="pt-4">

        {missing ? (
          <div className="text-center py-16">
            <XCircle size={40} className="mx-auto text-neutral-600" />
            <p className="mt-4 font-black text-lg">{isAr ? 'رابط التتبع غير صالح' : 'Invalid tracking link'}</p>
              <p className="mt-1 text-sm text-neutral-400">
                {isAr ? 'استخدم رابط التتبع الكامل الخاص بطلبك.' : 'Use your order’s full tracking link.'}
              </p>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-16">
            <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
          </div>
        ) : (
          <>
            {/* Status card: number + live stage + timeline + ETA in one
                unbroken surface. */}
            <section aria-label={isAr ? 'حالة الطلب' : 'Order status'} className="mt-5 rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)]">
              <p className="text-center text-[10px] font-extrabold uppercase tracking-[0.22em] text-neutral-500">
                {isAr ? 'طلب' : 'Order'}
              </p>
              <h1 className="text-center text-3xl sm:text-4xl font-black mt-1 tabular-nums" dir="ltr">
                <CountUp value={data.number} duration={1.05} format={(n) => `#${Math.round(n)}`} />
              </h1>
              {!cancelled && (
                <div className="mt-2.5 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/15 px-3.5 py-1.5 text-[11px] font-black text-[var(--primary)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-pulse" aria-hidden="true" />
                    {steps[stage].label}
                  </span>
                </div>
              )}
              {etaLabel && !cancelled && (
                <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-xs font-bold text-neutral-300">
                  <Truck size={13} className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    {isAr ? 'سيصلك طلبك تقريبًا ' : 'Arriving around '}
                    <span dir="ltr" className="tabular-nums">{etaLabel}</span>
                  </span>
                </p>
              )}
              {cancelled ? (
                <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-950/30 p-5 text-center">
                  <XCircle size={32} className="mx-auto text-red-400" />
                  <p className="mt-2 font-black">{isAr ? 'تم إلغاء الطلب' : 'Order cancelled'}</p>
                  <p className="mt-1 text-xs text-neutral-400">
                    {isAr ? 'تواصل معنا إذا كان لديك أي استفسار.' : 'Call us if you have any questions.'}
                  </p>
                </div>
              ) : (
                <ol data-motion-reveal="fade" className="mt-5 space-y-0">
                  {steps.map((s, i) => {
                    const done = i <= stage;
                    const current = i === stage;
                    const Icon = s.icon;
                    return (
                      <li key={s.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span
                            className={`w-9 h-9 rounded-full flex items-center justify-center border-2 ${
                              done
                                ? 'bg-[var(--primary)] border-[var(--primary)] text-[#0A0A0A]'
                                : 'border-white/15 text-neutral-600'
                            } ${current ? 'animate-pulse' : ''}`}
                          >
                            <Icon size={17} strokeWidth={2.5} />
                          </span>
                          {i < steps.length - 1 && (
                            <span className={`w-0.5 flex-1 min-h-[22px] ${i < stage ? 'bg-[var(--primary)]' : 'bg-white/10'}`} />
                          )}
                        </div>
                        <div className="pb-6 pt-1.5 min-w-0 last:pb-1">
                          <p className={`text-sm font-black break-words ${done ? 'text-white' : 'text-neutral-500'}`}>{s.label}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <div data-motion-reveal="up" data-motion-delay="80" className="mt-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-5 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)]">
              <div className="divide-y divide-white/5">
              {data.items.map((it, i) => (
                <div key={i} className="flex justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 break-words text-neutral-200">
                    <bdi dir="ltr" className="tabular-nums">{it.qty}</bdi><span dir="ltr"> × </span>
                    {typeof it.unit === 'string' && it.unit ? <span>{unitLabel(it.unit, it.qty, lang)} </span> : null}
                    {pick(it.name, lang)}
                    {it.variantName && <span className="text-neutral-400"> ({pick(it.variantName, lang)})</span>}
                    {it.addonNames && it.addonNames.length > 0 && (
                      <span className="block text-[11px] text-neutral-400">
                        + {(it.addonNames.map((a) => {
                          const nm = pick(a, lang);
                          // Split lines: partial picks (0 < count < qty)
                          // render as `name ×n`; full-count and legacy
                          // entries render exactly as today.
                          const c = typeof a.count === 'number' ? a.count : NaN;
                          return Number.isInteger(c) && c > 0 && c < it.qty ? `${nm} ×${c}` : nm;
                        }) || []).join(isAr ? '، ' : ', ')}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-neutral-300 shrink-0" dir="ltr">
                    {formatPrice(it.unitPrice * it.qty)}
                  </span>
                </div>
              ))}
              </div>
              <div className="border-t border-white/10 mt-2.5 pt-2.5 flex justify-between text-sm font-black">
                <span>{isAr ? 'الإجمالي' : 'Total'}</span>
                <span className="tabular-nums text-[var(--primary)]">
                  <CountUp value={data.total} duration={1.25} format={(n) => formatPrice(Math.round(n))} />
                  {' '}
                  <span dir="auto">{currency}</span>
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/[0.07] px-3 py-2">
                <span className="text-[11px] font-bold text-neutral-400">{isAr ? 'طريقة الدفع' : 'Payment'}</span>
                <span className="text-xs font-black text-[var(--primary)]" dir="auto">
                  {isAr ? 'الدفع عند الاستلام' : 'Cash on Delivery'}
                </span>
              </div>
            </div>

            {data.status === 'new' && data.createdAt && (
              <div className="mt-4">
                <CancelOrderButton
                  number={data.number}
                  token={token}
                  createdAt={data.createdAt}
                  status={data.status}
                  lang={lang}
                  darkMode
                  cancelWindowMs={cancelWindowMs}
                  onCancelled={() => setData((d) => (d ? { ...d, status: 'cancelled' } : d))}
                />
              </div>
            )}
            {(data.status === 'new' || data.status === 'confirmed' || data.status === 'ready') && (
              <div className="mt-4">
                <ReceivedButton
                  number={data.number}
                  token={token}
                  lang={lang}
                  darkMode
                  groupCount={data.linked && Array.isArray(data.linked.numbers) && data.linked.numbers.length > 0 ? data.linked.numbers.length + 1 : undefined}
                  disabled={receivedDisabled}
                  waitingHint={awaitingConfirm ? (
                    inCancelWindow ? (
                      isAr ? (
                        <>سيُقبَل طلبك بعد انتهاء مهلة الإلغاء (المتبقي <span dir="ltr" className="tabular-nums">{formatMMSS(cancelRemainingMs ?? 0)}</span>)</>
                      ) : (
                        <>Your order will be accepted after the cancellation window ends (<span dir="ltr" className="tabular-nums">{formatMMSS(cancelRemainingMs ?? 0)}</span> left)</>
                      )
                    ) : undefined
                  ) : deliveryLocked ? (
                    isAr ? (
                      <>تم قبول طلبك وهو قيد التحضير الآن<br />سيتم تفعيل زر التأكيد بعد التوصيل (المتبقي <span dir="ltr" className="tabular-nums">{formatMMSS(lockedRemainingMs)}</span>)</>
                    ) : (
                      <>Your order is accepted and being prepared<br />Confirm unlocks after delivery (<span dir="ltr" className="tabular-nums">{formatMMSS(lockedRemainingMs)}</span> left)</>
                    )
                  ) : undefined}
                  onConfirmed={() => setData((d) => (d ? { ...d, status: 'completed' } : d))}
                />
              </div>
            )}

            {(data.status === 'new' || data.status === 'confirmed' || data.status === 'ready') && (
              <InstallAppCard orderNumber={data.number} trackToken={token} lang={lang} />
            )}
            <p className="mt-4 text-center text-xs text-neutral-400 flex flex-wrap items-center gap-1 justify-center w-full">
              <BellRing size={12} className="shrink-0" />
              <span className="min-w-0 break-words">{isAr ? 'تُحدَّث الصفحة تلقائيًا — أبقِها مفتوحة.' : 'This page updates itself — keep it open.'}</span>
            </p>
          </>
        )}
        </div>
      </div>
      {showTop && (
        <button
          type="button"
          onClick={() => scrollPageToTop()}
          aria-label={isAr ? 'الرجوع لأعلى الصفحة' : 'Back to top'}
          className="btn-tactile fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] end-5 z-30 w-12 h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center shadow-[0_8px_30px_rgba(0,0,0,0.45)] ring-1 ring-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
        >
          <ArrowUp size={20} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
};
