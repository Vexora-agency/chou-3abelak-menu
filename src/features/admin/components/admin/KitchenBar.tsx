import React, { useEffect, useState } from 'react';
import { BellRing, Wifi, WifiOff } from 'lucide-react';
import { playNewOrderBeep, unlockOrderSound } from '@/src/features/orders';

interface KitchenBarProps {
  lang: 'en' | 'ar';
  /** True while the orders poll is failing — the board may be stale. */
  ordersError: boolean;
}

/**
 * Full-screen kitchen header: a prominent bell (proof-of-life tap that
 * unlocks browser audio and plays the picked chime) + a connection
 * indicator (browser online state combined with the orders poll health).
 * The orders list itself is untouched — AdminDashboardTab renders below.
 */
export const KitchenBar: React.FC<KitchenBarProps> = ({ lang, ordersError }) => {
  const isAr = lang === 'ar';
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );

  useEffect(() => {
    const goOn = () => setOnline(true);
    const goOff = () => setOnline(false);
    window.addEventListener('online', goOn);
    window.addEventListener('offline', goOff);
    return () => {
      window.removeEventListener('online', goOn);
      window.removeEventListener('offline', goOff);
    };
  }, []);

  const [rang, setRang] = useState(false);
  const testBell = () => {
    unlockOrderSound();
    playNewOrderBeep();
    setRang(true);
    window.setTimeout(() => setRang(false), 2500);
  };

  const connected = online && !ordersError;

  return (
    <div
      className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 flex items-center justify-between gap-3"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className="relative flex h-3 w-3 shrink-0"
          role="status"
          aria-label={connected ? (isAr ? 'متصل' : 'Connected') : (isAr ? 'غير متصل' : 'Offline')}
        >
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${
              connected ? 'bg-green-400' : 'bg-red-400'
            }`}
          />
          <span
            className={`relative inline-flex h-3 w-3 rounded-full ${
              connected ? 'bg-green-400' : 'bg-red-400'
            }`}
          />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black text-white truncate">
            {isAr ? 'شاشة المطبخ' : 'Kitchen screen'}
          </p>
          <p className="text-[11px] text-neutral-500 flex items-center gap-1">
            {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
            {connected
              ? (isAr ? 'متصل — الطلبات الجديدة تظهر هنا' : 'Connected — new orders appear here')
              : !online
                ? (isAr ? 'لا يوجد اتصال بالإنترنت' : 'No internet connection')
                : (isAr ? 'تعذر تحديث الطلبات — تحقق من الاتصال' : 'Orders failing to refresh — check connection')}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={testBell}
        aria-label={isAr ? 'اختبار جرس المطبخ' : 'Test the kitchen bell'}
        className="btn-tactile shrink-0 h-12 min-h-[48px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center gap-2 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        <BellRing size={17} />
        {rang
          ? (isAr ? 'شغّال!' : 'Ringing!')
          : (isAr ? 'جرّب الجرس' : 'Test bell')}
      </button>
    </div>
  );
};
