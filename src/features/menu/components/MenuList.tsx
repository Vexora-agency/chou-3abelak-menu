import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
import { MenuListPhotoCard } from './menu-list/MenuListPhotoCard';
import { MenuListRoundCard } from './menu-list/MenuListRoundCard';
import { scrollToElementId } from '@/src/lib/motion/smoothScroll';

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
  /** Menu-only mode (starter): hides ordering UI, rows are not clickable. */
  orderingEnabled?: boolean;
  /** Christmas accents on. Defaults to the seasonal theme in settings
      (`settings.seasonal.theme === 'christmas'`); pass explicitly to
      override (e.g. admin previews). */
  festive?: boolean;
}

// (Category watermark rendering lives in ./CardMark — shared with admin.)

/**
 * Batched reveal: long sections show `initial` items, then `batch` more per
 * tap (both admin-tunable in Settings → Section Show-More, 4..50). The button
 * appears only when the rest is worth a tap (> MIN_REST): a "show more (2)"
 * button is sillier than just showing the two. The same rule applies after
 * every expansion — a batch that would leave a 1..MIN_REST orphan folds that
 * tail into the window instead of paging again.
 * While any filter is active everything shows — collapsing would hide matches.
 * Wide screens snap both numbers UP to full grid rows (12 initial on a 5-col
 * desktop grid would leave an orphan pair + 3 empty slots; 15 fills 3 rows),
 * so the pager count never sits under visibly empty space.
 */
const MIN_REST = 4;

/**
 * Live column count of a section grid, mirroring the Tailwind breakpoints in
 * `gridClass` below (sm:640 md:768 lg:1024 xl:1280). Re-evaluates on resize
 * so rotating/resizing re-snaps the visible window to full rows.
 */
