import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { MenuData, MenuItem } from '@/src/types/menu';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { pickLangText } from '@/src/utils/menuHelpers';
import { SmartMenuImage } from '@/src/components/SmartMenuImage';
import { priceLabel, effectiveBadges } from '@/src/utils/pricing';

interface FeaturedCarouselProps {
  items: MenuItem[];
  menu: MenuData;
  onOpenItem: (item: MenuItem) => void;
  onAddToCart: (item: MenuItem) => void;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
  autoplay: boolean;
  autoplayInterval: number;
  /** Force the mobile slider layout even on wide screens (admin live preview). */
  forceSlider?: boolean;
  /** Preview-only manual arrows: step through cards with the same slide motion. */
  showArrows?: boolean;
  /** Menu-only mode (starter): hides the add button, cards are not clickable. */
  orderingEnabled?: boolean;
}

/** Desktop ≥768px (mirrors the md: breakpoint): 3 cards slide together. */
function useDesktop(): boolean {
  const get = () =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(min-width: 768px)').matches;
  const [v, setV] = useState(get);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 768px)');
    const on = () => setV(m.matches);
    m.addEventListener('change', on);
    on();
    return () => m.removeEventListener('change', on);
  }, []);
  return v;
}

export const FeaturedCarousel: React.FC<FeaturedCarouselProps> = ({
  items,
  menu,
  onOpenItem,
  onAddToCart,
  currency,
  lang,
  darkMode,
  autoplay,
  autoplayInterval,
  forceSlider = false,
  showArrows = false,
  orderingEnabled = true,
}) => {
  const isAr = lang === 'ar';
  const interactive = orderingEnabled;

  // One-card-at-a-time slider on mobile: smooth transform slide with dots,
  // wraps instantly at the end. Desktop slides 3 cards at a time in ONE row
  // (equal thirds, step = one card, instant wrap at the end).
  const isDesktop = useDesktop();
  const visible = !forceSlider && isDesktop ? 3 : 1;
  const marqueeOn = autoplay && items.length > 1;
  const perCard = Math.min(10, Math.max(2, autoplayInterval || 4));
  const [index, setIndex] = useState(0);
  const [instant, setInstant] = useState(false);
  // Short-lived compositor hint: the track gets .slider-sliding (which opts
  // into will-change: transform) only while a slide transition actually runs.
  // Instant jumps (end-wrap, breakpoint stranding) run with transition: none
  // and need no layer. The 750ms window covers the 0.7s CSS slide + margin.
  const [sliding, setSliding] = useState(false);
  const slidingFrom = useRef(0);
  useEffect(() => {
    if (instant) {
      slidingFrom.current = index;
      return;
    }
    if (slidingFrom.current === index) return;
    slidingFrom.current = index;
    setSliding(true);
    const t = window.setTimeout(() => setSliding(false), 750);
    return () => window.clearTimeout(t);
  }, [index, instant]);
  // Broken remote photos fall back to the plain branded card (same pattern
  // as the menu photo cards) — one record for all cards, no per-card hooks.
  const [failedPhoto, setFailedPhoto] = useState<Record<string, boolean>>({});
  const indexRef = useRef(0);
  const pausedRef = useRef(false);
  const resumeTimer = useRef<number | null>(null);
  const touchX = useRef<number | null>(null);
  const count = items.length;
  // Last start position with a FULL window (6 items, 3 visible → 0..3).
  const maxIndex = Math.max(0, count - visible);

  // Pixel step = one card + one gap (card widths are container-driven, so a
  // resize listener is enough — no per-frame measuring). Drives --sx on the
  // track for mobile AND desktop alike.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [stepPx, setStepPx] = useState(0);
  const gapPx = visible > 1 ? 16 : 0; // md:gap-4
  useEffect(() => {
    // rAF-coalesced + change-guarded: a resize burst shares one width read,
    // and identical widths skip the setState entirely. The track is also
    // observed (card widths are container-driven — fonts/images settling
    // changes them without any window resize). Initial measure stays
    // synchronous so the first paint carries the correct --sx.
    let ticking = false;
    let last = -1;
    const measure = () => {
      const first = trackRef.current?.children[0] as HTMLElement | undefined;
      const next = first ? first.getBoundingClientRect().width + gapPx : 0;
      if (next !== last) {
        last = next;
        setStepPx(next);
      }
    };
    const requestMeasure = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        measure();
      });
    };
    measure();
    const ro = trackRef.current ? new ResizeObserver(requestMeasure) : null;
    if (trackRef.current && ro) ro.observe(trackRef.current);
    window.addEventListener('resize', requestMeasure);
    return () => {
      window.removeEventListener('resize', requestMeasure);
      ro?.disconnect();
    };
  }, [gapPx, count]);

  // Resizing across the md breakpoint can strand the index past the end —
  // restart instantly rather than showing half-empty space.
  useEffect(() => {
    if (indexRef.current > maxIndex) {
      setInstant(true);
      indexRef.current = 0;
      setIndex(0);
      requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    }
  }, [maxIndex]);

  // Fresh mount per item list (parent keys by item ids), so index/ref
  // always start at 0 — no reset effect needed.
  useEffect(() => {
    if (!marqueeOn || count <= 1) return;
    const id = window.setInterval(() => {
      if (document.hidden || pausedRef.current) return;
      const next = indexRef.current + 1;
      if (next > maxIndex) {
        // Instant wrap (no visible rewind), then re-enable animation
        setInstant(true);
        indexRef.current = 0;
        setIndex(0);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setInstant(false))
        );
      } else {
        indexRef.current = next;
        setIndex(next);
      }
    }, perCard * 1000);
    return () => window.clearInterval(id);
  }, [marqueeOn, count, perCard, maxIndex]);

  useEffect(() => {
    return () => {
      if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    };
  }, []);

  const pause = () => {
    pausedRef.current = true;
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  };
  const resumeSoon = () => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      pausedRef.current = false;
      resumeTimer.current = null;
    }, 3000);
  };
  const goTo = (i: number) => {
    pause();
    // Mobile wraps around the whole list; desktop clamps to full windows.
    const n = visible > 1
      ? Math.min(maxIndex, Math.max(0, i))
      : ((i % count) + count) % count;
    indexRef.current = n;
    setIndex(n);
    resumeSoon();
  };
  const onTouchStart = (e: React.TouchEvent) => {
    pause();
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current !== null) {
      const dx = e.changedTouches[0].clientX - touchX.current;
      if (Math.abs(dx) > 40) {
        // Mirrored in RTL: the track advances rightward there, so a
        // finger swiping left goes to the previous card (native RTL paging).
        const step = dx < 0 ? 1 : -1;
        const raw = indexRef.current + (isAr ? -step : step);
        const n = visible > 1
          ? Math.min(maxIndex, Math.max(0, raw))
          : ((raw % count) + count) % count;
        indexRef.current = n;
        setIndex(indexRef.current);
      }
    }
    touchX.current = null;
    resumeSoon();
  };

  if (items.length === 0) return null;

  const renderCard = (item: MenuItem, idx: number) => {
    const isYellowCard = idx % 2 === 1; // Alternating cards
    const eff = effectiveBadges(menu, item);
    const badgeText = eff.includes('top')
      ? (isAr ? 'الأكثر طلباً' : 'BEST SELLER')
      : eff.includes('spicy')
      ? (isAr ? 'حار و مقرمش' : 'HOT & SPICY')
      : (isAr ? 'جديد' : 'NEW');

    const cardLabel = `${pickLangText(item.name, lang)} ${priceLabel(item, lang, currency)}`;
    const showPhoto = Boolean(item.imageUrl) && !failedPhoto[item.id];
    return (
      <motion.div
        key={item.id}
        onClick={() => interactive && onOpenItem(item)}
        onPointerDown={pause}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? cardLabel : undefined}
        data-testid={`featured-card-${item.id}`}
        data-item-id={item.id}
        onKeyDown={(e) => {
          if (!interactive) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenItem(item);
          }
        }}
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '100px' }}
        transition={{ duration: 0.55, delay: idx * 0.08, ease: [0.22, 1, 0.36, 1] }}
        className={`group relative flex-shrink-0 w-full ${forceSlider ? '' : 'md:w-auto md:min-w-0 md:grow-0 md:shrink-0 md:basis-[calc((100%_-_2rem)/3)]'} h-40 rounded-[22px] p-4 flex flex-col justify-between overflow-hidden ${interactive ? 'cursor-pointer' : ''} card-lift shadow-md border ${
          isYellowCard
            ? 'bg-[var(--primary)] text-[#0A0A0A] border-[var(--primary)]'
            : darkMode
            ? 'bg-[#181818] text-[#F2EDE0] border-white/10'
            : 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
        }`}
      >
        {/* Item photo background: the dish behind the card content. The scrim
            follows the card scheme (light on gold for black text, dark on
            dark for white text) so every scheme stays readable. */}
        {showPhoto && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <SmartMenuImage
              item={item}
              name=""
              sizes="(max-width: 767px) 90vw, 33vw"
              eager={idx === 0}
              fetchPriorityHigh={idx === 0}
              draggable={false}
              onError={() =>
                setFailedPhoto((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: true }))
              }
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div
              className={`absolute inset-0 ${
                isYellowCard
                  ? 'bg-gradient-to-t from-white/85 via-white/45 to-white/70'
                  : 'bg-gradient-to-t from-black/80 via-black/45 to-black/60'
              }`}
            />
          </div>
        )}

        {/* Brand mark from the logo (pan + handle) as a quiet watermark */}
        {!showPhoto && (
        <img
          src="/assets/pan-icon-yellow-192.webp"
          alt=""
          aria-hidden="true"
          draggable={false}
          className={`absolute -end-3 -top-2 w-24 pointer-events-none select-none -rotate-12 rtl:[transform:scaleX(-1)] transition-transform duration-500 group-hover:-rotate-3 group-hover:scale-110 ${
            isYellowCard ? 'opacity-[0.16]' : 'opacity-[0.20]'
          }`}
          style={isYellowCard ? { filter: 'brightness(0)' } : undefined}
        />
        )}

        {/* Top Tag Badge */}
        <div className="relative flex justify-between items-start">
          <span
            className={`inline-block px-3 py-1 rounded-full text-[11px] font-extrabold ${isAr ? '' : 'tracking-wider uppercase'} ${
              isYellowCard
                ? 'bg-[#0A0A0A] text-[var(--primary)]'
                : 'bg-[var(--primary)] text-[#0A0A0A]'
            }`}
          >
            {badgeText}
          </span>

          {interactive && (
          <button
            type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddToCart(item);
          }}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform active:scale-90 shadow-sm ${
              isYellowCard
                ? 'bg-[#0A0A0A] text-[var(--primary)] hover:bg-black/80'
                : 'bg-[var(--primary)] text-[#0A0A0A] hover:brightness-110'
            }`}
            aria-label={isAr ? `أضف ${item.name.ar} إلى السلة` : `Add ${item.name.en} to cart`}
            title={isAr ? 'أضف للطلب' : 'Add to cart'}
          >
            <Plus size={16} className="stroke-[3]" />
          </button>
          )}
        </div>

        {/* Bottom Info: Name & Price */}
        <div className="relative flex justify-between items-end gap-2">
          <div className="flex-1 min-w-0 pe-2">
                    <h3 className="font-bold text-base leading-tight line-clamp-2">
                      {pickLangText(item.name, lang)}
                    </h3>
                            {pickLangText(item.description, lang).trim() ? (
                              <p
                                dir="auto"
                                className={`text-xs mt-0.5 line-clamp-1 ${isAr ? 'leading-relaxed' : ''} ${
                                  isYellowCard ? 'text-black/75' : 'text-neutral-400'
                                }`}
                              >
                                {pickLangText(item.description, lang)}
                              </p>
                            ) : null}
          </div>

          <div
            className={`flex-shrink-0 px-3 py-1 rounded-full text-sm font-black shadow-sm tabular-nums ${
              isYellowCard
                ? 'bg-[#0A0A0A] text-[var(--primary)]'
                : 'bg-[var(--primary)] text-[#0A0A0A]'
            }`}
            dir="auto"
          >
            {priceLabel(item, lang, currency)}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="mt-6 mb-4 px-5 sm:px-8 max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full">
      {/* Section Title with Yellow Bar */}
      <div className="flex items-center gap-2.5 mb-3.5">
        <motion.span
          className="w-1.5 h-6 bg-[var(--primary)] rounded-sm origin-center"
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
        />
        <h2 className={`text-xl sm:text-2xl font-extrabold ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
          {isAr ? 'المميز والأكثر طلباً' : 'Featured Items'}
        </h2>
      </div>

      {/* One-card slider on mobile, 3-card sliding row on desktop (both autoplay).
          The viewport clips horizontally by design — but it must NOT slice the
          cards vertically: hover lifts each card ~4px (card-lift) and the
          entrance rises from y:22. py-3 gives that breathing room; -my-3 pulls
          it back so title/dots spacing does not move. */}
      <div className="relative overflow-hidden py-3 -my-3">
        <div
          ref={trackRef}
          onMouseEnter={pause}
          onMouseLeave={resumeSoon}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onPointerDown={pause}
          className={`slider-track flex gap-0 ${forceSlider ? '' : 'md:gap-4'} ${
            instant ? 'slider-track-instant' : ''
          } ${sliding && !instant ? 'slider-sliding' : ''}`}
          style={{ '--sx': `${isAr ? index * stepPx : -index * stepPx}px` } as React.CSSProperties}
        >
          {items.map((item, idx) => renderCard(item, idx))}
        </div>
        {/* Preview-only manual arrows: same slide motion, step gray ⇄ yellow */}
        {showArrows && count > 1 && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              className="absolute start-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/55 text-white backdrop-blur flex items-center justify-center hover:bg-black/75 transition-colors after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={isAr ? 'السابق' : 'Previous slide'}
            >
              <ChevronLeft size={16} className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/55 text-white backdrop-blur flex items-center justify-center hover:bg-black/75 transition-colors after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={isAr ? 'التالي' : 'Next slide'}
            >
              <ChevronRight size={16} className="rtl:rotate-180" />
            </button>
          </>
        )}
      </div>
      {/* Dots: one per start position (mobile: every card, desktop: every full window).
          Uniform 8px dots; the active one stretches into a solid pill — calm,
          premium, readable at a glance in both modes (no glow by owner call). */}
      {marqueeOn && maxIndex >= 1 && (
        <div className="flex justify-center items-center gap-2 mt-1.5" role="tablist" aria-label={isAr ? 'شرائح المميز' : 'Featured slides'}>
          {Array.from({ length: maxIndex + 1 }).map((_, idx) => (
            <button
              key={idx}
              type="button"
              role="tab"
              aria-selected={idx === index}
              aria-label={`${isAr ? 'شريحة' : 'Slide'} ${idx + 1}`}
              onClick={() => goTo(idx)}
              className={`h-11 min-h-[44px] px-2 inline-flex items-center rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                idx === index
                  // Active: gold on dark, solid black on light (owner call).
                  ? darkMode ? 'text-[var(--primary)]' : 'text-[#0A0A0A]'
                  : darkMode ? 'text-white/25 hover:text-white/40' : 'text-black/20 hover:text-black/40'
              }`}
            >
              <span className={`block h-2 rounded-full transition-all duration-300 ${
                idx === index
                  ? darkMode
                    ? 'w-8 bg-[var(--primary)]'
                    : 'w-8 bg-[#0A0A0A]'
                  : 'w-2 bg-current'
              }`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
