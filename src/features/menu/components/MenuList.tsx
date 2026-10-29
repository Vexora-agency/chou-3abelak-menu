import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { MenuData, MenuItem, Category, CartLine } from '@/src/types/menu';
import type { CardMarkStyleId, ResolvedMark } from '@/src/utils/cardMark';
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

/**
 * Initial items per section before "show more" (text rows are short, cards
 * are tall — one screenful each on a phone). While any filter is active
 * (search / badge / single category) everything shows: collapsing would hide
 * matches. Expanded state is per category and survives re-renders.
 */
const INITIAL_COUNT: Record<'list' | 'compact' | 'cards', number> = {
  list: 12,
  compact: 12,
  cards: 8,
};

interface ShowMoreButtonProps {
  expanded: boolean;
  rest: number;
  isAr: boolean;
  onToggle: () => void;
}

/** On-brand expander: gold-outline pill, rotating chevron, remaining count. */
const ShowMoreButton: React.FC<ShowMoreButtonProps> = ({ expanded, rest, isAr, onToggle }) => (
  <div className="mt-4 flex justify-center">
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="btn-tactile inline-flex items-center gap-2 h-11 px-6 rounded-full border border-[var(--primary)]/50 text-[var(--primary)] text-sm font-extrabold hover:bg-[var(--primary)] hover:text-[#0A0A0A] hover:border-[var(--primary)] transition-colors"
    >
      <span>
        {expanded
          ? (isAr ? 'عرض أقل' : 'Show less')
          : isAr ? `عرض المزيد (${rest})` : `Show more (${rest})`}
      </span>
      <ChevronDown size={16} className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
    </button>
  </div>
);

interface MenuListRowItemProps {
  kind: 'list' | 'compact' | 'cards';
  item: MenuItem;
  index: number;
  menu: MenuData;
  lang: 'en' | 'ar';
  currency: string;
  darkMode: boolean;
  isAr: boolean;
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
  sectionMark: ResolvedMark;
  markStyle: CardMarkStyleId;
  markOpacity: number;
  markX: number;
  markY: number;
  markScale: number;
  markRotate: number;
  totalQtyOf: (item: MenuItem) => number;
}

