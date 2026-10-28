/**
 * Feature: menu (public storefront). Public API only — other features and
 * App.tsx import from here, never from ./components or ./hooks directly.
 */
export { MenuList } from './components/MenuList';
export { FeaturedCarousel } from './components/FeaturedCarousel';
export { SearchAndChips } from './components/SearchAndChips';
export { ItemDetailsModal } from './components/ItemDetailsModal';
export { useMenuLoader } from './hooks/useMenuLoader';
export { useMenuListFiltering } from './hooks/useMenuListFiltering';
export { useMenuListCartQuantities } from './hooks/useMenuListCartQuantities';
