import type { FeatureColorId } from '@/src/types/menu';

/** Palette groups shown in the admin picker. General colors are neutral /
 *  organizational; food colors are semantic shortcuts for famous add-ons
 *  (vegetables = green, cheese = yellow, …). Both are admin-only. */
export type FeatureColorGroup = 'general' | 'food';

export interface FeatureColorGroupDef {
  id: FeatureColorGroup;
  label: { en: string; ar: string };
}

export const FEATURE_COLOR_GROUPS: readonly FeatureColorGroupDef[] = [
  { id: 'general', label: { en: 'General colors', ar: 'ألوان عامة' } },
  { id: 'food', label: { en: 'Food colors', ar: 'ألوان الطعام' } },
];

export interface FeatureColorDef {
  id: FeatureColorId;
  group: FeatureColorGroup;
  label: { en: string; ar: string };
  /** Pill surface/text/border colors. The caller adds `border` + padding. */
  pill: string;
  /** Solid swatch background (color picker + section dot). */
  swatch: string;
  /** Check-mark color on the selected swatch. */
  check: string;
  /** Inline border accent for the admin feature list. */
  hex: string;
}

/**
 * Curated, accessible section colors. Every class string is static so the
 * Tailwind scanner keeps it. These colors are ADMIN-ONLY: the customer
 * storefront uses one unified brand color for all additions, while the heat
 * section stays red.
 *
 * Food colors are not enforced anywhere — they are a professional shortcut so
 * an admin can label the Cheese section yellow and the Vegetables section
 * green without picking a raw color.
 */
