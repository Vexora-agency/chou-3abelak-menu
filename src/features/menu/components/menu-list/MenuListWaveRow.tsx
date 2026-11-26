import React, { useState } from 'react';
import { Award, Flame, Minus, Pencil, Plus, Sparkles, UtensilsCrossed } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import type { ResolvedMark } from '@/src/utils/cardMark';
import { SmartMenuImage } from '@/src/components/SmartMenuImage';
import { WishlistButton } from '@/src/features/wishlist';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import { priceLabel, effectiveBadges, cartLineKey, hasOptions } from '@/src/utils/pricing';
import './wave.css';

/**
 * Compact layout → soft-wave ribbon.
 *
 * One full-bleed band per item. Even items sit on brand yellow (photo first,
 * copy after); odd items sit on ink (copy first, photo after). A soft wave
 * joins each band to the next one. The band colours are fixed to the brand
 * in both page themes — this section is the poster, the page is the wall.
 *
 * Motion:
 * - media/copy enter through the site-wide reveal observer (data-motion-*);
 * - the dish photo gets a lazy GSAP/ScrollTrigger parallax via the existing
 *   motion layer (`data-gsap-parallax`), so GSAP stays opt-in and deferred.
 */
export interface MenuListWaveRowProps {
  item: MenuItem;
  index: number;
  /** No wave after the last visible band (it would lead nowhere). */
  isLast: boolean;
  /** Phased-collapse fade delay (null = not leaving). See .row-leaving. */
  leaveDelayMs?: number | null;
  /** Post-expansion mounts skip the entrance (never rest invisible). */
  skipEntrance?: boolean | null;
  menu: MenuData;
  lang: 'en' | 'ar';
  currency: string;
  /** Page theme: the alternating band is ink on dark, white on light. */
  darkMode: boolean;
  isAr: boolean;
  qty: number;
  orderingEnabled?: boolean;
  festive?: boolean;
  sectionMark: ResolvedMark;
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
}

const WAVE_Y2B = 'M0,56 C100,6 180,106 295,60 C365,30 425,74 480,40 L480,112 L0,112 Z';
const WAVE_B2Y = 'M0,56 C100,106 180,6 295,52 C365,82 425,38 480,72 L480,112 L0,112 Z';

