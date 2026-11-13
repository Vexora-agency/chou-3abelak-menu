import React from 'react';
import { Moon, Settings, Sun, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import type { useHeaderMotion } from '@/src/hooks/useHeaderMotion';
import { CustomerAvatar, useCustomerSession } from '@/src/features/auth';

interface HeaderTopBarProps {
  lang: 'en' | 'ar';
  onToggleLang: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAdmin?: () => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  rise: ReturnType<typeof useHeaderMotion>['rise'];
}

export const HeaderTopBar: React.FC<HeaderTopBarProps> = ({
  lang,
  onToggleLang,
  darkMode,
  onToggleDarkMode,
  onOpenAdmin,
  onOpenAuth,
  onOpenAccount,
  rise,
}) => {
  const isAr = lang === 'ar';
  const { user, isPending } = useCustomerSession();
  const firstName = user?.name?.trim().split(/\s+/)[0] || user?.email?.split('@')[0] || '';

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
          aria-label={isPending ? (isAr ? 'جارٍ تحميل الحساب' : 'Loading account') : user ? (isAr ? 'حسابي' : 'My account') : (isAr ? 'تسجيل الدخول' : 'Sign in')}
          title={isPending ? undefined : user ? (isAr ? 'حسابي وطلباتي' : 'My account and orders') : (isAr ? 'تسجيل الدخول' : 'Sign in')}
          className="glass-pill btn-tactile h-11 min-h-[44px] w-11 sm:w-auto sm:px-3 rounded-full text-[var(--primary)] flex items-center justify-center gap-2 shrink-0 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
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
