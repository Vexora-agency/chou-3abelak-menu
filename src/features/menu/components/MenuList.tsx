import React, { useState } from 'react';
import { AnimatePresence } from 'motion/react';
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
 * Batched reveal: long sections show `initial` items, then `batch` more per
 * tap (both admin-tunable in Settings → Section Show-More, 4..50). The button
 * appears only when the rest is worth a tap (> MIN_REST): a "show more (2)"
 * button is sillier than just showing the two.
 * While any filter is active everything shows — collapsing would hide matches.
 */
const MIN_REST = 4;

interface ShowMoreButtonProps {
  expanded: boolean;
  /** Next-batch size (more) — unused for less. */
  count: number;
  isAr: boolean;
  onToggle: () => void;
}

/** On-brand pager button: gold-outline pill, rotating chevron, batch count. */
const ShowMoreButton: React.FC<ShowMoreButtonProps> = ({ expanded, count, isAr, onToggle }) => (
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
          : isAr ? `عرض المزيد (${count})` : `Show more (${count})`}
      </span>
      <ChevronDown size={16} className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
    </button>
  </div>
);

interface MenuListRowItemProps {
  kind: 'list' | 'compact' | 'cards';
  item: MenuItem;
  index: number;
  /** Reverse-cascade exit delay, computed from the bottom (collapse order). */
  exitDelay?: number;
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
  exitDelay,
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
        exitDelay={exitDelay}
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
        exitDelay={exitDelay}
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
      exitDelay={exitDelay}
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

  // Per-category visible counts (absent = initial). Any active filter shows
  // everything: collapsing would hide matches.
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  // Stepping-back mode: once "less" starts at the end, the button STAYS
  // "less" through every stage back to the start (never morphs mid-way).
  const [steppingBack, setSteppingBack] = useState<Record<string, boolean>>({});
  const filtering = searchQuery.trim() !== '' || selectedBadge !== null || selectedCategory !== 'all';
  const smRaw = (menu.settings as { showMore?: { initial?: unknown; batch?: unknown } }).showMore || {};
  const intOr = (v: unknown, fb: number) =>
    Number.isInteger(v) && (v as number) >= 4 && (v as number) <= 50 ? (v as number) : fb;
  const initial = intOr(smRaw.initial, 12);
  const batch = intOr(smRaw.batch, 8);

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
        const total = catItems.length;
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
        // One stable grid whose window grows by batches: new items mount fresh
        // with their entrance animation, nothing already on screen moves — so
        // no layout-measurement overlap is possible (unlike mounting inside an
        // animating container). Collapsing snaps shut, masked by scrolling the
        // header back into view — otherwise the user is stranded at the bottom
        // of a suddenly shorter page.
        const collapsible = !filtering && total > initial + MIN_REST;
        const visible = collapsible ? Math.min(total, visibleCounts[cat.id] ?? initial) : total;
        const hasMore = collapsible && visible < total;
        // Stepped collapse: "less" goes back one batch per tap (never jumps
        // straight to the start), mirroring "more".
        const pastStart = collapsible && visible > initial;
        const more = () => {
          setSteppingBack((prev) => {
            if (!prev[cat.id]) return prev;
            const next = { ...prev };
            delete next[cat.id];
            return next;
          });
          setVisibleCounts((prev) => ({ ...prev, [cat.id]: Math.min(total, (prev[cat.id] ?? initial) + batch) }));
        };
        const less = () => {
          const landing = visible - batch <= initial;
          if (landing) {
            setVisibleCounts((prev) => {
              const next = { ...prev };
              delete next[cat.id];
              return next;
            });
            setSteppingBack((prev) => {
              if (!prev[cat.id]) return prev;
              const next = { ...prev };
              delete next[cat.id];
              return next;
            });
          } else {
            setVisibleCounts((prev) => ({ ...prev, [cat.id]: visible - batch }));
            setSteppingBack((prev) => ({ ...prev, [cat.id]: true }));
          }
          // Scroll home only on landing back at the start (slightly delayed so
          // the fade cascade and the glide overlap instead of queueing);
          // mid-way steps keep the viewport where the finger is.
          if (landing) {
            window.setTimeout(() => {
              document.getElementById(`category-${cat.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 150);
          }
        };
        // One morphing button: "more" (remaining count) until the end, then
        // ONLY "less" — which keeps stepping back through every stage (the
        // button never morphs mid-way back).
        const pagerButton = collapsible ? (
          hasMore && !steppingBack[cat.id] ? (
            <ShowMoreButton
              expanded={false}
              // Remaining count (shrinks every tap: 50 → 42 → 34 …).
              count={total - visible}
              isAr={isAr}
              onToggle={more}
            />
          ) : pastStart ? (
            <ShowMoreButton expanded isAr={isAr} count={0} onToggle={less} />
          ) : null
        ) : null;
        const visibleItems = catItems.slice(0, visible);
        // Reverse-cascade exits (bottom-up) run inside AnimatePresence;
        // initial={false} so first mount keeps the scroll entrances only.
        const itemsGrid = (
          <div className={gridClass}>
            <AnimatePresence initial={false}>
              {visibleItems.map((item, idx) => (
                <MenuListRowItem
                  key={item.id}
                  item={item}
                  index={idx}
                  exitDelay={Math.min(Math.max(0, visible - 1 - idx) * 0.006, 0.3)}
                  {...rowCtx}
                />
              ))}
            </AnimatePresence>
          </div>
        );
        return (
          <section key={cat.id} id={`category-${cat.id}`} className="scroll-mt-16 menu-section">
            {/* Category Header */}
            <MenuListSectionHeader title={isAr ? cat.name.ar : cat.name.en} darkMode={darkMode} count={catItems.length} />
            {/* One grid per section: compact/list/cards differ only by the
                grid classes and the row component, both resolved above. */}
            {itemsGrid}
            {pagerButton}
          </section>
        );
      })}
    </div>
  );
};
