/**
 * Design tokens — single source of truth for colors / fonts / radius.
 * Values mirror `src/styles/base.css :root` (--primary, --black, ...).
 * To re-skin a client: edit ONLY the `primary` value here — applyTheme() pushes
 * it to `:root`, and every component reads it via `var(--primary)`.
 * No hex in components (Phase 2 codemod complete); legacy `--yellow` kept for compat.
 */
export const themeConfig = {
  colors: {
    primary: '#FFC400',
    primaryForeground: '#0A0A0A',
    background: '#0A0A0A',
    surface: '#141414',
    border: '#262626',
    muted: '#8A8A8A',
    white: '#FFFFFF',
    goldDark: '#8a6d00',
  },
  fontFamily: {
    latin: 'Poppins, system-ui, -apple-system, sans-serif',
    arabic: "Cairo, Poppins, system-ui, -apple-system, sans-serif",
  },
  radius: '0.75rem',
  cssVars: {
    '--primary': '#FFC400',
    '--primary-foreground': '#0A0A0A',
    '--yellow': '#FFC400',
    '--black': '#0A0A0A',
    '--white': '#FFFFFF',
    '--gray-card': '#141414',
    '--gray-border': '#262626',
    '--gray-muted': '#8A8A8A',
  },
} as const;

export type ThemeConfig = typeof themeConfig;

/**
 * Push the theme tokens onto `:root` so `var(--primary)` always reflects
 * themeConfig. Called once at startup (main.tsx). Guarded for non-DOM envs.
 */
export function applyTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeConfig.cssVars)) {
    root.style.setProperty(name, value);
  }
}
