/**
 * Allowed feature-section colors (admin-only metadata).
 *
 * Keep this list in sync with `src/utils/featureColors.ts`. The customer
 * storefront ignores the value and keeps one unified brand color; the heat
 * section stays red.
 */
export const FEATURE_COLOR_IDS = new Set([
  'gold',
  'amber',
  'orange',
  'red',
  'rose',
  'violet',
  'sky',
  'emerald',
  // Food-semantic colors for famous add-ons.
  'vegetables',
  'cheese',
  'meat',
  'chicken',
  'seafood',
  'sauce',
  'bread',
  'drinks',
  'dessert',
  'vegan',
  'mushroom',
  'olive',
]);

/** Trim/validate a section color. Invalid/absent -> undefined (optional). */
export function normalizeFeatureColor(value) {
  return typeof value === 'string' && FEATURE_COLOR_IDS.has(value) ? value : undefined;
}
