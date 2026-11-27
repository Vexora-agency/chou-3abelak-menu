import React, { useEffect, useRef, useState } from 'react';
import {
  Heart,
  ImageOff,
  ShoppingCart,
  SlidersHorizontal,
} from 'lucide-react';
import type { CarouselImageAdjust, MenuData, MenuItem } from '@/src/types/menu';
import { pickLangText } from '@/src/utils/menuHelpers';
import { effectiveBadges, hasOptions, normalizePricing } from '@/src/utils/pricing';
import {
  CAROUSEL_IMAGE_MAX_PAN,
  CAROUSEL_IMAGE_MAX_SCALE,
  CAROUSEL_IMAGE_MIN_SCALE,
  carouselImageTransform,
} from '@/src/utils/carouselImage';
import { pickCarouselDescription } from '@/src/utils/carouselDescription';
import { SmartMenuImage } from '@/src/components/SmartMenuImage';
import { badgeText, featuredPrice } from './FeaturedCarousel';
import './carousel-card-preview.css';

export interface CarouselCardPreviewProps {
  item: MenuItem;
  menu: MenuData;
  lang: 'en' | 'ar';
  /** Same theme the storefront carousel is currently showing. */
  theme: 'dark' | 'light';
  /** Position among the featured cards (odd indexes get the yellow card). */
  index?: number;
  adjust: CarouselImageAdjust;
  /** Enables direct manipulation. Omit for a read-only preview. */
  onAdjust?: (next: Partial<CarouselImageAdjust>) => void;
  showGrid?: boolean;
  className?: string;
}

interface PointerPoint {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  width: number;
  height: number;
  rotate: number;
}

