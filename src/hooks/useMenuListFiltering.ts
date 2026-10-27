import type { MenuData, MenuItem } from '@/src/types/menu';
import { effectiveBadges } from '@/src/utils/pricing';

export function useMenuListFiltering(
  items: MenuItem[],
  menu: MenuData,
  selectedCategory: string,
  searchQuery: string,
  selectedBadge: string | null,
): MenuItem[] {
  const cleanQ = searchQuery.trim().toLowerCase();

  // Filter items
  const filteredItems = items.filter((item) => {
    const matchesCategory = selectedCategory === 'all' || item.categoryId === selectedCategory;
    if (!matchesCategory) return false;

    // Badge quick-filter (single-select) — uses effective badges (auto NEW included)
    if (selectedBadge && !effectiveBadges(menu, item).includes(selectedBadge)) return false;

    if (!cleanQ) return true;
    const nameMatch =
      item.name.en.toLowerCase().includes(cleanQ) ||
      item.name.ar.toLowerCase().includes(cleanQ);
    const descMatch =
      item.description.en.toLowerCase().includes(cleanQ) ||
      item.description.ar.toLowerCase().includes(cleanQ);

    return nameMatch || descMatch;
  });

  return filteredItems;
}
