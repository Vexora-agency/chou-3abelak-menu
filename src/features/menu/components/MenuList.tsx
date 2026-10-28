import React from 'react';
import { MenuData, MenuItem, Category, CartLine } from '@/src/types/menu';
import { resolveCategoryMark, parseMarkStyle, markOpacity01, markPosition, markScale01, markRotate } from '@/src/utils/cardMark';
import { useMenuListFiltering } from '../hooks/useMenuListFiltering';
import { useMenuListCartQuantities } from '../hooks/useMenuListCartQuantities';
import { MenuListEmptyState } from './menu-list/MenuListEmptyState';
import { MenuListSectionHeader } from './menu-list/MenuListCompactRow';
import { MenuListCompactRow } from './menu-list/MenuListCompactRow';
import { MenuListListRow } from './menu-list/MenuListListRow';
import { MenuListGridCard } from './menu-list/MenuListGridCard';

interface MenuListProps {
  categories: Category[];
  items: MenuItem[];
  menu: MenuData;  selectedCategory: string;
  searchQuery: string;
  selectedBadge: string | null;
  cart: Record<string, CartLine>;
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

// (Category watermark rendering lives in ./CardMark — shared with admin.)

export const MenuList: React.FC<MenuListProps> = ({
  categories,
  items,
  menu,
  selectedCategory,
  searchQuery,
  selectedBadge,
  cart,
  onAddItem,
  onUpdateLine,
  onOpenItem,
  currency,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';

  const filteredItems = useMenuListFiltering(items, menu, selectedCategory, searchQuery, selectedBadge);

  const { totalQtyOf } = useMenuListCartQuantities(cart);

  if (filteredItems.length === 0) {
    return <MenuListEmptyState darkMode={darkMode} isAr={isAr} />;
  }

  // Get visible categories that have items in filtered list
  const activeCategoryIds = Array.from(new Set(filteredItems.map((i) => i.categoryId)));
  const visibleCats = categories.filter((c) => c.visible && activeCategoryIds.includes(c.id));

  return (
    <div className="px-5 sm:px-8 pb-12 space-y-7 max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full">
      {visibleCats.map((cat) => {
        const catItems = filteredItems.filter((i) => i.categoryId === cat.id);
        const layout = cat.layout || (cat.id === 'manakish' ? 'list' : 'cards');
        const isListSection = layout === 'list';
        const isCompactSection = layout === 'compact';
        // Cards: watermark is opt-in only. Categories without an explicit
        // icon render exactly like the original clean cards (no mark,
        // no reserved space, no clipping).
        const SectionMark = resolveCategoryMark(cat.icon, cat.iconUrl);
        const markStyle = parseMarkStyle(cat.iconStyle);
        const markOpa = markOpacity01(cat.iconOpacity);
        const markPos = markPosition(cat.iconX, cat.iconY, markStyle);
        const markScale = markScale01(cat.iconScale);
        const markRot = markRotate(cat.iconRotate);
        return (
          <section key={cat.id} id={`category-${cat.id}`} className="scroll-mt-16 menu-section">
            {/* Category Header */}
            <MenuListSectionHeader title={isAr ? cat.name.ar : cat.name.en} darkMode={darkMode} />
            {/* Compact rows: dense single-line rows with smooth reflow on filter */}
            {isCompactSection ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
                {catItems.map((item, idx) => (
                  <MenuListCompactRow
                    key={item.id}
                    item={item}
                    index={idx}
                    menu={menu}
                    lang={lang}
                    currency={currency}
                    darkMode={darkMode}
                    isAr={isAr}
                    qty={totalQtyOf(item)}
                    onAddItem={onAddItem}
                    onUpdateLine={onUpdateLine}
                    onOpenItem={onOpenItem}
                  />
                ))}
              </div>
            ) : (
            /* List View for text-first sections: 1-col on mobile, 2-col on
               tablet/desktop */
            isListSection ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-10 gap-y-4">
                {catItems.map((item, idx) => (
                  <MenuListListRow
                    key={item.id}
                    item={item}
                    index={idx}
                    menu={menu}
                    lang={lang}
                    currency={currency}
                    darkMode={darkMode}
                    isAr={isAr}
                    qty={totalQtyOf(item)}
                    onAddItem={onAddItem}
                    onUpdateLine={onUpdateLine}
                    onOpenItem={onOpenItem}
                  />
                ))}
              </div>
            ) : (
              /* Grid View for Sides, Drinks, etc. (2-col mobile, 3-col tablet, 4-col desktop).
                 Equal heights (stretch): prices align across the row; bare
                 cards keep full size via the glyph slot below, never a void. */
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4 md:gap-5">
                {catItems.map((item, idx) => (
                  <MenuListGridCard
                    key={item.id}
                    item={item}
                    index={idx}
                    menu={menu}
                    lang={lang}
                    currency={currency}
                    darkMode={darkMode}
                    isAr={isAr}
                    qty={totalQtyOf(item)}
                    sectionMark={SectionMark}
                    markStyle={markStyle}
                    markOpacity={markOpa}
                    markX={markPos.x}
                    markY={markPos.y}
                    markScale={markScale}
                    markRotate={markRot}
                    onAddItem={onAddItem}
                    onUpdateLine={onUpdateLine}
                    onOpenItem={onOpenItem}
                  />
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
};
