import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { STR } from './loginStrings';
import type { LoginLang, LoginStrings } from './loginStrings';

export interface RiseFn {
  (delay: number): {
    initial: false | { opacity: number; y: number };
    animate: { opacity: number; y: number };
    transition: { duration: number; delay: number; ease: readonly [number, number, number, number] };
  };
}

interface LoginTopBarProps {
  t: LoginStrings;
  lang: LoginLang;
  onBack: () => void;
  onToggleLang: () => void;
  rise: RiseFn;
}

export function LoginTopBar({ t, lang, onBack, onToggleLang, rise }: LoginTopBarProps): React.JSX.Element {
  return (
    <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 sm:px-8 pt-4 sm:pt-6">
      <motion.button
        {...rise(0.1)}
        type="button"
        onClick={onBack}
        className="glass-pill btn-tactile h-11 ps-3.5 pe-4 rounded-full inline-flex items-center gap-2 text-sm font-semibold text-white/85 hover:text-white"
      >
        <ArrowLeft size={17} className="rtl:rotate-180" aria-hidden="true" />
        <span>{t.back}</span>
      </motion.button>

      <motion.div {...rise(0.15)} className="glass-pill flex p-1 rounded-full">
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
              aria-label={code === 'en' ? STR.en.switchTo : STR.ar.switchTo}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="login-lang-pill"
                  className="absolute inset-0 rounded-full bg-[var(--primary)] shadow-[0_4px_14px_-2px_color-mix(in_srgb,var(--primary)_60%,transparent)]"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative z-10">{code === 'en' ? 'EN' : 'عربي'}</span>
            </button>
          );
        })}
      </motion.div>
    </div>
  );
}
