import type { FeatureColorId } from '@/src/types/menu';

export interface FeatureColorDef {
  id: FeatureColorId;
  /** Pill surface/text/border colors. The caller adds `border` + padding. */
  pill: string;
  /** Always-dark pill styling for admin-only surfaces (orders dashboard). */
  adminPill: string;
  /** Solid swatch background (color picker + section dot). */
  swatch: string;
  /** Check-mark color on the selected swatch. */
  check: string;
  /** Inline border accent for the admin feature list. */
  hex: string;
}

/**
 * Curated, accessible library colors. Every class string is static so the
 * Tailwind scanner keeps it. These colors are ADMIN-ONLY: the customer
 * storefront uses one unified brand color for all additions, while the heat
 * section stays red.
 *
 * Swatches intentionally carry no color names in the UI — the admin sees the
 * colors themselves. A generic numbered aria-label keeps the picker usable
 * with a screen reader.
 */
export const FEATURE_COLORS: readonly FeatureColorDef[] = [
  {
    id: 'gold',
    pill: 'bg-[var(--primary)]/10 text-[#8a6d00] border-[var(--primary)]/30 dark:bg-[var(--primary)]/10 dark:text-[var(--primary)] dark:border-[var(--primary)]/30',
    adminPill: 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/30',
    swatch: 'bg-[var(--primary)]',
    check: 'text-[#0A0A0A]',
    hex: '#FFC400',
  },
  {
    id: 'amber',
    pill: 'bg-amber-500/10 text-amber-600 border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-400/30',
    adminPill: 'bg-amber-500/10 text-amber-300 border-amber-400/30',
    swatch: 'bg-amber-500',
    check: 'text-[#0A0A0A]',
    hex: '#F59E0B',
  },
  {
    id: 'orange',
    pill: 'bg-orange-500/10 text-orange-600 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-400/30',
    adminPill: 'bg-orange-500/10 text-orange-300 border-orange-400/30',
    swatch: 'bg-orange-500',
    check: 'text-[#0A0A0A]',
    hex: '#F97316',
  },
  {
    id: 'red',
    pill: 'bg-red-600/10 text-red-600 border-red-600/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-400/30',
    adminPill: 'bg-red-500/10 text-red-300 border-red-400/30',
    swatch: 'bg-red-600',
    check: 'text-white',
    hex: '#DC2626',
  },
  {
    id: 'rose',
    pill: 'bg-rose-500/10 text-rose-600 border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-400/30',
    adminPill: 'bg-rose-500/10 text-rose-300 border-rose-400/30',
    swatch: 'bg-rose-500',
    check: 'text-white',
    hex: '#F43F5E',
  },
  {
    id: 'violet',
    pill: 'bg-violet-500/10 text-violet-600 border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-400/30',
    adminPill: 'bg-violet-500/10 text-violet-300 border-violet-400/30',
    swatch: 'bg-violet-500',
    check: 'text-white',
    hex: '#8B5CF6',
  },
  {
    id: 'sky',
    pill: 'bg-sky-500/10 text-sky-600 border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-400/30',
    adminPill: 'bg-sky-500/10 text-sky-300 border-sky-400/30',
    swatch: 'bg-sky-500',
    check: 'text-white',
    hex: '#0EA5E9',
  },
  {
    id: 'emerald',
    pill: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-400/30',
    adminPill: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30',
    swatch: 'bg-emerald-500',
    check: 'text-white',
    hex: '#10B981',
  },
];

const FEATURE_COLOR_BY_ID = new Map<string, FeatureColorDef>(
  FEATURE_COLORS.map((color) => [color.id, color]),
);

export function featureColorDef(id: string | null | undefined): FeatureColorDef | null {
  return id ? FEATURE_COLOR_BY_ID.get(id) || null : null;
}

export function isFeatureColorId(value: unknown): value is FeatureColorId {
  return typeof value === 'string' && FEATURE_COLOR_BY_ID.has(value);
}

/** Unified customer option pill: active = solid brand gold. */
export const UNIFIED_FEATURE_CHIP_ACTIVE =
  'bg-[var(--primary)] text-[#0A0A0A] border-[var(--primary)] shadow-sm';

/** Customer option pill: resting = plain white (light) / neutral (dark). */
export const UNIFIED_FEATURE_CHIP_IDLE =
  'bg-white text-neutral-800 border-neutral-300 hover:border-[#0A0A0A] hover:bg-neutral-50 dark:bg-transparent dark:text-neutral-200 dark:border-neutral-700 dark:hover:border-[var(--primary)] dark:hover:bg-white/5';
