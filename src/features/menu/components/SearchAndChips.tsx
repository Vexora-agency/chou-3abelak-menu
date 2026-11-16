import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Sparkles, Flame, Award, ChevronLeft, ChevronRight } from 'lucide-react';
import { Category } from '@/src/types/menu';
import { scheduleIdle } from '@/src/utils/scheduleIdle';

interface SearchAndChipsProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  categories: Category[];
  selectedCategory: string;
  onSelectCategory: (id: string) => void;
  selectedBadge: string | null;
  onToggleBadge: (badge: string) => void;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

export const SearchAndChips: React.FC<SearchAndChipsProps> = ({
  searchQuery,
  onSearchChange,
  categories,
  selectedCategory,
  onSelectCategory,
  selectedBadge,
  onToggleBadge,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';
  const visibleCategories = categories.filter((c) => c.visible);
  const chips = [
    { id: 'all', label: isAr ? 'الكل' : 'All' },
    ...visibleCategories.map((c) => ({ id: c.id, label: isAr ? c.name.ar : c.name.en })),
  ];
  const badgeChips = [
    { id: 'new', label: isAr ? 'جديد' : 'New', Icon: Sparkles },
    { id: 'top', label: isAr ? 'الأكثر طلبًا' : 'Top', Icon: Award },
    { id: 'spicy', label: isAr ? 'حار' : 'Spicy', Icon: Flame },
  ];

  // Scroll-edge arrows for the category row (mobile-first): customers only
  // discover more chips when they see a cue. Rect-based (never scrollLeft
  // math) so LTR and RTL behave identically in every browser.
  const catScrollRef = useRef<HTMLDivElement>(null);
  const catInnerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    const outer = catScrollRef.current;
    const inner = catInnerRef.current;
    if (!outer || !inner) return;
    let ticking = false;
    // The scroller box never moves when it scrolls internally (scroll offset
    // shifts the children rects, not the container rect), and vertical page
    // scroll never changes its left/right edges — so the container edges are
    // cached and invalidated only on resize/RO. Hot scroll frames then read
    // just the two edge children (2 rects instead of 3), all reads batched
    // before the setState writes below — no interleaved read-after-write.
    let cachedEdges: { left: number; right: number } | null = null;
    const update = () => {
      ticking = false;
      let edges = cachedEdges;
      if (!edges) {
        const c = outer.getBoundingClientRect();
        edges = { left: c.left, right: c.right };
        cachedEdges = edges;
      }
      const kids = inner.children;
      if (!kids.length) {
        setCanPrev(false);
        setCanNext(false);
        return;
      }
      const SLOP = 2;
      const first = (kids[0] as HTMLElement).getBoundingClientRect();
      const last = (kids[kids.length - 1] as HTMLElement).getBoundingClientRect();
      if (isAr) {
        const nextPrev = first.right > edges.right + SLOP;
        const nextNext = last.left < edges.left - SLOP;
        setCanPrev((p) => (p === nextPrev ? p : nextPrev));
        setCanNext((n) => (n === nextNext ? n : nextNext));
      } else {
        const nextPrev = first.left < edges.left - SLOP;
        const nextNext = last.right > edges.right + SLOP;
        setCanPrev((p) => (p === nextPrev ? p : nextPrev));
        setCanNext((n) => (n === nextNext ? n : nextNext));
      }
    };
    const requestUpdate = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    // Cold path: container geometry may have changed — drop the cache so the
    // next frame re-reads it once alongside the children rects.
    const requestRefresh = () => {
      cachedEdges = null;
      requestUpdate();
    };
    // First measure on idle (settled tree, ~free reads), 1.5 s ceiling — see
    // scheduleIdle: these reads on the dirty post-mount tree forced a
    // full-page synchronous layout on low-end phones. Arrows appear a beat
    // late on first paint; nobody perceives it.
    // Later updates (scroll/resize/observer) already run on clean trees.
    const cancelIdle = scheduleIdle(update, 1500);
    outer.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestRefresh);
    const ro = new ResizeObserver(requestRefresh);
    ro.observe(outer);
    ro.observe(inner);
    return () => {
      cancelIdle();
      outer.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestRefresh);
      ro.disconnect();
    };
  }, [isAr, chips.length]);

  // Step toward the end (+1) or the start (-1) by most of a viewport.
  const stepCats = (dir: 1 | -1) => {
    const el = catScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: (isAr ? -dir : dir) * el.clientWidth * 0.7, behavior: 'smooth' });
  };

  const fadeFrom = darkMode ? 'from-[#0A0A0A]' : 'from-white';
  const arrowBtn = `absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full flex items-center justify-center shadow-lg border transition active:scale-90 anim-fade-in after:absolute after:-inset-2 after:content-[""] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
    darkMode
      ? 'bg-[#1c1c1c]/95 text-[var(--primary)] border-white/15'
      : 'bg-white text-[#0A0A0A] border-black/10'
  }`;

  return (
    <div className="px-5 sm:px-8 max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full">
      {/* Overlapping Floating Search Bar */}
      <div className="relative -mt-6 z-20 max-w-xl mx-auto">
        <label htmlFor="menu-search-input" className="sr-only">
          {isAr ? 'البحث في القائمة' : 'Search the menu'}
        </label>
        <div className="relative flex items-center">
          <Search
            size={19}
            className={`absolute start-4 stroke-[2.5] pointer-events-none ${darkMode ? 'text-[var(--primary)]' : 'text-[#8a6d00]'}`}
          />
          <input
            id="menu-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={isAr ? 'ابحث في القائمة...' : 'Search the menu...'}
            className={`w-full h-12 rounded-full border-[1.5px] text-base transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ps-11 pe-10 ${
              darkMode
                ? 'bg-[#141414] text-white border-[#2A2A2A] placeholder-neutral-400 shadow-[0_8px_24px_rgba(0,0,0,0.5)]'
                : 'bg-white text-[#0A0A0A] border-[#E5E5E5] placeholder-neutral-500 shadow-[0_8px_20px_rgba(0,0,0,0.1)]'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className={`absolute end-1 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                darkMode ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-black'
              }`}
              aria-label={isAr ? 'مسح البحث' : 'Clear search'}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Sticky navigation: categories row (scroll arrows) + badge quick-filters below */}
      <nav
        aria-label={isAr ? 'تصنيفات القائمة' : 'Menu categories'}
        className={`sticky top-0 z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 mt-1.5 transition-[background-color] duration-300 ${
          darkMode ? 'bg-[#0A0A0A] border-b border-white/5' : 'bg-white border-b border-black/5'
        }`}
      >
        {/* Categories row with edge arrows */}
        <div className="relative">
          <div ref={catScrollRef} className="overflow-x-auto no-scrollbar">
            {/* m-auto + w-max: safely centered when it fits, scrolls from the
                start when it overflows (plain justify-center would clip the
                start edge in RTL/overflow). */}
            <div ref={catInnerRef} className="m-auto flex w-max max-w-full gap-2 sm:gap-2.5 md:gap-3 px-0.5 py-0.5">
              {chips.map((chip) => {
                const isSelected = selectedCategory === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => onSelectCategory(chip.id)}
                    className={`relative flex-shrink-0 h-11 px-5 rounded-full text-sm transition-colors btn-tactile border-[1.5px] ${
                      isSelected
                        ? 'bg-[var(--primary)] text-[#0A0A0A] font-bold border-[var(--primary)]'
                        : darkMode
                        ? 'text-white/90 font-semibold border-white hover:border-[var(--primary)]'
                        : 'text-[#0A0A0A] font-semibold border-[#0A0A0A] hover:border-[var(--primary)]'
                    }`}
                    aria-pressed={isSelected}
                  >
                    <span className="relative z-10">{chip.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Start edge: fade + arrow back */}
          {canPrev && (
            <>
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute top-0 bottom-0 start-0 w-8 bg-gradient-to-r rtl:bg-gradient-to-l ${fadeFrom} to-transparent`}
              />
              <button
                type="button"
                onClick={() => stepCats(-1)}
                aria-label={isAr ? 'الفئات السابقة' : 'Previous categories'}
                className={`${arrowBtn} start-1`}
              >
                <ChevronLeft size={16} className="rtl:rotate-180" />
              </button>
            </>
          )}
          {/* End edge: fade + arrow forward */}
          {canNext && (
            <>
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute top-0 bottom-0 end-0 w-8 bg-gradient-to-l rtl:bg-gradient-to-r ${fadeFrom} to-transparent`}
              />
              <button
                type="button"
                onClick={() => stepCats(1)}
                aria-label={isAr ? 'المزيد من الفئات' : 'More categories'}
                className={`${arrowBtn} end-1`}
              >
                <ChevronRight size={16} className="rtl:rotate-180" />
              </button>
            </>
          )}
        </div>

        {/* Badge quick-filters (new / spicy / top): their own row below */}
        <div
          className="mt-2.5 overflow-x-auto no-scrollbar"
          role="group"
          aria-label={isAr ? 'تصفية سريعة' : 'Quick filters'}
        >
          <div className="m-auto flex w-max max-w-full items-center gap-2 px-0.5 py-0.5">
            <span className={`flex-shrink-0 text-[11px] font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {isAr ? 'تصفية سريعة:' : 'Quick filter:'}
            </span>
            {badgeChips.map(({ id, label, Icon }) => {
              const isSelected = selectedBadge === id;
              return (
                <button
                  key={`badge-${id}`}
                  type="button"
                  onClick={() => onToggleBadge(id)}
                  className={`relative flex-shrink-0 h-11 min-h-[44px] px-4 rounded-full text-xs transition-colors btn-tactile border-[1.5px] flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                    isSelected
                      ? 'bg-[var(--primary)] text-[#0A0A0A] font-bold border-[var(--primary)]'
                      : darkMode
                      ? 'text-white/90 font-semibold border-white hover:border-[var(--primary)]'
                      : 'text-[#0A0A0A] font-semibold border-[#0A0A0A] hover:border-[var(--primary)]'
                  }`}
                  aria-pressed={isSelected}
                  title={label}
                >
                  <span className="relative z-10 flex items-center gap-1.5">
                    <Icon size={13} className={isSelected ? '' : darkMode ? 'text-[var(--primary)]' : 'text-[#8a6d00]'} />
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
};
