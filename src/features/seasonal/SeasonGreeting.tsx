import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { SeasonalTheme } from '@/src/types/menu';
import { SEASONAL_REGISTRY, seasonGreetingKey } from './themes';
import { greetSeasonOnce } from './confetti';

interface SeasonGreetingProps {
  theme: Exclude<SeasonalTheme, 'off'>;
  lang: 'en' | 'ar';
}

/**
 * One-time seasonal greeting card. Shows once per theme per device
 * (localStorage `season_greeted_<theme>`), dismissed with the close button.
 *
 * Stacking: `z-40` — above the snow canvas (`z-[30]`), below drawers and
 * modals (`z-50`), so it can never trap a checkout flow.
 */
export const SeasonGreeting: React.FC<SeasonGreetingProps> = ({ theme, lang }) => {
  const def = SEASONAL_REGISTRY[theme];
  const [visible, setVisible] = useState(false);
  // One gentle confetti pop per theme at first appearance (StrictMode-safe).
  // Stays silent under reduced-motion / data-saver (guarded inside).
  const greetedRef = useRef<Exclude<SeasonalTheme, 'off'> | null>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(seasonGreetingKey(theme))) return;
    } catch {
      return;
    }
    setVisible(true);
    if (greetedRef.current !== theme) {
      greetedRef.current = theme;
      greetSeasonOnce();
    }
  }, [theme]);

  if (!def || !visible) return null;
  const isAr = lang === 'ar';

  const dismiss = () => {
    try {
      window.localStorage.setItem(seasonGreetingKey(theme), '1');
    } catch {
      // Private mode: the card simply reappears next visit — harmless.
    }
    setVisible(false);
  };

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl border border-white/15 bg-[#101828]/95 px-4 py-3 shadow-2xl backdrop-blur">
        <span aria-hidden="true" className="text-2xl leading-none">
          🎄
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-sm font-extrabold text-white">
            {isAr ? def.greeting.title.ar : def.greeting.title.en}
          </b>
          <span className="mt-0.5 block text-[11px] font-bold text-neutral-400">
            {isAr ? def.greeting.note.ar : def.greeting.note.en}
          </span>
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label={isAr ? 'إغلاق' : 'Dismiss'}
          className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};
