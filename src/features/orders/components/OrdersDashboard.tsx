import { useEffect, useRef, useState, type FC } from 'react';
import type { Order, OrderItem, OrderStatus, OrderType, OrdersDashboardProps, Period, CronHealth } from './orders/ordersDashTypes';
import { useOrdersDashClock } from '../hooks/useOrdersDashClock';
import { useOrdersDashStats } from '../hooks/useOrdersDashStats';
import { isFreshOrder, playNewOrderBeep, unlockOrderSound, useNewOrderAlarm, useNewOrderSound } from '../hooks/useNewOrderSound';
import { OrdersDashChart, OrdersDashKpis, OrdersDashPeriodBar, OrdersDashTopItems } from './orders/OrdersDashPanels';
import { OrdersDashList } from './orders/OrdersDashList';

export type { Order, OrderItem, OrderStatus, OrderType, Period, CronHealth };

/* ---------- Main component ---------- */
const OrdersDashboard: FC<OrdersDashboardProps> = ({ lang, menu, orders, currency, loading, onStatusChange, onRefresh, kitchenSound, onConfirm, kitchen }) => {  const isAr = lang === 'ar';
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  const { now } = useOrdersDashClock();

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
    setSoundOn((v) => {
      const next = !v;
      try {
        localStorage.setItem('dash_sound_v1', next ? 'on' : 'off');
      } catch {}
      if (next) {
        // Proof-of-life: toggling on always beeps instantly, so the owner
        // can verify the speaker with one tap (and so can we, remotely).
        unlockOrderSound();
        playNewOrderBeep(kitchenSound);
      }
      return next;
    });
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
      {/* Kitchen push card hidden by owner decision (Telegram is the alert
          channel now). The component + backend stay intact for already-
          subscribed devices — re-add <KitchenPushCard lang={lang} /> here
          to bring the UI back. */}
      <OrdersDashPeriodBar
        lang={lang}
        period={period}
        onPeriodChange={(p) => { setPeriod(p); setSel(null); }}
        onRefresh={onRefresh}
        soundOn={soundOn}
        onToggleSound={toggleSound}
      />
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
      />
    </div>
  );
};

export default OrdersDashboard;
