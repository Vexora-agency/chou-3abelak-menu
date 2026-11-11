import { useEffect, useState } from 'react';
import type { SeasonalTheme } from '@/src/types/menu';
import { SEASONAL_REGISTRY } from './themes';
import { SeasonGreeting } from './SeasonGreeting';

interface SeasonalEffectsProps {
  theme: SeasonalTheme;
  lang: 'en' | 'ar';
}

/**
 * Customer storefront seasonal layer. Renders nothing at all when the theme
 * is `off` (or unknown — the registry lookup misses, same path).
 *
 * Restraint rules (the effect must never annoy or cost):
 * - `prefers-reduced-motion: reduce` → the animated effect is hidden
 *   (the greeting card is static and stays — owner decision parity).
 * - Data-saver (`navigator.connection.saveData`) → the effect is hidden
 *   (no animation frames on a metered connection); greeting stays.
 */
export const SeasonalEffects: React.FC<SeasonalEffectsProps> = ({ theme, lang }) => {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [saveData, setSaveData] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    setReduceMotion(!!mq?.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq?.addEventListener?.('change', onChange);
    try {
      const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      setSaveData(conn?.saveData === true);
    } catch {
      // connection API absent — treat as no saver.
    }
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);

  if (theme === 'off') return null;
  const def = SEASONAL_REGISTRY[theme];
  if (!def) return null;

  const Effect = def.Effect;
  const calm = reduceMotion || saveData;
  return (
    <>
      {!calm && <Effect />}
      <SeasonGreeting theme={theme} lang={lang} />
    </>
  );
};