/** Picks the row component for the section layout (single place, head + tail). */
const MenuListRowItem: React.FC<MenuListRowItemProps> = ({
  kind,
  item,
  index,
  menu,
  lang,
  currency,
  darkMode,
  isAr,
  onAddItem,
  onUpdateLine,
  onOpenItem,
  sectionMark,
  markStyle,
  markOpacity,
  markX,
  markY,
  markScale,
  markRotate,
  totalQtyOf,
}) => {
  const qty = totalQtyOf(item);
  if (kind === 'compact') {
    return (
      <MenuListCompactRow
        item={item}
        index={index}
        menu={menu}
        lang={lang}
        currency={currency}
        darkMode={darkMode}
        isAr={isAr}
        qty={qty}
        onAddItem={onAddItem}
        onUpdateLine={onUpdateLine}
        onOpenItem={onOpenItem}
      />
    );
  }
  if (kind === 'list') {
    return (
      <MenuListListRow
        item={item}
        index={index}
        menu={menu}
        lang={lang}
        currency={currency}
        darkMode={darkMode}
        isAr={isAr}
        qty={qty}
        onAddItem={onAddItem}
        onUpdateLine={onUpdateLine}
        onOpenItem={onOpenItem}
      />
    );
  }
  return (
    <MenuListGridCard
      item={item}
      index={index}
      menu={menu}
      lang={lang}
      currency={currency}
      darkMode={darkMode}
      isAr={isAr}
      qty={qty}
      sectionMark={sectionMark}
      markStyle={markStyle}
      markOpacity={markOpacity}
      markX={markX}
      markY={markY}
      markScale={markScale}
      markRotate={markRotate}
      onAddItem={onAddItem}
      onUpdateLine={onUpdateLine}
      onOpenItem={onOpenItem}
    />
  );
};

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

  // Per-category expansion (collapsed by default). Any active filter shows
  // everything: collapsing would hide matches.
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const filtering = searchQuery.trim() !== '' || selectedBadge !== null || selectedCategory !== 'all';
  const toggleCat = (id: string) =>
    setExpandedCats((prev) => ({ ...prev, [id]: !prev[id] }));

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
        const kind = isCompactSection ? 'compact' : isListSection ? 'list' : 'cards';
        const gridClass =
          kind === 'compact'
            ? 'grid grid-cols-1 md:grid-cols-2 gap-x-10'
            : kind === 'list'
              ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-10 gap-y-4'
              : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4 md:gap-5';
        const limit = INITIAL_COUNT[kind];
        const expanded = !!expandedCats[cat.id];
        // Split grids (same classes, so column flow continues seamlessly):
        // the head always renders; the tail lives in a 0fr→1fr animated
        // wrapper, inert + unfocusable while collapsed. Filtering (or a short
        // section) renders one plain grid with no button.
        const collapsible = !filtering && catItems.length > limit;
        const head = collapsible ? catItems.slice(0, limit) : catItems;
        const tail = collapsible ? catItems.slice(limit) : [];
        const rowCtx: Omit<MenuListRowItemProps, 'item' | 'index'> = {
          kind,
          menu,
          lang,
          currency,
          darkMode,
          isAr,
          onAddItem,
          onUpdateLine,
          onOpenItem,
          sectionMark: SectionMark,
          markStyle,
          markOpacity: markOpa,
          markX: markPos.x,
          markY: markPos.y,
          markScale,
          markRotate: markRot,
          totalQtyOf,
        };
        const tailWrap = (
          <div
            className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            inert={!expanded}
          >
            <div
              className={`overflow-hidden min-h-0 transition-opacity duration-500 ${expanded ? 'opacity-100' : 'opacity-0'}`}
            >
              <div className={gridClass}>
                {tail.map((item, i) => (
                  <MenuListRowItem
                    key={item.id}
                    item={item}
                    index={i + head.length}
                    {...rowCtx}
                  />
                ))}
              </div>
            </div>
          </div>
        );
        const moreButton = collapsible ? (
          <ShowMoreButton
            expanded={expanded}
            rest={tail.length}
            isAr={isAr}
            onToggle={() => toggleCat(cat.id)}
          />
        ) : null;
        return (
          <section key={cat.id} id={`category-${cat.id}`} className="scroll-mt-16 menu-section">
            {/* Category Header */}
            <MenuListSectionHeader title={isAr ? cat.name.ar : cat.name.en} darkMode={darkMode} count={catItems.length} />
            {/* Compact rows: dense single-line rows with smooth reflow on filter */}
            {isCompactSection ? (
              <>
                <div className={gridClass}>
                  {head.map((item, idx) => (
                    <MenuListRowItem key={item.id} item={item} index={idx} {...rowCtx} />
                  ))}
                </div>
                {tailWrap}
                {moreButton}
              </>
            ) : (
            /* List View for text-first sections: 1-col on mobile, 2-col on
               tablet/desktop */
            isListSection ? (
              <>
                <div className={gridClass}>
                  {head.map((item, idx) => (
                    <MenuListRowItem key={item.id} item={item} index={idx} {...rowCtx} />
                  ))}
                </div>
                {tailWrap}
                {moreButton}
              </>
            ) : (
              /* Grid View for Sides, Drinks, etc. (2-col mobile, 3-col tablet, 4-col desktop).
                 Equal heights (stretch): prices align across the row; bare
                 cards keep full size via the glyph slot below, never a void. */
              <>
                <div className={gridClass}>
                  {head.map((item, idx) => (
                    <MenuListRowItem key={item.id} item={item} index={idx} {...rowCtx} />
                  ))}
                </div>
                {tailWrap}
                {moreButton}
              </>
            ))}
          </section>
        );
      })}
    </div>
  );
};
