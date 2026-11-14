import React, { useEffect, useRef } from 'react';
import { Bell, Moon, Settings, Sun, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import type { useHeaderMotion } from '@/src/hooks/useHeaderMotion';
import { useNow } from '@/src/hooks/useNow';
import { isSoundOff } from '@/src/utils/customerOrders';
import { CustomerAvatar, useCustomerOrders, useCustomerSession } from '@/src/features/auth';

interface HeaderTopBarProps {
  lang: 'en' | 'ar';
  onToggleLang: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAdmin?: () => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  rise: ReturnType<typeof useHeaderMotion>['rise'];
  /** Owner-picked customer chime (menu settings.sounds.customer). */
  bellSound: string;
}

const ACTIVE_STATUSES = new Set(['new', 'confirmed', 'ready']);

export const HeaderTopBar: React.FC<HeaderTopBarProps> = ({
  lang,
  onToggleLang,
  darkMode,
  onToggleDarkMode,
  onOpenAdmin,
  onOpenAuth,
  onOpenAccount,
  rise,
  bellSound,
}) => {
  const isAr = lang === 'ar';
  const { user, isPending } = useCustomerSession();
  const firstName = user?.name?.trim().split(/\s+/)[0] || user?.email?.split('@')[0] || '';

  // Members no longer have the floating bell: surface their live order on
  // the account button instead. The same account-orders hook keeps it fresh
  // (30 s + visibility + action events).
  const { orders, loaded: ordersLoaded } = useCustomerOrders(!!user, true);
  const activeOrders = orders.filter((order) => ACTIVE_STATUSES.has(order.status));
  const timedOrders = activeOrders.filter(
    (order) => (order.status === 'confirmed' || order.status === 'ready')
      && typeof order.receivableAt === 'string'
      && Number.isFinite(Date.parse(order.receivableAt)),
  );
  const nowMs = useNow(timedOrders.length > 0);
  const due = timedOrders.some((order) => Date.parse(order.receivableAt as string) <= nowMs);
  const hasActive = activeOrders.length > 0;
  const bellSoundRef = useRef(bellSound);
  bellSoundRef.current = bellSound;

  // Audio listeners for the header chime (the account sheet has its own).
  useEffect(() => {
    if (!user) return;
    let alive = true;
    void import('@/src/utils/bellSound')
      .then((mod) => {
        if (alive) mod.unlockBellAudio();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user?.id]);

  // Ring once when a timed order crosses its unlock instant. The first
  // completed fetch only seeds the state, so opening the site after the
  // unlock is silent (the bell badge still shows).
  const settledRef = useRef(false);
  const prevDueRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!user) {
      settledRef.current = false;
      prevDueRef.current = null;
      return;
    }
    if (!ordersLoaded) return;
    if (!settledRef.current) {
      settledRef.current = true;
      prevDueRef.current = due;
      return;
    }
    if (due && !prevDueRef.current && !isSoundOff()) {
      void import('@/src/utils/bellSound')
        .then((mod) => {
          mod.vibrateBell();
          void mod.playBellChime(bellSoundRef.current);
        })
        .catch(() => {});
    }
    prevDueRef.current = due;
  }, [due, ordersLoaded, user?.id]);

  const accountLabel = isPending
    ? (isAr ? 'جارٍ تحميل الحساب' : 'Loading account')
    : user
      ? due
        ? (isAr ? 'حسابي — طلب جاهز لتأكيد الاستلام' : 'My account — order ready to confirm')
        : hasActive
          ? (isAr ? 'حسابي — لديك طلب نشط' : 'My account — active order')
          : (isAr ? 'حسابي' : 'My account')
      : (isAr ? 'تسجيل الدخول' : 'Sign in');

  return (
    <motion.div
      {...rise(0.1)}
      className="relative z-10 flex justify-between items-center max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full"
    >
      <div className="glass-pill flex p-1 rounded-full">
        {(['en', 'ar'] as const).map((code) => {
          const active = lang === code;
          return (
            <button
              key={code}
              type="button"
              onClick={active ? undefined : onToggleLang}
              className={`relative min-w-[48px] h-11 min-h-[44px] px-3 rounded-full text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                active ? 'text-[#0A0A0A]' : 'text-white/75 hover:text-white'
              }`}
              aria-label={code === 'en' ? 'Switch to English' : 'التبديل إلى العربية'}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="lang-pill"
                  className="absolute inset-0 rounded-full bg-[var(--primary)] shadow-[0_4px_14px_-2px_color-mix(in_srgb,var(--primary)_60%,transparent)]"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative z-10">{code === 'en' ? 'EN' : 'عربي'}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleDarkMode}
          className="glass-pill btn-tactile w-11 h-11 rounded-full text-[var(--primary)] flex items-center justify-center"
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          title={darkMode ? (isAr ? 'الوضع النهاري' : 'Light Mode') : (isAr ? 'الوضع الليلي' : 'Dark Mode')}
        >
          <motion.span
            key={darkMode ? 'sun' : 'moon'}
            initial={{ rotate: -80, opacity: 0, scale: 0.6 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex"
          >
            {darkMode ? <Sun size={19} /> : <Moon size={19} />}
          </motion.span>
        </button>

        <button
          type="button"
          onClick={() => (user ? onOpenAccount?.() : onOpenAuth?.())}
          disabled={isPending || (!user && !onOpenAuth) || (!!user && !onOpenAccount)}
          aria-busy={isPending}
          aria-label={accountLabel}
          title={isPending ? undefined : user ? (isAr ? 'حسابي وطلباتي' : 'My account and orders') : (isAr ? 'تسجيل الدخول' : 'Sign in')}
          className="glass-pill btn-tactile relative h-11 min-h-[44px] w-11 sm:w-auto sm:px-3 rounded-full text-[var(--primary)] flex items-center justify-center gap-2 shrink-0 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          {isPending ? (
            <span className="w-5 h-5 rounded-full bg-white/20 animate-pulse" aria-hidden="true" />
          ) : user ? (
            <CustomerAvatar
              name={user.name}
              className="w-7 h-7 min-w-[28px] rounded-full"
              textClassName="text-xs"
            />
          ) : (
            <UserRound size={19} aria-hidden="true" />
          )}
          <span className={`hidden sm:inline text-xs font-bold text-white/85 max-w-[92px] truncate ${isPending ? 'opacity-0' : ''}`} dir="auto">
            {user ? firstName : (isAr ? 'دخول' : 'Sign in')}
          </span>

          {user && hasActive && (
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute -top-1 -end-1 z-10 rounded-full bg-[var(--primary)] text-[#0A0A0A] shadow-[0_0_0_2px_#0A0A0A] ${
                due ? 'w-5 h-5 flex items-center justify-center' : 'w-2.5 h-2.5 anim-dot'
              }`}
            >
              {due && <Bell size={12} strokeWidth={3} className="anim-bell-ring" />}
            </span>
          )}
        </button>

        {onOpenAdmin && (
          <button
            type="button"
            onClick={onOpenAdmin}
            className="glass-pill btn-tactile w-11 h-11 rounded-full text-white/80 hover:text-[var(--primary)] flex items-center justify-center"
            aria-label="Admin Control Panel"
            title={isAr ? 'لوحة التحكم الإدارية' : 'Admin Management'}
          >
            <Settings size={19} />
          </button>
        )}
      </div>
    </motion.div>
  );
};