function useGridCols(kind: 'list' | 'compact' | 'cards' | 'photos' | 'round'): number {
  const get = () => {
    if (typeof window === 'undefined' || !window.matchMedia) return kind === 'cards' || kind === 'photos' || kind === 'round' ? 2 : 1;
    const mq = (min: number) => window.matchMedia(`(min-width: ${min}px)`).matches;
    if (kind === 'cards') return mq(1280) ? 5 : mq(1024) ? 4 : mq(640) ? 3 : 2;
    // Round sections go full-bleed and dense: more compact columns fill
    // the viewport width professionally.
    if (kind === 'round') return mq(1280) ? 8 : mq(1024) ? 6 : mq(640) ? 4 : 2;
    if (kind === 'photos') return mq(1280) ? 4 : mq(1024) ? 3 : 2;
    if (kind === 'list') return mq(1280) ? 3 : mq(768) ? 2 : 1;
    return mq(768) ? 2 : 1; // compact
  };
  const [cols, setCols] = useState(get);
  useEffect(() => {
    const onChange = () => setCols(get());
    const mqls = [640, 768, 1024, 1280].map((min) => window.matchMedia(`(min-width: ${min}px)`));
    mqls.forEach((m) => m.addEventListener('change', onChange));
    onChange();
    return () => mqls.forEach((m) => m.removeEventListener('change', onChange));
    // get is re-created per render but reads only viewport + kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  return cols;
}

interface ShowMoreButtonProps {
  expanded: boolean;
  /** "more": items still hidden. "less": items this tap will hide. */
  count: number;
  isAr: boolean;
  onToggle: () => void;
}

/** On-brand pager button: solid gold pill, black text, rotating chevron. */
const ShowMoreButton: React.FC<ShowMoreButtonProps> = ({ expanded, count, isAr, onToggle }) => (
  <div className="mt-4 flex justify-center pager-anchor">
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="btn-tactile inline-flex items-center gap-2 h-11 px-6 rounded-full border border-[var(--primary)] bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold shadow-sm hover:brightness-110 transition"
    >
      <span>
        {expanded
          ? isAr ? `عرض أقل (${count})` : `Show less (${count})`
          : isAr ? `عرض المزيد (${count})` : `Show more (${count})`}
      </span>
      <ChevronDown size={16} className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
    </button>
  </div>
);

interface MenuListRowItemProps {
  kind: 'list' | 'compact' | 'cards' | 'photos' | 'round';
  item: MenuItem;
  index: number;
  /** Phased-collapse fade delay (null = not leaving). See .row-leaving. */
  leaveDelayMs: number | null;
  /** Post-expansion mounts skip the scroll entrance: items mounted by "Show
      more" must never rest invisible if the reveal observer misfires (short
      mobile viewports + momentum scroll). First-paint items keep the
      animated entrance untouched. */
  skipEntrance: boolean;
  /** Menu-only mode (starter): hides ordering UI, rows are not clickable. */
  orderingEnabled: boolean;
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
  /** Christmas theme on (optional, defaults to false). */
  festive?: boolean;
  /** True only for the first visible photos/round section (required). */
  firstMedia: boolean;
}

/** Picks the row component for the section layout (single place, head + tail). */
const MenuListRowItem: React.FC<MenuListRowItemProps> = ({
  kind,
  item,
  index,
  leaveDelayMs,
  skipEntrance,
  orderingEnabled,
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
  festive = false,
  firstMedia,
}: MenuListRowItemProps) => {
  const qty = totalQtyOf(item);
  if (kind === 'compact') {
    return (
      <MenuListCompactRow
        item={item}
        index={index}
        leaveDelayMs={leaveDelayMs}
        skipEntrance={skipEntrance}
        orderingEnabled={orderingEnabled}
        festive={festive}
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
        leaveDelayMs={leaveDelayMs}
        skipEntrance={skipEntrance}
        orderingEnabled={orderingEnabled}
        festive={festive}
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
  if (kind === 'photos') {
    return (
      <MenuListPhotoCard
        item={item}
        index={index}
        leaveDelayMs={leaveDelayMs}
        skipEntrance={skipEntrance}
        orderingEnabled={orderingEnabled}
        festive={festive}
        eager={index < 2 && firstMedia}
        menu={menu}
        lang={lang}
        currency={currency}
        darkMode={darkMode}
        isAr={isAr}
        qty={qty}
        sectionMark={sectionMark}
        onAddItem={onAddItem}
        onUpdateLine={onUpdateLine}
        onOpenItem={onOpenItem}
      />
    );
  }
  if (kind === 'round') {
    return (
      <MenuListRoundCard
        item={item}
        index={index}
        leaveDelayMs={leaveDelayMs}
        skipEntrance={skipEntrance}
        orderingEnabled={orderingEnabled}
        festive={festive}
        eager={index < 2 && firstMedia}
        menu={menu}
        lang={lang}
        currency={currency}
        darkMode={darkMode}
        isAr={isAr}
        qty={qty}
        sectionMark={sectionMark}
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
      leaveDelayMs={leaveDelayMs}
      skipEntrance={skipEntrance}
      orderingEnabled={orderingEnabled}
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
      festive={festive}
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
  orderingEnabled = true,
  festive,
}) => {
  const isAr = lang === 'ar';
  // Christmas accents: explicit prop wins, otherwise follow the seasonal
  // theme in settings (old docs without the block count as `off`).
  const isFestive = festive ?? menu.settings.seasonal?.theme === 'christmas';

  const filteredItems = useMenuListFiltering(items, menu, selectedCategory, searchQuery, selectedBadge);

  const { totalQtyOf } = useMenuListCartQuantities(cart);

  // Per-category visible counts (absent = initial). Any active filter shows
  // everything: collapsing would hide matches.
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  // Stepping-back mode: once "less" starts at the end, the button STAYS
  // "less" through every stage back to the start (never morphs mid-way).
  const [steppingBack, setSteppingBack] = useState<Record<string, boolean>>({});
  // Phased collapse: { id, from } marks the range [from, visible) as leaving
  // (fading in place, layout frozen). One collapse at a time globally — a
  // second tap mid-fade is ignored (520 ms), which also kills timer clashes.
  const [leaving, setLeaving] = useState<{ id: string; from: number } | null>(null);
  const leaveTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  const filteringRef = useRef(false);
  const filtering = searchQuery.trim() !== '' || selectedBadge !== null || selectedCategory !== 'all';
  // First mount renders one section, then adds the rest in small slices. The
  // 6 s intro is the cover window: mounting 30+ cards in one commit was the
  // largest remaining long task and stuttered the reveal on phones. Filters
  // always show every matching section immediately.
  const [mountedCats, setMountedCats] = useState(1);
  const progressiveStarted = useRef(false);
  const progressiveCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => progressiveCleanup.current?.(), []);
  const smRaw = (menu.settings as { showMore?: { initial?: unknown; batch?: unknown } }).showMore || {};
  const intOr = (v: unknown, fb: number) =>
    Number.isInteger(v) && (v as number) >= 4 && (v as number) <= 50 ? (v as number) : fb;
  const initial = intOr(smRaw.initial, 12);
  const batch = intOr(smRaw.batch, 8);
  // One hook call per grid kind (never inside the section loop below).
  const cardsCols = useGridCols('cards');
  const listCols = useGridCols('list');
  const compactCols = useGridCols('compact');
  const photoCols = useGridCols('photos');
  const roundCols = useGridCols('round');

  filteringRef.current = filtering;

  // Get visible categories that have items in filtered list
  const activeCategoryIds = Array.from(new Set(filteredItems.map((i) => i.categoryId)));
  const visibleCats = categories.filter((c) => c.visible && activeCategoryIds.includes(c.id));
  const catCount = visibleCats.length;

  useEffect(() => {
    if (filtering || progressiveStarted.current || catCount <= 1) {
      setMountedCats(catCount);
      return;
    }
    progressiveStarted.current = true;
    let n = 1;
    setMountedCats(1);
    const id = window.setInterval(() => {
      n += 1;
      setMountedCats(Math.min(n, catCount));
      if (n >= catCount) window.clearInterval(id);
    }, 700);
    progressiveCleanup.current = () => window.clearInterval(id);
    return () => window.clearInterval(id);
  }, [filtering, catCount]);

  if (filteredItems.length === 0) {
    return <MenuListEmptyState darkMode={darkMode} isAr={isAr} />;
  }

  // First visible photos/round section: only its first two cards may
  // eager-load. Deeper media sections stay lazy — native lazy fires the
  // moment they near the viewport, so nothing visible changes while the
  // LCP race loses up to ~360 KB of high-priority below-fold bytes.
  const layoutOf = (c: Category) => c.layout || (c.id === 'manakish' ? 'list' : 'cards');
  const firstMediaCatId = visibleCats.find((c) => {
    const l = layoutOf(c);
    return l === 'photos' || l === 'round';
  })?.id;

  return (
    <div className="pb-12 space-y-7 w-full">
      {visibleCats.slice(0, Math.max(1, mountedCats)).map((cat) => {
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
        const kind = isCompactSection ? 'compact' : isListSection ? 'list' : layout === 'photos' ? 'photos' : layout === 'round' ? 'round' : 'cards';
        const gridClass =
          kind === 'compact'
            ? 'grid grid-cols-1 md:grid-cols-2 gap-x-10 menu-section-grid'
            : kind === 'list'
              ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-10 gap-y-4 menu-section-grid'
              : kind === 'photos'
                // Photo cards pair up from the smallest phones, exactly like
                // the text cards: narrow screens get the compact card (no
                // description, smaller title/ticket — see MenuListPhotoCard).
                // Large screens step up to 4 columns so cards stay petite.
                ? 'grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-6 menu-section-grid'
                // Round sections are full-bleed (see sectionWrapClass below):
                // dense compact columns use the whole viewport width.
                : kind === 'round'
                  ? 'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-4 menu-section-grid menu-grid-round'
                // Single column under 360px: two 133px cards squeeze Arabic
                // names + price + action at 320px — one readable column wins.
                : 'grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4 md:gap-5 menu-section-grid';
        const total = catItems.length;
        // Snap the window to FULL rows of this section's live grid: on a
        // 5-column desktop grid initial 12 → 15, batch 8 → 10, so no orphan
        // row and no empty slots beside the pager. Mobile grids (2 cols)
        // keep 12/8 exactly (already multiples). At least one full row.
        const cols = kind === 'compact' ? compactCols : isListSection ? listCols : kind === 'photos' ? photoCols : kind === 'round' ? roundCols : cardsCols;
        const snapRows = (n: number) => Math.max(cols, Math.ceil(n / cols) * cols);
        const effInitial = snapRows(initial);
        const effBatch = snapRows(batch);
        const rowCtx: Omit<MenuListRowItemProps, 'item' | 'index' | 'leaveDelayMs' | 'skipEntrance'> = {
          kind,
          menu,
          lang,
          currency,
          darkMode,
          isAr,
          orderingEnabled,
          festive: isFestive,
          firstMedia: cat.id === firstMediaCatId,
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
        // animating container). Collapsing is phased (fade, then commit with
        // pixel-lock) so the viewport never jumps.
        const collapsible = !filtering && total > effInitial + MIN_REST;
        const storedVisible = collapsible
          ? Math.min(total, Math.max(effInitial, visibleCounts[cat.id] ?? effInitial))
          : total;
        // Never strand a 1..MIN_REST tail behind a pager ("show more (2)" is
        // sillier than just showing the two): fold it into the window. Also
        // repairs a stored window left stale by a resize or a menu update.
        const visible =
          collapsible && storedVisible > effInitial && total - storedVisible <= MIN_REST
            ? total
            : storedVisible;
        const hasMore = collapsible && visible < total;
        // Stepped collapse: "less" goes back one batch per tap (never jumps
        // straight to the start), mirroring "more".
        const pastStart = collapsible && visible > effInitial;
        // The pill shows the exact number of cards this tap hides.
        const lessCount = visible - Math.max(effInitial, visible - effBatch);
        const more = () => {
          if (leaving) return;
          setSteppingBack((prev) => {
            if (!prev[cat.id]) return prev;
            const next = { ...prev };
            delete next[cat.id];
            return next;
          });
          setVisibleCounts((prev) => {
            const current = Math.min(total, Math.max(effInitial, prev[cat.id] ?? effInitial));
            const next = Math.min(total, current + effBatch);
            // Last batch: take a small tail too, so no orphan pager remains.
            return { ...prev, [cat.id]: total - next <= MIN_REST ? total : next };
          });
        };
        // Phased "less": phase 1 fades the doomed range [target, visible) in
        // place — layout fully frozen, so the scroll position CANNOT jump.
        // Phase 2 (520 ms) commits the smaller window and glides: home to the
        // header on landing, recentered on the pager mid-way. Taps mid-fade
        // are ignored (one collapse at a time).
        const less = () => {
          if (leaving) return;
          const target = Math.max(effInitial, visible - effBatch);
          const landing = target <= effInitial;
          setLeaving({ id: cat.id, from: target });
          window.clearTimeout(leaveTimer.current);
          leaveTimer.current = window.setTimeout(() => {
            // Measure BEFORE the commit (frozen layout), so the compensation
            // below can lock the pager pixel-stable.
            const pager = document.querySelector(`#category-${cat.id} .pager-anchor`);
            const before = pager ? pager.getBoundingClientRect().top : null;
            // flushSync: the commit lands SYNCHRONOUSLY. An async callback
            // (rAF) could fire before React flushes, measure the old layout,
            // no-op, and leave the browser clamp-jump in place — that race
            // produced the 1140px instant jump. Deterministic beats fast here.
            flushSync(() => {
              setLeaving((cur) => (cur && cur.id === cat.id ? null : cur));
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
                setVisibleCounts((prev) => ({ ...prev, [cat.id]: target }));
                setSteppingBack((prev) => ({ ...prev, [cat.id]: true }));
              }
            });
            // The user may have moved on (search/filter) mid-fade — then
            // touch nothing at all: yanking the viewport during typing is worse.
            if (filteringRef.current) return;
            // DOM is committed: shift by exactly the removed height so the
            // pager sits pixel-stable (defeats the browser clamp-jump), then
            // glide home on landing, on the now-stable layout.
            const pagerAfter = document.querySelector(`#category-${cat.id} .pager-anchor`);
            const after = pagerAfter ? pagerAfter.getBoundingClientRect().top : null;
            if (before != null && after != null) window.scrollBy(0, after - before);
            if (landing) {
              scrollToElementId(`category-${cat.id}`);
            }
          }, 520);
        };
        // One morphing button: "more" (remaining count) until the end, then
        // ONLY "less" — which keeps stepping back through every stage (the
        // button never morphs mid-way back) and shows how many it will hide.
        // Buttons stay mounted mid-fade (taps guarded) so the pixel-lock
        // anchor is always measurable.
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
            <ShowMoreButton expanded isAr={isAr} count={lessCount} onToggle={less} />
          ) : null
        ) : null;
        const visibleItems = catItems.slice(0, visible);
        const isLeaving = leaving?.id === cat.id;
        const itemsGrid = (
          <div className={gridClass}>
            {visibleItems.map((item, idx) => (
              <MenuListRowItem
                key={item.id}
                item={item}
                index={idx}
                leaveDelayMs={
                  isLeaving && idx >= (leaving?.from ?? visible)
                    ? Math.min((visible - 1 - idx) * 5, 200)
                    : null
                }
                // Only items mounted by an explicit expansion skip the
                // entrance: first-paint items (visibleCounts untouched) keep
                // the animated reveal exactly as today.
                skipEntrance={idx >= effInitial && (visibleCounts[cat.id] ?? 0) > effInitial}
                {...rowCtx}
              />
            ))}
          </div>
        );
        // scroll-mt clears the sticky stack (banner + two chip rows ≈150px)
        // so the anchored header never hides underneath after chip taps.
        // Round sections keep the full-bleed branded BACKDROP, but their
        // content (header + grid + pager) sits in the same centered column
        // as every other layout — otherwise round headers/cards stick to
        // the viewport edges on desktop while the rest is centered.
        // The band's vertical padding reveals its backdrop above/below.
        const sectionWrapClass = kind === 'round'
          ? `w-full py-8 sm:py-10 ${darkMode ? 'round-band' : 'round-band-light'}`
          : 'px-5 sm:px-8 max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full';
        const sectionInnerClass = kind === 'round'
          ? 'px-5 sm:px-8 max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full'
          : undefined;
        const sectionBody = (
          <>
            {/* Category Header */}
            <MenuListSectionHeader title={isAr ? cat.name.ar : cat.name.en} darkMode={darkMode} count={catItems.length} festive={isFestive} />
            {/* One grid per section: compact/list/cards differ only by the
                grid classes and the row component, both resolved above. */}
            {itemsGrid}
            {pagerButton}
          </>
        );
        return (
          <section key={cat.id} id={`category-${cat.id}`} data-motion-reveal="fade" className={`scroll-mt-[160px] menu-section${isFestive ? ' xmas-festive' : ''}`}>
            {sectionInnerClass ? (
              <div className={sectionWrapClass}>
                <div className={sectionInnerClass}>
                  {sectionBody}
                </div>
              </div>
            ) : (
              <div className={sectionWrapClass}>
                {sectionBody}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};
