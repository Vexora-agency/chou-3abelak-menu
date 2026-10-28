/**
 * Feature: menu (public storefront). Public API only — other features import from here, never deep.
 * Existing implementation lives in src/components + src/hooks; re-exported here (no move, no break).
 */
export { MenuList } from '@/src/components/MenuList';
export { FeaturedCarousel } from '@/src/components/FeaturedCarousel';
export { SearchAndChips } from '@/src/components/SearchAndChips';
export { ItemDetailsModal } from '@/src/components/ItemDetailsModal';
export { useMenuLoader } from '@/src/hooks/useMenuLoader';
export { useMenuListFiltering } from '@/src/hooks/useMenuListFiltering';
