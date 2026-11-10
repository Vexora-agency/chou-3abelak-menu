import React, { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

interface KitchenBarProps {
  lang: 'en' | 'ar';
  /** True while the orders poll is failing — the board may be stale. */
  ordersError: boolean;
}

/**
 * Kitchen status strip: a connection indicator (browser online state
 * combined with the orders poll health). Sound control lives in the orders
 * header (OrdersDashPeriodBar bell toggle — the one that unlocks browser
 * audio); this strip carries no bell button by owner decision.
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
    </div>
  );
};
