import { useEffect, useRef, useState, type FC } from 'react';
import { BellOff } from 'lucide-react';
import type { Order, OrderItem, OrderStatus, OrderType, OrdersDashboardProps, Period, CronHealth } from './orders/ordersDashTypes';
import { STR } from './orders/ordersDashTypes';
import { useOrdersDashClock } from '../hooks/useOrdersDashClock';
import { useOrdersDashStats } from '../hooks/useOrdersDashStats';
import { useKitchenPush, type KitchenPushStatus } from '../hooks/useKitchenPush';
import { isFreshOrder, playNewOrderBeep, unlockOrderSound, useNewOrderAlarm, useNewOrderSound } from '../hooks/useNewOrderSound';
import { OrdersDashChart, OrdersDashKpis, OrdersDashPeriodBar, OrdersDashTopItems } from './orders/OrdersDashPanels';
import { OrdersDashList } from './orders/OrdersDashList';
import { isIosDevice, isPushCapable, isStandaloneApp } from '@/src/utils/webpush';

export type { Order, OrderItem, OrderStatus, OrderType, Period, CronHealth };

type DashboardSTR = (typeof STR)[keyof typeof STR];

/** Short, professional notice for the bell-off / push-unavailable states. */
function pushNoticeFor(status: KitchenPushStatus, t: DashboardSTR): string | null {
  if (status === 'on' || status === 'off') return null;
  if (status === 'denied') return t.notificationsBlocked;
  if (status === 'ios') return t.notificationsIos;
  if (status === 'unsupported') return t.notificationsUnsupported;
  return t.notificationsError;
}

/* ---------- Main component ---------- */
const OrdersDashboard: FC<OrdersDashboardProps> = ({ lang, menu, orders, currency, loading, onStatusChange, onRefresh, kitchenSound, onConfirm, kitchen, onTrustReview, onBlockPhone }) => {  const isAr = lang === 'ar';
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  const { now } = useOrdersDashClock();
  const t = STR[lang];
  const { enable: enablePush, disable: disablePush } = useKitchenPush();
  const [pushNotice, setPushNotice] = useState<string | null>(null);

  const [period, setPeriod] = useState<Period>('7d');
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(6);
  const [sel, setSel] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  const { sorted, stats, pendingCount, counts, list } = useOrdersDashStats({
    orders, period, lang, now, filter, sel,
  });

  // Kitchen bell: beeps ONLY for genuinely fresh arrivals — a `new` order
  // created within minutes. Stuck `new` rows from days ago (never
  // auto-completed by design) and the first month-long history load stay
  // silent; without the age gate every old id looked like a new arrival.
  // Preference survives reloads; the first tap anywhere unlocks audio
  // (autoplay policy) so the bell works even if it starts muted-by-browser.
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dash_sound_v1') !== 'off';
    } catch {
      return true;
    }
  });
  const initialSoundOn = useRef(soundOn);

  // Default-on: silently re-register an existing subscription on mount (or
  // subscribe when permission was already granted). If the bell was turned
  // off previously, remove this device's subscription instead.
  useEffect(() => {
    if (initialSoundOn.current) {
      void enablePush(false).then((status) => {
        if (status === 'denied') setPushNotice(t.notificationsBlocked);
      });
    } else {
      void disablePush();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync
  }, []);

  // The off/unavailable notice is a short toast, not a permanent card.
  useEffect(() => {
    if (!pushNotice) return;
    const id = window.setTimeout(() => setPushNotice(null), 6500);
    return () => window.clearTimeout(id);
  }, [pushNotice]);

  // Browsers require a user gesture for the permission prompt. Ask once on
  // the first dashboard interaction (excluding the bell itself, which has its
  // own toggle handler) so alerts are on by default without a card.
  useEffect(() => {
    if (!soundOn) return;
    if (!isPushCapable() || (isIosDevice() && !isStandaloneApp())) return;
    if (typeof Notification !== 'undefined' && Notification.permission !== 'default') return;
    let alreadyPrompted = false;
    try {
      alreadyPrompted = localStorage.getItem('dash_push_prompted_v1') === '1';
    } catch {}
    if (alreadyPrompted) return;
    const onFirst = (event: Event) => {
      const target = event.target as Element | null;
      if (target && typeof target.closest === 'function' && target.closest('[data-sound-toggle]')) return;
      cleanup();
      try {
        localStorage.setItem('dash_push_prompted_v1', '1');
      } catch {}
      void enablePush(true).then((status) => {
        setPushNotice(pushNoticeFor(status, t));
      });
    };
    const cleanup = () => {
      window.removeEventListener('pointerdown', onFirst, true);
      window.removeEventListener('keydown', onFirst, true);
    };
    window.addEventListener('pointerdown', onFirst, true);
    window.addEventListener('keydown', onFirst, true);
    return cleanup;
  }, [soundOn, enablePush, t]);

  const freshNewIds = orders
    .filter((o) => o.status === 'new' && isFreshOrder(o.createdAt))
    .map((o) => o.id);
  useNewOrderSound(freshNewIds, soundOn, kitchenSound);
  // Looping alarm while a FRESH order is still unacknowledged (status new).
  // Ancient stuck rows never arm it — the owner never hunts for a stop
  // button, and the board never chimes with no order. Acking (or cancelling)
  // the last fresh one flips `active` off and the interval cleans itself up.
  useNewOrderAlarm(orders.some((o) => o.status === 'new' && isFreshOrder(o.createdAt)), soundOn, kitchenSound);
  useEffect(() => {
    // Every interaction flavor unlocks audio (mouse, touch, keyboard, tab
    // focus/return): the first gesture anywhere arms all future beeps.
    const unlock = () => unlockOrderSound();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('focus', unlock);
    document.addEventListener('visibilitychange', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('focus', unlock);
      document.removeEventListener('visibilitychange', unlock);
    };
  }, []);
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem('dash_sound_v1', next ? 'on' : 'off');
    } catch {}
    if (next) {
      // Proof-of-life: toggling on always beeps instantly, so the owner can
      // verify the speaker with one tap — and it re-enables Web Push.
      unlockOrderSound();
      playNewOrderBeep(kitchenSound);
      void enablePush(true).then((status) => {
        setPushNotice(pushNoticeFor(status, t));
      });
    } else {
      setPushNotice(t.notificationsOff);
      void disablePush();
    }
  };

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
        soundOn={soundOn}
        onToggleSound={toggleSound}
      />
      {pushNotice && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] font-bold text-neutral-300"
        >
          <BellOff size={13} className="mt-0.5 shrink-0 text-neutral-500" aria-hidden="true" />
          <span className="min-w-0 break-words">{pushNotice}</span>
        </div>
      )}
      {!kitchen && (
        <>
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
        </>
      )}
      <OrdersDashList
        lang={lang}
        menu={menu}
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
        onConfirm={onConfirm}
        kitchen={kitchen}
        onTrustReview={onTrustReview}
        onBlockPhone={onBlockPhone}
      />
    </div>
  );
};

export default OrdersDashboard;
