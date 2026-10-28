/**
 * Design tokens — single source of truth for colors / fonts / radius.
 * Values mirror `src/styles/base.css :root` (--yellow, --black, ...).
 * To re-skin a client: edit ONLY this file (+ base.css vars). No hex in components for NEW code.
 * Phase 2: codemod legacy `bg-[#FFC400]` → `bg-[var(--yellow)]` etc.
 */
export const themeConfig = {
  colors: {
    primary: '#FFC400',
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
    '--yellow': '#FFC400',
    '--black': '#0A0A0A',
    '--white': '#FFFFFF',
    '--gray-card': '#141414',
    '--gray-border': '#262626',
    '--gray-muted': '#8A8A8A',
  },
} as const;

export type ThemeConfig = typeof themeConfig;
