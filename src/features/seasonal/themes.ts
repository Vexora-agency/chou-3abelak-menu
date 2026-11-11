/**
 * Seasonal theme registry — the single place a future season is added.
 *
 * To add a season (e.g. ramadan, halloween):
 *  1. extend `SeasonalTheme` in `src/types/menu.ts`,
 *  2. add the id to SEASONAL_THEMES + seasonalThemeOrDefault
 *     (`src/utils/settingsDefaults.ts`) and to the server twin
 *     (`functions/_shared/validate-settings.js`),
 *  3. add an entry below (id, bilingual name, greeting copy, effect component).
 *
 * Everything else (settings plumbing, admin toggle, customer mount,
 * once-per-theme greeting) keys off this registry — no other file needs
 * a per-theme branch.
 */
import type { ComponentType } from 'react';
import type { SeasonalTheme } from '@/src/types/menu';
import { ChristmasSnow } from './ChristmasSnow';

export interface SeasonalThemeDef {
  /** Stable id — also the localStorage greeting key suffix. */
  id: Exclude<SeasonalTheme, 'off'>;
  name: { en: string; ar: string };
  /** One-line greeting card copy shown once per theme. */
  greeting: {
    title: { en: string; ar: string };
    /** Small print under the title (season-only notice). */
    note: { en: string; ar: string };
  };
  /** Full-screen effect rendered behind the greeting (snow, …). */
  Effect: ComponentType;
}

/**
 * Active-theme registry (`off` carries no entry — SeasonalEffects renders
 * nothing for it). Greeting copy lives here so the admin preview and the
 * customer card can never disagree.
 */
export const SEASONAL_REGISTRY: Record<Exclude<SeasonalTheme, 'off'>, SeasonalThemeDef> = {
  christmas: {
    id: 'christmas',
    name: { en: 'Christmas', ar: 'عيد الميلاد' },
    greeting: {
      title: { en: '🎄 Christmas is here!', ar: '🎄 حلّ عيد الميلاد!' },
      note: {
        en: 'This shows in festive seasons only',
        ar: 'يظهر هذا في المواسم فقط',
      },
    },
    Effect: ChristmasSnow,
  },
};

/** localStorage key — the greeting shows once per theme, then never again. */
export function seasonGreetingKey(theme: Exclude<SeasonalTheme, 'off'>): string {
  return `season_greeted_${theme}`;
}
