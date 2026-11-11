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
 * Owner decision: festive effects play for EVERYONE while the theme is on —
 * no prefers-reduced-motion / save-data auto-hiding (the dashboard toggle
 * is the single on/off switch).
 */
export const SeasonalEffects: React.FC<SeasonalEffectsProps> = ({ theme, lang }) => {
  if (theme === 'off') return null;
  const def = SEASONAL_REGISTRY[theme];
  if (!def) return null;

  const Effect = def.Effect;
  return (
    <>
      <Effect />
      <SeasonGreeting theme={theme} lang={lang} />
    </>
  );
};