interface PinchState {
  distance: number;
  scale: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * WYSIWYG preview of one featured card. Mirrors the storefront card markup and
 * reuses the exact same CSS + transform, so what the owner frames here is what
 * customers get. The image can be dragged, wheel-zoomed, pinched, or moved
 * with the keyboard while the real card text and action bar stay visible.
 */
export const CarouselCardPreview: React.FC<CarouselCardPreviewProps> = ({
  item,
  menu,
  lang,
  theme,
  index = 0,
  adjust,
  onAdjust,
  showGrid = false,
  className = '',
}) => {
  const isAr = lang === 'ar';
  const interactive = typeof onAdjust === 'function';
  const rootRef = useRef<HTMLDivElement>(null);
  const adjustRef = useRef(adjust);
  const onAdjustRef = useRef(onAdjust);
  const pointersRef = useRef(new Map<number, PointerPoint>());
  const dragRef = useRef<DragState | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    adjustRef.current = adjust;
    onAdjustRef.current = onAdjust;
  }, [adjust, onAdjust]);

  const isGold = index % 2 === 1;
  const name = pickLangText(item.name, lang);
  const description = pickCarouselDescription(item, lang);
  const nameLength = name.trim().length;
  const nameTier = nameLength > 38 ? ' is-name-xl' : nameLength > 24 ? ' is-name-lg' : '';
  const price = featuredPrice(item, menu, lang, menu.settings.currency[lang] || menu.settings.currency.en);
  // Same density rule as the storefront card: a long name plus a unit price
  // drops the description so the price never meets the action bar.
  const dense = Boolean(nameTier && price.unit);
  const badge = badgeText(item, menu, isAr);
  const hot = effectiveBadges(menu, item).includes('spicy');
  const needsChoices = hasOptions(item);
  const previewQty = normalizePricing(item).minQty;
  const showPhoto = Boolean(item.imageUrl) && !imageFailed;
  const imageTransform = carouselImageTransform(adjust);
  const rootClassName = `cc-preview fc-root fc-root--${theme}${interactive ? ' is-interactive' : ''}${className ? ` ${className}` : ''}`;

  const photoRect = (): DOMRect | null =>
    rootRef.current?.querySelector<HTMLElement>('.fc-photo')?.getBoundingClientRect() ?? null;

  const startDrag = (pointerId: number, x: number, y: number) => {
    const rect = photoRect();
    if (!rect) return;
    dragRef.current = {
      pointerId,
      startX: x,
      startY: y,
      baseX: adjustRef.current.x,
      baseY: adjustRef.current.y,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      rotate: adjustRef.current.rotate,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.button !== 0) return;
    const target = event.target as Element | null;
    if (!target?.closest('.fc-photo')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1) {
      startDrag(event.pointerId, event.clientX, event.clientY);
      return;
    }

    if (pointersRef.current.size === 2) {
      dragRef.current = null;
      const points = [...pointersRef.current.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      pinchRef.current = {
        distance: Math.max(1, distance),
        scale: adjustRef.current.scale,
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const points = [...pointersRef.current.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const nextScale = pinchRef.current.scale * (distance / pinchRef.current.distance);
      onAdjustRef.current?.({
        scale: clamp(nextScale, CAROUSEL_IMAGE_MIN_SCALE, CAROUSEL_IMAGE_MAX_SCALE),
      });
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const rawX = event.clientX - drag.startX;
    const rawY = event.clientY - drag.startY;
    // Undo the visual rotation so the photo follows the pointer naturally.
    const radians = (-drag.rotate * Math.PI) / 180;
    const dx = rawX * Math.cos(radians) - rawY * Math.sin(radians);
    const dy = rawX * Math.sin(radians) + rawY * Math.cos(radians);

    onAdjustRef.current?.({
      x: clamp(drag.baseX + (dx / drag.width) * 100, -CAROUSEL_IMAGE_MAX_PAN, CAROUSEL_IMAGE_MAX_PAN),
      y: clamp(drag.baseY + (dy / drag.height) * 100, -CAROUSEL_IMAGE_MAX_PAN, CAROUSEL_IMAGE_MAX_PAN),
    });
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (pointersRef.current.size === 0) {
      dragRef.current = null;
      pinchRef.current = null;
      return;
    }

    if (pointersRef.current.size === 1) {
      pinchRef.current = null;
      const [pointerId, point] = [...pointersRef.current.entries()][0];
      startDrag(pointerId, point.x, point.y);
    }
  };

  useEffect(() => {
    if (!interactive) return;
    const element = rootRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 0.5) return;
      event.preventDefault();
      const step = event.deltaY > 0 ? -0.08 : 0.08;
      onAdjustRef.current?.({
        scale: clamp(
          adjustRef.current.scale + step,
          CAROUSEL_IMAGE_MIN_SCALE,
          CAROUSEL_IMAGE_MAX_SCALE,
        ),
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [interactive]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const step = event.shiftKey ? 5 : 1;
    const zoomStep = event.shiftKey ? 0.15 : 0.05;
    let next: Partial<CarouselImageAdjust> | null = null;

    switch (event.key) {
      case 'ArrowLeft':
        next = { x: adjust.x - step };
        break;
      case 'ArrowRight':
        next = { x: adjust.x + step };
        break;
      case 'ArrowUp':
        next = { y: adjust.y - step };
        break;
      case 'ArrowDown':
        next = { y: adjust.y + step };
        break;
      case '+':
      case '=':
        next = { scale: adjust.scale + zoomStep };
        break;
      case '-':
      case '_':
        next = { scale: adjust.scale - zoomStep };
        break;
      case 'Home':
        next = { x: 0, y: 0 };
        break;
      default:
        break;
    }

    if (next) {
      event.preventDefault();
      onAdjust?.(next);
    }
  };

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      role={interactive ? 'group' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={
        interactive
          ? isAr
            ? `معاينة بطاقة ${name}. اسحب الصورة لتحريكها، استخدم عجلة الفأرة أو إصبعين للتكبير، والأسهم للتحريك الدقيق.`
            : `Preview of ${name}. Drag the photo to move it, use the wheel or two fingers to zoom, and the arrow keys for fine movement.`
          : undefined
      }
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? endPointer : undefined}
      onPointerCancel={interactive ? endPointer : undefined}
      onLostPointerCapture={interactive ? endPointer : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
    >
      <article
        className={`fc-card is-active${isGold ? ' is-gold' : ''}${nameTier}${dense ? ' is-dense' : ''}`}
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
                sizes="420px"
                width={800}
                height={800}
                eager
                plain
                onError={() => setImageFailed(true)}
                className="fc-photo-img"
              />
            </div>
          ) : (
            <div className="cc-empty">
              <ImageOff size={20} aria-hidden="true" />
              <span>{isAr ? 'لا توجد صورة لهذا الصنف' : 'No photo for this item'}</span>
            </div>
          )}
          {showGrid ? (
            <span className="cc-grid" aria-hidden="true">
              <span />
              <span />
              <i />
              <i />
            </span>
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
          <h3 className="fc-name" title={name}>{name}</h3>
          {description ? <p className="fc-desc" title={description}>{description}</p> : null}
          <div className="fc-price">
            <span dir="ltr">{price.amount}</span>
            {price.currency ? <small>{price.currency}</small> : null}
            {price.unit ? <em>{price.unit}</em> : null}
          </div>
        </div>

        <div className="fc-bar" aria-hidden="true">
          <span className="fc-add">
            {needsChoices ? (
              <>
                <SlidersHorizontal size={18} strokeWidth={2.4} aria-hidden="true" />
                <span>{isAr ? 'اختر الخيارات' : 'Choose options'}</span>
              </>
            ) : (
              <>
                <ShoppingCart size={18} strokeWidth={2.4} aria-hidden="true" />
                <span>{isAr ? 'أضف للسلة' : 'Add to cart'}</span>
              </>
            )}
          </span>
          <span className="cc-heart" aria-hidden="true">
            <Heart size={17} strokeWidth={2.2} />
          </span>
          {!needsChoices ? (
            <span className="fc-qty">
              <span className="fc-qty-btn fc-qty-btn--minus">−</span>
              <span className="fc-qty-value">{previewQty}</span>
              <span className="fc-qty-btn fc-qty-btn--plus">+</span>
            </span>
          ) : null}
        </div>
      </article>
    </div>
  );
};
