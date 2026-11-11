/**
 * Feature: menu (public storefront). Public API only — other features and
 * App.tsx import from here, never from ./components or ./hooks directly.
 */
export { MenuList } from './components/MenuList';
export { FeaturedCarousel } from './components/FeaturedCarousel';
export { SearchAndChips } from './components/SearchAndChips';
// NOTE: ItemDetailsModal is intentionally NOT re-exported here — App.tsx
// imports it directly (lazy) so it splits into its own chunk instead of
// riding the main bundle through this barrel.
export { useMenuLoader } from './hooks/useMenuLoader';
export { useMenuListFiltering } from './hooks/useMenuListFiltering';
export { useMenuListCartQuantities } from './hooks/useMenuListCartQuantities';