export const FEATURE_COLORS: readonly FeatureColorDef[] = [
  /* ------------------------------ general ------------------------------ */
  {
    id: 'gold',
    group: 'general',
    label: { en: 'Gold', ar: 'ذهبي' },
    pill: 'bg-[var(--primary)]/10 text-[#8a6d00] border-[var(--primary)]/30 dark:bg-[var(--primary)]/10 dark:text-[var(--primary)] dark:border-[var(--primary)]/30',
    swatch: 'bg-[var(--primary)]',
    check: 'text-[#0A0A0A]',
    hex: '#FFC400',
  },
  {
    id: 'amber',
    group: 'general',
    label: { en: 'Amber', ar: 'كهرماني' },
    pill: 'bg-amber-500/10 text-amber-600 border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-400/30',
    swatch: 'bg-amber-500',
    check: 'text-[#0A0A0A]',
    hex: '#F59E0B',
  },
  {
    id: 'orange',
    group: 'general',
    label: { en: 'Orange', ar: 'برتقالي' },
    pill: 'bg-orange-500/10 text-orange-600 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-400/30',
    swatch: 'bg-orange-500',
    check: 'text-[#0A0A0A]',
    hex: '#F97316',
  },
  {
    id: 'red',
    group: 'general',
    label: { en: 'Red', ar: 'أحمر' },
    pill: 'bg-red-600/10 text-red-600 border-red-600/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-400/30',
    swatch: 'bg-red-600',
    check: 'text-white',
    hex: '#DC2626',
  },
  {
    id: 'rose',
    group: 'general',
    label: { en: 'Rose', ar: 'وردي' },
    pill: 'bg-rose-500/10 text-rose-600 border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-400/30',
    swatch: 'bg-rose-500',
    check: 'text-white',
    hex: '#F43F5E',
  },
  {
    id: 'violet',
    group: 'general',
    label: { en: 'Violet', ar: 'بنفسجي' },
    pill: 'bg-violet-500/10 text-violet-600 border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-400/30',
    swatch: 'bg-violet-500',
    check: 'text-white',
    hex: '#8B5CF6',
  },
  {
    id: 'sky',
    group: 'general',
    label: { en: 'Sky', ar: 'سماوي' },
    pill: 'bg-sky-500/10 text-sky-600 border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-400/30',
    swatch: 'bg-sky-500',
    check: 'text-white',
    hex: '#0EA5E9',
  },
  {
    id: 'emerald',
    group: 'general',
    label: { en: 'Emerald', ar: 'زمردي' },
    pill: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-400/30',
    swatch: 'bg-emerald-500',
    check: 'text-white',
    hex: '#10B981',
  },

  /* -------------------------------- food ------------------------------- */
  {
    id: 'vegetables',
    group: 'food',
    label: { en: 'Vegetables', ar: 'خضار' },
    pill: 'bg-green-500/10 text-green-700 border-green-600/25 dark:bg-green-500/10 dark:text-green-300 dark:border-green-400/30',
    swatch: 'bg-green-600',
    check: 'text-white',
    hex: '#16A34A',
  },
  {
    id: 'cheese',
    group: 'food',
    label: { en: 'Cheese', ar: 'جبنة' },
    pill: 'bg-yellow-400/10 text-yellow-600 border-yellow-500/30 dark:bg-yellow-400/10 dark:text-yellow-300 dark:border-yellow-300/30',
    swatch: 'bg-yellow-400',
    check: 'text-[#0A0A0A]',
    hex: '#FACC15',
  },
  {
    id: 'meat',
    group: 'food',
    label: { en: 'Meat', ar: 'لحمة' },
    pill: 'bg-red-700/10 text-red-700 border-red-700/25 dark:bg-red-500/10 dark:text-red-300 dark:border-red-400/30',
    swatch: 'bg-red-700',
    check: 'text-white',
    hex: '#B91C1C',
  },
  {
    id: 'chicken',
    group: 'food',
    label: { en: 'Chicken', ar: 'فراخ' },
    pill: 'bg-orange-400/10 text-orange-600 border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300 dark:border-orange-300/30',
    swatch: 'bg-orange-400',
    check: 'text-[#0A0A0A]',
    hex: '#FB923C',
  },
  {
    id: 'seafood',
    group: 'food',
    label: { en: 'Seafood', ar: 'بحري' },
    pill: 'bg-cyan-500/10 text-cyan-700 border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-400/30',
    swatch: 'bg-cyan-500',
    check: 'text-white',
    hex: '#06B6D4',
  },
  {
    id: 'sauce',
    group: 'food',
    label: { en: 'Sauce', ar: 'صوص' },
    pill: 'bg-rose-600/10 text-rose-700 border-rose-600/25 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-400/30',
    swatch: 'bg-rose-600',
    check: 'text-white',
    hex: '#E11D48',
  },
  {
    id: 'bread',
    group: 'food',
    label: { en: 'Bread', ar: 'خبز' },
    pill: 'bg-amber-700/10 text-amber-700 border-amber-700/25 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-400/30',
    swatch: 'bg-amber-700',
    check: 'text-white',
    hex: '#B45309',
  },
  {
    id: 'drinks',
    group: 'food',
    label: { en: 'Drinks', ar: 'مشروبات' },
    pill: 'bg-blue-500/10 text-blue-600 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-400/30',
    swatch: 'bg-blue-500',
    check: 'text-white',
    hex: '#3B82F6',
  },
  {
    id: 'dessert',
    group: 'food',
    label: { en: 'Dessert', ar: 'حلويات' },
    pill: 'bg-pink-400/10 text-pink-600 border-pink-500/30 dark:bg-pink-400/10 dark:text-pink-300 dark:border-pink-300/30',
    swatch: 'bg-pink-400',
    check: 'text-[#0A0A0A]',
    hex: '#F472B6',
  },
  {
    id: 'vegan',
    group: 'food',
    label: { en: 'Vegan', ar: 'نباتي' },
    pill: 'bg-lime-500/10 text-lime-700 border-lime-500/25 dark:bg-lime-500/10 dark:text-lime-300 dark:border-lime-400/30',
    swatch: 'bg-lime-500',
    check: 'text-[#0A0A0A]',
    hex: '#84CC16',
  },
  {
    id: 'mushroom',
    group: 'food',
    label: { en: 'Mushroom', ar: 'مشروم' },
    pill: 'bg-stone-500/10 text-stone-600 border-stone-500/25 dark:bg-stone-500/10 dark:text-stone-300 dark:border-stone-400/30',
    swatch: 'bg-stone-500',
    check: 'text-white',
    hex: '#78716C',
  },
  {
    id: 'olive',
    group: 'food',
    label: { en: 'Olive', ar: 'زيتون' },
    pill: 'bg-lime-700/10 text-lime-700 border-lime-700/25 dark:bg-lime-500/10 dark:text-lime-300 dark:border-lime-400/30',
    swatch: 'bg-lime-700',
    check: 'text-white',
    hex: '#4D7C0F',
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

/** Palette entries for one picker row, in curated order. */
export function featureColorsInGroup(group: FeatureColorGroup): FeatureColorDef[] {
  return FEATURE_COLORS.filter((color) => color.group === group);
}

/** Unified customer option pill: active = solid brand gold. */
export const UNIFIED_FEATURE_CHIP_ACTIVE =
  'bg-[var(--primary)] text-[#0A0A0A] border-[var(--primary)] shadow-sm';

/** Unified customer option pill: resting = soft brand-gold tint. */
export const UNIFIED_FEATURE_CHIP_IDLE =
  'bg-[var(--primary)]/10 text-[#8a6d00] border-[var(--primary)]/30 hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/15 dark:bg-[var(--primary)]/10 dark:text-[var(--primary)] dark:border-[var(--primary)]/30 dark:hover:border-[var(--primary)]/60';
