import { useEffect, useRef, useState, type FC } from 'react';
import type { Order, OrderItem, OrderStatus, OrderType, OrdersDashboardProps, Period } from './orders/ordersDashTypes';
import { useOrdersDashClock } from '../hooks/useOrdersDashClock';
import { useOrdersDashStats } from '../hooks/useOrdersDashStats';
import { playNewOrderBeep, isAudioLocked, unlockOrderSound, useNewOrderAlarm, useNewOrderSound } from '../hooks/useNewOrderSound';
import { isIosDevice } from '@/src/utils/webpush';
import { OrdersDashChart, OrdersDashKpis, OrdersDashPeriodBar, OrdersDashTopItems } from './orders/OrdersDashPanels';
import { OrdersDashList } from './orders/OrdersDashList';
import { KitchenPushCard } from './KitchenPushCard';

export type { Order, OrderItem, OrderStatus, OrderType, Period };

/* ---------- Main component ---------- */

/**
 * Self-diagnosing audio hint: while unacknowledged orders exist and the bell
 * is on, re-checks the autoplay lock every 2s. If the browser still refuses
 * audio (no gesture yet), it says so WITH the fix (tap anywhere) instead of
 * beeping into the void — the #1 "sometimes silent" cause, made visible.
 * Mounts only while relevant; unmounts (interval cleaned) otherwise.
 */
const AudioLockHint: FC<{ visible: boolean; isAr: boolean }> = ({ visible, isAr }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 2000);
    return () => window.clearInterval(id);
  }, [visible]);
  if (!visible) return null;
  let locked = true;
  try {
    locked = isAudioLocked();
  } catch {
    locked = true;
  }
  if (!locked) return null;
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[11px] font-bold text-amber-300 flex items-center gap-2">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
      </span>
      {isAr
        ? 'الصوت مقفول من المتصفح — دوس في أي مكان بالصفحة لتشغيله.'
        : 'Browser muted audio — tap anywhere on the page to enable sound.'}
      {isIosDevice() && (
        <span className="opacity-80">
          {isAr ? 'ولو آيفون: تأكد أن زر الصامت مطفأ.' : 'On iPhone also flip the mute switch off.'}
        </span>
      )}
    </div>
  );
};

const OrdersDashboard: FC<OrdersDashboardProps> = ({ lang, orders, currency, loading, onStatusChange, onRefresh }) => {  const isAr = lang === 'ar';
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

  // Kitchen bell: beeps when the 30s poll brings ids we haven't seen.
  // Preference survives reloads; the first tap anywhere unlocks audio
  // (autoplay policy) so the bell works even if it starts muted-by-browser.
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dash_sound_v1') !== 'off';
    } catch {
      return true;
    }
  });
  useNewOrderSound(orders.map((o) => o.id), soundOn);
  // Looping alarm while ANY order is still unacknowledged (status new).
  // Acking (or cancelling) the last one flips `active` off and the
  // interval cleans itself up — the owner never hunts for a stop button.
  useNewOrderAlarm(orders.some((o) => o.status === 'new'), soundOn);
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
        playNewOrderBeep();
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
      <KitchenPushCard lang={lang} />
      <AudioLockHint visible={soundOn && orders.some((o) => o.status === 'new')} isAr={isAr} />
      <OrdersDashPeriodBar
        lang={lang}
        period={period}
        onPeriodChange={(p) => { setPeriod(p); setSel(null); }}
        onRefresh={onRefresh}
        soundOn={soundOn}
        onToggleSound={toggleSound}
      />
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
      <OrdersDashList
        lang={lang}
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
      />
    </div>
  );
};

export default OrdersDashboard;
