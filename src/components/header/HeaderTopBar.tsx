import React from 'react';
import { Moon, Settings, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import type { useHeaderMotion } from '@/src/hooks/useHeaderMotion';

interface HeaderTopBarProps {
  lang: 'en' | 'ar';
  onToggleLang: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAdmin?: () => void;
  rise: ReturnType<typeof useHeaderMotion>['rise'];
}

export const HeaderTopBar: React.FC<HeaderTopBarProps> = ({
  lang,
  onToggleLang,
  darkMode,
  onToggleDarkMode,
  onOpenAdmin,
  rise,
}) => {
  const isAr = lang === 'ar';

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
              className={`relative min-w-[48px] h-9 px-3 rounded-full text-xs font-bold transition-colors ${
                active ? 'text-[#0A0A0A]' : 'text-white/75 hover:text-white'
              }`}
              aria-label={code === 'en' ? 'Switch to English' : 'التبديل إلى العربية'}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="lang-pill"
                  className="absolute inset-0 rounded-full bg-[#FFC400] shadow-[0_4px_14px_-2px_rgba(255,196,0,0.6)]"
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
          className="glass-pill btn-tactile w-11 h-11 rounded-full text-[#FFC400] flex items-center justify-center"
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

        {onOpenAdmin && (
          <button
            type="button"
            onClick={onOpenAdmin}
            className="glass-pill btn-tactile w-11 h-11 rounded-full text-white/80 hover:text-[#FFC400] flex items-center justify-center"
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
