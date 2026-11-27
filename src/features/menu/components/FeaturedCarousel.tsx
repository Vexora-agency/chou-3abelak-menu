import React, { useEffect, useId, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { ShoppingCart } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { pickLangText } from '@/src/utils/menuHelpers';
import {
  effectiveBadges,
  formatPrice,
  hasVariants,
  minVariantPrice,
  normalizePricing,
  requiredExtrasMin,
  unitLabel,
} from '@/src/utils/pricing';
import { SmartMenuImage } from '@/src/components/SmartMenuImage';
import { WishlistButton } from '@/src/features/wishlist';
import { carouselImageTransform } from '@/src/utils/carouselImage';
import './featured-carousel.css';

export interface FeaturedCarouselProps {
  /** `dark` is the black stage; `light` is the white stage. */
  variant: 'dark' | 'light';
  title: string;
  items: MenuItem[];
  menu: MenuData;
  currency: string;
  lang: 'en' | 'ar';
  /** Silent quick-add of `qty` units. False → the caller opens the item sheet. */
  onAddToCart: (item: MenuItem, qty: number) => boolean;
  /** Used when a quick add cannot be resolved silently (required choices). */
  onOpenItem: (item: MenuItem) => void;
  orderingEnabled?: boolean;
  /** Master switch from the menu settings. Cadence defaults to the approved 5s. */
  autoplay?: boolean;
  /** Optional cadence override (admin live preview). Storefront stays at 5s. */
  autoplayIntervalMs?: number;
  /** Optional layout classes from the page (e.g. vertical rhythm). */
  className?: string;
  /** Small single-card preview used by the admin settings (no title). */
  compact?: boolean;
}

/** The approved progress duration. Keep in sync with --fc-autoplay in CSS. */
const AUTOPLAY_MS = 5000;
const SUCCESS_MS = 1400;

/** 1 card on phones, 2 on tablets, 3 on large screens. */
function slidesPerViewNow(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 1;
  if (window.matchMedia('(min-width: 1120px)').matches) return 3;
  if (window.matchMedia('(min-width: 768px)').matches) return 2;
  return 1;
}

function useSlidesPerView(): number {
  const [perView, setPerView] = useState(slidesPerViewNow);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const tablet = window.matchMedia('(min-width: 768px)');
    const desktop = window.matchMedia('(min-width: 1120px)');
    const onChange = () => setPerView(slidesPerViewNow());
    tablet.addEventListener('change', onChange);
    desktop.addEventListener('change', onChange);
    onChange();
    return () => {
      tablet.removeEventListener('change', onChange);
      desktop.removeEventListener('change', onChange);
    };
  }, []);
  return perView;
}

interface PriceParts {
  amount: string;
  currency?: string;
  unit?: string;
}

/** Amount / currency / unit split so each part can take its designed size. */
function featuredPrice(
  item: MenuItem,
  menu: MenuData,
  lang: 'en' | 'ar',
  currency: string,
): PriceParts {
  const isAr = lang === 'ar';
  const p = normalizePricing(item);
  const free = isAr ? 'مجانًا' : 'FREE';
  try {
    const extras = requiredExtrasMin(item, menu);
    const amount = hasVariants(item)
      ? minVariantPrice(item) + extras
      : typeof p.price === 'number'
        ? p.price + extras
        : extras > 0
          ? extras
          : null;
    if (amount === null) return { amount: '—' };
    if (amount <= 0) return { amount: free };
    return {
      amount: formatPrice(amount),
      currency: currency || undefined,
      unit: p.showUnit ? `/ ${unitLabel(p.unit, 1, lang)}` : undefined,
    };
  } catch {
    return { amount: '—' };
  }
}

function badgeText(item: MenuItem, menu: MenuData, isAr: boolean): string {
  const badges = effectiveBadges(menu, item);
  if (badges.includes('top')) return isAr ? 'الأكثر طلبًا' : 'BEST SELLER';
  if (badges.includes('new')) return isAr ? 'جديد' : 'NEW';
  return '';
}

interface FeaturedCardProps {
  item: MenuItem;
  menu: MenuData;
  lang: 'en' | 'ar';
  currency: string;
  index: number;
  active: boolean;
  eager: boolean;
  darkMode: boolean;
  orderingEnabled: boolean;
  onAddToCart: (item: MenuItem, qty: number) => boolean;
  onOpenItem: (item: MenuItem) => void;
}