export const MenuListWaveRow: React.FC<MenuListWaveRowProps> = ({
  item,
  index,
  isLast,
  leaveDelayMs,
  skipEntrance,
  menu,
  lang,
  currency,
  darkMode,
  isAr,
  qty,
  orderingEnabled = true,
  festive = false,
  sectionMark,
  onAddItem,
  onUpdateLine,
  onOpenItem,
}) => {
  const isYellow = index % 2 === 0;
  // Even bands stay brand yellow in both themes. The alternating band is
  // ink on dark pages and white on light pages, so the ribbon keeps the
  // site's black/white language instead of stamping a black block on white.
  const bandTone = isYellow ? 'yellow' : darkMode ? 'black' : 'white';
  const bandIsDark = !isYellow && darkMode;
  const isSoldOut = !item.available;
  const interactive = orderingEnabled && !isSoldOut;
  const name = pickLangText(item.name, lang);
  const desc = pickLangText(item.description, lang).trim();
  const price = priceLabel(item, lang, currency, menu);
  const badges = effectiveBadges(menu, item);
  const badge = badges[0];
  const BadgeIcon = badge === 'top' ? Award : badge === 'new' ? Sparkles : badge === 'spicy' ? Flame : null;
  const options = hasOptions(item);
  const lineKey = cartLineKey(item.id);

  // A broken/removed remote image falls back to the branded category mark,
  // exactly like the photo/grid layouts. `failedSrc` remembers which URL
  // failed, so a changed image retries automatically.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(item.imageUrl) && failedSrc !== (item.imageUrl ?? '');
  const markImg = sectionMark?.kind === 'img' ? sectionMark.src : null;
  const MarkIcon = sectionMark?.kind === 'glyph' ? sectionMark.Comp : null;
  const markTone = bandIsDark ? 'opacity-25' : 'opacity-20';

  const revealProps = (delay: number) =>
    skipEntrance
      ? {}
      : {
          'data-motion-reveal': 'up',
          'data-motion-delay': delay,
          style: { '--fx-dur': '0.7s', '--fx-delay': `${delay}ms` } as React.CSSProperties,
        };

  const media = (
    <div className="wave-media" {...revealProps(0)}>
      <div className="wave-frame">
        {showImage ? (
          <div className="wave-frame-imgwrap" data-gsap-parallax="0.035">
            <SmartMenuImage
              item={item}
              name={name}
              sizes="(max-width: 639px) 35vw, 320px"
              onError={() => setFailedSrc(item.imageUrl ?? '')}
              className="wave-frame-img"
              width={800}
              height={800}
            />
          </div>
        ) : (
          <div className={`wave-fallback wave-fallback--${bandTone === 'black' ? 'black' : bandTone === 'white' ? 'white' : 'yellow'}`}>
            {markImg ? (
              <img src={markImg} alt="" aria-hidden="true" className={`max-h-[42%] w-auto max-w-[42%] object-contain ${markTone}`} />
            ) : MarkIcon ? (
              <MarkIcon aria-hidden="true" strokeWidth={1.25} className={`h-14 w-14 sm:h-20 sm:w-20 ${markTone}`} />
            ) : (
              <UtensilsCrossed aria-hidden="true" strokeWidth={1.25} className={`h-14 w-14 sm:h-20 sm:w-20 ${markTone}`} />
            )}
          </div>
        )}
      </div>
    </div>
  );

  const action = (() => {
    if (!interactive) return null;
    if (qty === 0) {
      return (
        <button
          type="button"
          className="wave-add btn-tactile"
          onClick={(e) => {
            e.stopPropagation();
            if (options) onOpenItem(item);
            else onAddItem(item);
          }}
          aria-label={isAr ? `إضافة ${name} إلى السلة` : `Add ${name} to cart`}
        >
          <Plus size={16} strokeWidth={2.8} aria-hidden="true" />
          {isAr ? 'أضف للسلة' : 'Add to cart'}
        </button>
      );
    }
    if (options) {
      return (
        <button
          type="button"
          className="wave-add btn-tactile"
          onClick={(e) => {
            e.stopPropagation();
            onOpenItem(item);
          }}
          aria-label={isAr ? `تعديل ${name} — الكمية ${qty}` : `Edit ${name} — quantity ${qty}`}
        >
          <Pencil size={14} aria-hidden="true" />
          {isAr ? `تعديل · ${qty}` : `Edit · ${qty}`}
        </button>
      );
    }
    return (
      <div
        className="wave-stepper"
        role="group"
        aria-label={isAr ? `كمية ${name}` : `${name} quantity`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onUpdateLine(lineKey, -1)}
          aria-label={isAr ? 'إنقاص الكمية' : 'Decrease quantity'}
        >
          <Minus size={15} strokeWidth={2.8} aria-hidden="true" />
        </button>
        <span className="wave-stepper__qty">{qty}</span>
        <button
          type="button"
          onClick={() => onUpdateLine(lineKey, 1)}
          aria-label={isAr ? 'زيادة الكمية' : 'Increase quantity'}
        >
          <Plus size={15} strokeWidth={2.8} aria-hidden="true" />
        </button>
      </div>
    );
  })();

  const body = (
    <div
      className={`wave-body ${isYellow ? 'wave-body--yellow' : darkMode ? 'wave-body--black' : 'wave-body--white'}`}
      {...revealProps(80)}
    >
      <div className="wave-meta">
        <div className="wave-meta__badges">
          {badge && BadgeIcon && (
            <span className={`wave-badge ${badge === 'spicy' ? 'wave-badge--spicy' : 'wave-badge--brand'}${festive ? ' xmas-badge' : ''}`}>
              <BadgeIcon size={11} strokeWidth={2.8} aria-hidden="true" />
              {badgeLabel(badge, lang)}
            </span>
          )}
          {isSoldOut && (
            <span className="wave-badge wave-badge--soldout">
              {isAr ? 'نفدت الكمية' : 'Sold out'}
            </span>
          )}
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <WishlistButton
            itemId={item.id}
            itemName={name}
            lang={lang}
            darkMode={bandIsDark}
            tone="surface"
            size="sm"
          />
        </div>
      </div>

      <h3 className="wave-title line-clamp-2" dir="auto">
        {name}
      </h3>
      {desc ? (
        <p className="wave-desc line-clamp-3" dir="auto">
          {desc}
        </p>
      ) : null}
      <p className="wave-price" dir="auto">
        {price}
      </p>
      {action ? <div className="wave-action">{action}</div> : null}
    </div>
  );

  return (
    <div
      className={`wave-row${leaveDelayMs != null ? ' row-leaving' : ''}`}
      style={leaveDelayMs != null ? ({ '--leave-d': `${leaveDelayMs}ms` } as React.CSSProperties) : undefined}
      data-item-id={item.id}
    >
      <div
        className={`wave-band wave-band--${bandTone} ${
          interactive ? 'is-interactive' : ''
        } ${isSoldOut ? 'is-soldout' : ''} ${isLast ? 'is-last' : ''}`}
        onClick={() => interactive && onOpenItem(item)}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? `${name} ${price}` : undefined}
        data-testid={`menu-wave-${item.id}`}
        onKeyDown={(e) => {
          if (!interactive || e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenItem(item);
          }
        }}
      >
        {isYellow ? media : body}
        {isYellow ? body : media}
      </div>

      {!isLast && (
        <div
          className={`wave-divider ${
            darkMode
              ? isYellow
                ? 'wave-divider--to-black'
                : 'wave-divider--to-yellow'
              : isYellow
                ? 'wave-divider--to-white'
                : 'wave-divider--white-to-yellow'
          }`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 480 112" preserveAspectRatio="none">
            <path d={isYellow ? WAVE_Y2B : WAVE_B2Y} />
          </svg>
        </div>
      )}
    </div>
  );
};
