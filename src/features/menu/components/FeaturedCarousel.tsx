import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { MenuData, MenuItem } from '@/src/types/menu';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { pickLangText } from '@/src/utils/menuHelpers';
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
}) => {
  const isAr = lang === 'ar';

  // One-card-at-a-time slider on mobile: smooth transform slide with dots,
  // wraps instantly at the end. Desktop shows a static grid instead.
  const marqueeOn = autoplay && items.length > 1;
  const perCard = Math.min(10, Math.max(2, autoplayInterval || 4));
  const [index, setIndex] = useState(0);
  const [instant, setInstant] = useState(false);
  const indexRef = useRef(0);
  const pausedRef = useRef(false);
  const resumeTimer = useRef<number | null>(null);
  const touchX = useRef<number | null>(null);
  const count = items.length;

  // Fresh mount per item list (parent keys by item ids), so index/ref
  // always start at 0 — no reset effect needed.
  useEffect(() => {
    if (!marqueeOn || count <= 1) return;
    const id = window.setInterval(() => {
      if (document.hidden || pausedRef.current) return;
      const next = indexRef.current + 1;
      if (next >= count) {
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
  }, [marqueeOn, count, perCard]);

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
    const n = ((i % count) + count) % count;
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
        const n = indexRef.current + (isAr ? -step : step);
        indexRef.current = ((n % count) + count) % count;
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

    return (
      <motion.div
        key={item.id}
        onClick={() => onOpenItem(item)}
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 0.55, delay: idx * 0.08, ease: [0.22, 1, 0.36, 1] }}
        className={`group relative flex-shrink-0 w-full ${forceSlider ? '' : 'md:w-auto'} h-40 rounded-[22px] p-4 flex flex-col justify-between overflow-hidden cursor-pointer card-lift shadow-md border ${
          isYellowCard
            ? 'bg-[var(--primary)] text-[#0A0A0A] border-[var(--primary)]'
            : darkMode
            ? 'bg-[#181818] text-white border-white/10'
            : 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
        }`}
      >
        {/* Brand mark from the logo (pan + handle) as a quiet watermark */}
        <img
          src="/assets/pan-icon-yellow-192.webp"
          alt=""
          aria-hidden="true"
          draggable={false}
          className={`absolute -right-3 -top-2 w-24 pointer-events-none select-none -rotate-12 transition-transform duration-500 group-hover:-rotate-3 group-hover:scale-110 ${
            isYellowCard ? 'opacity-[0.16]' : 'opacity-[0.20]'
          }`}
          style={isYellowCard ? { filter: 'brightness(0)' } : undefined}
        />

        {/* Top Tag Badge */}
        <div className="relative flex justify-between items-start">
          <span
            className={`inline-block px-3 py-1 rounded-full text-[11px] font-extrabold tracking-wider uppercase ${
              isYellowCard
                ? 'bg-[#0A0A0A] text-[var(--primary)]'
                : 'bg-[var(--primary)] text-[#0A0A0A]'
            }`}
          >
            {badgeText}
          </span>

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
        </div>

        {/* Bottom Info: Name & Price */}
        <div className="relative flex justify-between items-end gap-2">
          <div className="flex-1 min-w-0 pe-2">
                    <h3 className="font-bold text-base leading-tight line-clamp-2">
                      {pickLangText(item.name, lang)}
                    </h3>
                            {pickLangText(item.description, lang).trim() ? (
                              <p
                                className={`text-xs mt-0.5 line-clamp-1 ${
                                  isYellowCard ? 'text-black/75' : 'text-neutral-400'
                                }`}
                              >
                                {pickLangText(item.description, lang)}
                              </p>
                            ) : null}
          </div>

          <div
            className={`flex-shrink-0 px-3 py-1 rounded-full text-sm font-black shadow-sm ${
              isYellowCard
                ? 'bg-[#0A0A0A] text-[var(--primary)]'
                : 'bg-[var(--primary)] text-[#0A0A0A]'
            }`}
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

      {/* One-card slider on mobile (smooth transform slide + dots), static grid on desktop */}
      <div className={`relative overflow-hidden ${forceSlider ? '' : 'md:overflow-visible'}`}>
        <div
          onMouseEnter={pause}
          onMouseLeave={resumeSoon}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onPointerDown={pause}
          className={`slider-track flex gap-0 ${forceSlider ? '' : 'md:grid md:grid-cols-3 md:gap-4'} ${
            instant ? 'slider-track-instant' : ''
          }`}
          style={{ '--sx': isAr ? `${index * 100}%` : `-${index * 100}%` } as React.CSSProperties}
        >
          {items.map((item, idx) => renderCard(item, idx))}
        </div>
        {/* Preview-only manual arrows: same slide motion, step gray ⇄ yellow */}
        {showArrows && count > 1 && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              className="absolute start-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/55 text-white backdrop-blur flex items-center justify-center hover:bg-black/75 transition-colors"
              aria-label={isAr ? 'السابق' : 'Previous slide'}
            >
              <ChevronLeft size={16} className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/55 text-white backdrop-blur flex items-center justify-center hover:bg-black/75 transition-colors"
              aria-label={isAr ? 'التالي' : 'Next slide'}
            >
              <ChevronRight size={16} className="rtl:rotate-180" />
            </button>
          </>
        )}
      </div>
      {/* Dots */}
      {marqueeOn && items.length > 1 && (
        <div className={`flex justify-center items-center gap-1.5 mt-1 ${forceSlider ? '' : 'md:hidden'}`} role="tablist" aria-label={isAr ? 'شرائح المميز' : 'Featured slides'}>
          {items.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={idx === index}
              aria-label={`${isAr ? 'شريحة' : 'Slide'} ${idx + 1}`}
              onClick={() => goTo(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === index
                  // Active: gold on dark, solid black on light (owner call).
                  ? darkMode ? 'w-6 bg-[var(--primary)]' : 'w-6 bg-[#0A0A0A]'
                  : darkMode ? 'w-1.5 bg-white/25 hover:bg-white/40' : 'w-1.5 bg-black/20 hover:bg-black/40'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