const FeaturedCard: React.FC<FeaturedCardProps> = ({
  item,
  menu,
  lang,
  currency,
  index,
  active,
  eager,
  darkMode,
  orderingEnabled,
  onAddToCart,
  onOpenItem,
}) => {
  const isAr = lang === 'ar';
  const pricing = normalizePricing(item);
  const [qty, setQty] = useState(pricing.minQty);
  const [added, setAdded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const successTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (successTimer.current !== null) window.clearTimeout(successTimer.current);
    };
  }, []);

  const name = pickLangText(item.name, lang);
  const description = pickLangText(item.description, lang).trim();
  const price = featuredPrice(item, menu, lang, currency);
  const badge = badgeText(item, menu, isAr);
  const hot = effectiveBadges(menu, item).includes('spicy');
  const isGold = index % 2 === 1;
  const showPhoto = Boolean(item.imageUrl) && !imageFailed;
  const imageTransform = carouselImageTransform(item.carouselImage);

  const decrease = () => setQty((q) => Math.max(pricing.minQty, q - pricing.step));
  const increase = () => setQty((q) => Math.min(pricing.maxQty, q + pricing.step));

  const handleAdd = () => {
    if (!orderingEnabled || added) return;
    const requiresChoice =
      Array.isArray(item.requiredGroups) && item.requiredGroups.length > 0;
    if (requiresChoice) {
      onOpenItem(item);
      return;
    }
    if (!onAddToCart(item, qty)) {
      onOpenItem(item);
      return;
    }
    setAdded(true);
    successTimer.current = window.setTimeout(() => {
      successTimer.current = null;
      setAdded(false);
    }, SUCCESS_MS);
  };

  return (
    <article
      className={`fc-card${isGold ? ' is-gold' : ''}${active ? ' is-active' : ''}`}
      data-testid={`featured-card-${item.id}`}
      aria-roledescription={isAr ? 'بطاقة' : 'card'}
    >
      <div className="fc-photo" aria-hidden="true">
        {showPhoto ? (
          <div
            className="fc-photo-adjust"
            style={imageTransform ? { transform: imageTransform } : undefined}
          >
            <SmartMenuImage
              item={item}
              name=""
              sizes="280px"
              width={800}
              height={800}
              eager={eager}
              plain
              onError={() => setImageFailed(true)}
              className="fc-photo-img"
            />
          </div>
        ) : null}
      </div>

      <svg
        className="fc-liquid"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          className="fc-liquid-fill"
          d="M100,0L50,0C46,12 54,24 49,38C44,52 54,66 48,80C46,88 48,94 46,100L100,100Z"
        />
        <path
          className="fc-liquid-edge"
          d="M50,0C46,12 54,24 49,38C44,52 54,66 48,80C46,88 48,94 46,100"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {hot ? <span className="fc-hot">{isAr ? 'حار' : 'SPICY'}</span> : null}

      <div className="fc-text">
        {badge ? <span className="fc-badge">{badge}</span> : null}
        <h3 className="fc-name">{name}</h3>
        {description ? <p className="fc-desc">{description}</p> : null}
        <div className="fc-price">
          <span dir="ltr">{price.amount}</span>
          {price.currency ? <small>{price.currency}</small> : null}
          {price.unit ? <em>{price.unit}</em> : null}
        </div>
      </div>

      {orderingEnabled ? (
        <div className="fc-bar">
          <button
            type="button"
            className={`fc-add${added ? ' is-added' : ''}`}
            onClick={handleAdd}
            aria-disabled={added || undefined}
            aria-label={
              added
                ? isAr
                  ? `تمت إضافة ${name} إلى السلة`
                  : `${name} added to cart`
                : isAr
                  ? `أضف ${name} إلى السلة، الكمية ${qty}`
                  : `Add ${name} to cart, quantity ${qty}`
            }
          >
            {added ? (
              <span>{isAr ? 'تمت الإضافة ✓' : 'Added ✓'}</span>
            ) : (
              <>
                <ShoppingCart size={18} strokeWidth={2.4} aria-hidden="true" />
                <span>{isAr ? 'أضف للسلة' : 'Add to cart'}</span>
              </>
            )}
          </button>

          <WishlistButton
            itemId={item.id}
            itemName={name}
            lang={lang}
            darkMode={darkMode}
            tone="overlay"
            size="sm"
            className="fc-wishlist-inline"
          />

          <div className="fc-qty">
            <button
              type="button"
              className="fc-qty-btn fc-qty-btn--minus"
              onClick={decrease}
              disabled={qty <= pricing.minQty}
              aria-label={isAr ? 'تقليل الكمية' : 'Decrease quantity'}
            >
              −
            </button>
            <span className="fc-qty-value" aria-live="polite" aria-atomic="true">
              {qty}
            </span>
            <button
              type="button"
              className="fc-qty-btn fc-qty-btn--plus"
              onClick={increase}
              disabled={qty >= pricing.maxQty}
              aria-label={isAr ? 'زيادة الكمية' : 'Increase quantity'}
            >
              +
            </button>
          </div>
        </div>
      ) : null}

      <span className="fc-sr-only" role="status" aria-live="polite">
        {added ? (isAr ? `تمت إضافة ${name} إلى السلة` : `${name} added to cart`) : ''}
      </span>
    </article>
  );
};

export const FeaturedCarousel: React.FC<FeaturedCarouselProps> = ({
  variant,
  title,
  items,
  menu,
  currency,
  lang,
  onAddToCart,
  onOpenItem,
  orderingEnabled = true,
  autoplay = true,
  autoplayIntervalMs = AUTOPLAY_MS,
  className = '',
  compact = false,
}) => {
  const isAr = lang === 'ar';
  const isLight = variant === 'light';
  const slidesPerView = useSlidesPerView();
  const titleId = useId();
  const pressingRef = useRef(false);
  const autoplayMs =
    Number.isFinite(autoplayIntervalMs) && autoplayIntervalMs >= 1000
      ? autoplayIntervalMs
      : AUTOPLAY_MS;
  const perView = Math.min(compact ? 1 : slidesPerView, Math.max(1, items.length));

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: 'start',
    direction: isAr ? 'rtl' : 'ltr',
    slidesToScroll: 1,
    // One smooth, phone-like card-to-card slide on every device.
    duration: 24,
  });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  );

  const activeSlides = new Set<number>();
  for (let i = 0; i < perView && items.length > 0; i += 1) {
    activeSlides.add((selectedIndex + i) % items.length);
  }

  const autoplayOn = autoplay && items.length > 1;
  const running = autoplayOn && !paused && pageVisible;

  // The number of visible slides is CSS-driven (1 / 2 / 3); Embla must
  // remeasure when a breakpoint changes the slide widths.
  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.reInit();
  }, [emblaApi, perView]);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
      // A new slide owns a fresh 5s window.
      setCycle((c) => c + 1);
    };
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi]);

  // A pointer press anywhere on the carousel freezes the progress and the
  // timer. Releasing restarts both from zero so the fill can never desync
  // from the actual 5s cadence.
  useEffect(() => {
    const release = () => {
      if (!pressingRef.current) return;
      pressingRef.current = false;
      setPaused(false);
      setCycle((c) => c + 1);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      const visible = !document.hidden;
      setPageVisible(visible);
      if (visible) setCycle((c) => c + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!emblaApi || !running) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      emblaApi.scrollNext();
    }, autoplayMs);
    return () => window.clearInterval(id);
  }, [emblaApi, running, cycle, autoplayMs]);

  const handlePress = () => {
    pressingRef.current = true;
    setPaused(true);
  };

  const goTo = (index: number) => {
    emblaApi?.scrollTo(index);
  };

  if (items.length === 0) return null;

  return (
    <section
      className={`fc-root fc-root--${variant}${compact ? ' fc-root--compact' : ''}${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      onPointerDown={handlePress}
      style={
        {
          '--fc-autoplay': `${autoplayMs}ms`,
          '--fc-per-view': perView,
        } as React.CSSProperties
      }
    >
      <div className="fc-head">
        <h2 className="fc-title" id={titleId}>
          {title}
        </h2>
      </div>

      <div
        className="fc-viewport"
        ref={emblaRef}
        role="group"
        aria-roledescription={isAr ? 'كاروسيل' : 'carousel'}
        aria-label={title}
      >
        <div className="fc-track">
          {items.map((slideItem, index) => (
            <div
              key={slideItem.id}
              className="fc-slide"
              role="group"
              aria-roledescription={isAr ? 'شريحة' : 'slide'}
              aria-label={
                isAr
                  ? `الشريحة ${index + 1} من ${items.length}`
                  : `Slide ${index + 1} of ${items.length}`
              }
            >
              <FeaturedCard
                item={slideItem}
                menu={menu}
                lang={lang}
                currency={currency}
                index={index}
                active={activeSlides.has(index)}
                eager={index === 0}
                darkMode={!isLight}
                orderingEnabled={orderingEnabled}
                onAddToCart={onAddToCart}
                onOpenItem={onOpenItem}
              />
            </div>
          ))}
        </div>
      </div>

      {items.length > 1 ? (
        <div
          className="fc-dots"
          role="group"
          aria-label={isAr ? 'شرائح الكاروسيل' : 'Carousel slides'}
        >
          {items.map((dotItem, index) => {
            const active = index === selectedIndex;
            const showProgress = active && autoplayOn;
            return (
              <button
                key={dotItem.id}
                type="button"
                className="fc-dot-btn"
                onClick={() => goTo(index)}
                aria-label={
                  isAr ? `الشريحة ${index + 1} من ${items.length}` : `Slide ${index + 1} of ${items.length}`
                }
                aria-current={active ? 'true' : undefined}
              >
                <span
                  className={`fc-dot${active ? ' is-active' : ''}${
                    active && !autoplayOn ? ' is-static' : ''
                  }`}
                >
                  {showProgress ? (
                    <span
                      key={cycle}
                      className={`fc-dot-fill${paused || !pageVisible ? ' is-paused' : ''}`}
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};
