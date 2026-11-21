import React, { useState } from 'react';
import { Flame } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import type { CardMarkStyleId, ResolvedMark } from '@/src/utils/cardMark';
import { SmartMenuImage } from '@/src/components/SmartMenuImage';
import { CardMarkView } from '../CardMark';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import { priceLabel, effectiveBadges } from '@/src/utils/pricing';
import { WishlistButton } from '@/src/features/wishlist';
import { MenuListItemAction } from './MenuListItemAction';
import '@/src/features/seasonal/xmas-accents.css';

interface MenuListGridCardProps {
  item: MenuItem;
  index: number;
  /** Phased-collapse fade delay (null = not leaving). See .row-leaving. */
  leaveDelayMs?: number | null;
  /** Post-expansion mounts skip the scroll entrance (never rest invisible). */
  skipEntrance?: boolean | null;
  menu: MenuData;
  lang: 'en' | 'ar';
  currency: string;
  darkMode: boolean;
  isAr: boolean;
  qty: number;
  sectionMark: ResolvedMark;
  markStyle: CardMarkStyleId;
  markOpacity: number;
  markX: number;
  markY: number;
  markScale: number;
  markRotate: number;
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
  /** Menu-only mode (starter): hides ordering UI, cards are not clickable. */
  orderingEnabled?: boolean;
  /** Christmas theme on: snow-capped badge + snowfall add-button. */
  festive?: boolean;
}

export const MenuListGridCard: React.FC<MenuListGridCardProps> = ({
  item,
  index,
  leaveDelayMs,
  skipEntrance,
  menu,
  lang,
  currency,
  darkMode,
  isAr,
  qty,
  sectionMark,
  markStyle,
  markOpacity,
  markX,
  markY,
  markScale,
  markRotate,
  onAddItem,
  onUpdateLine,
  onOpenItem,
  orderingEnabled = true,
  festive = false,
}) => {
  const idx = index;
  const isSoldOut = !item.available;
  const interactive = orderingEnabled && !isSoldOut;
  const descText = pickLangText(item.description, lang).trim();
  const badges = effectiveBadges(menu, item);

  // Item photo as the card background. A broken/removed image falls back to
  // the plain text card exactly (same pattern as MenuListPhotoCard).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = Boolean(item.imageUrl) && failedSrc !== (item.imageUrl ?? '');
  // The faint category watermark would fight the photo — photo wins.
  const mark = sectionMark && !showPhoto ? sectionMark : null;

  return (
    <div
      key={item.id}
      data-motion-reveal={skipEntrance ? undefined : 'scale'}
      data-motion-delay={skipEntrance ? undefined : Math.min(idx, 5) * 60}
      style={
        skipEntrance
          ? leaveDelayMs != null
            ? ({ '--leave-d': `${leaveDelayMs}ms` } as React.CSSProperties)
            : undefined
          : ({
              '--leave-d': leaveDelayMs != null ? `${leaveDelayMs}ms` : undefined,
              '--fx-delay': `${Math.min(idx, 5) * 60}ms`,
              '--fx-dur': '0.55s',
            } as React.CSSProperties)
      }
      onClick={() => interactive && onOpenItem(item)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${pickLangText(item.name, lang)} ${priceLabel(item, lang, currency, menu)}` : undefined}
      data-testid={`menu-card-${item.id}`}
      data-item-id={item.id}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenItem(item);
        }
      }}
      className={`menu-cv-grid grid-card relative flex flex-col justify-between p-3.5 rounded-2xl border-2 ${mark ? 'overflow-hidden' : ''} ${
        darkMode
          ? 'bg-[#141414] border-[var(--primary)] offset-shadow-dark'
          : 'bg-white border-[#0A0A0A] offset-shadow-yellow grid-card-soft'
      } ${interactive ? 'cursor-pointer card-lift' : isSoldOut ? 'opacity-60 cursor-not-allowed' : ''}${leaveDelayMs != null ? ' row-leaving' : ''}`}
    >
      {/* Photo background: the dish behind the card content, sealed to the
          rounded corners by its own clipped wrapper (the card itself clips
          only when the watermark is on). The gradient scrim stays darkest
          behind the price row and badge, lighter mid-card so the photo
          shows through while the name keeps full contrast. */}
      {showPhoto && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <SmartMenuImage
            item={item}
            name=""
            sizes="(max-width: 359px) 100vw, (max-width: 639px) 50vw, (max-width: 1023px) 33vw, (max-width: 1279px) 25vw, 20vw"
            onError={() => setFailedSrc(item.imageUrl ?? '')}
            className="grid-card-photo absolute inset-0 h-full w-full object-cover"
          />
          <div
            className={`absolute inset-0 ${
              darkMode
                ? 'bg-gradient-to-t from-black/85 via-black/40 to-black/65'
                : 'bg-gradient-to-t from-white/80 via-white/40 to-white/65'
            }`}
          />
        </div>
      )}
      {/* Watermark on every card of the section (shared
          renderer — same as the admin live preview).
          Text always paints above the faint mark. */}
      {mark && (
        <CardMarkView
          mark={mark}
          style={markStyle}
          opacity01={markOpacity}
          x={markX}
          y={markY}
          rotate={markRotate}
          dark={darkMode}
          scale01={markScale}
          size="full"
          interactive
        />
      )}
      <div className="relative flex-1 flex flex-col">
        {/* Badges: top corner, mirrored per direction (left in EN, right in AR)
            so it always balances diagonally against the + button. Tilted. */}
        <div className={`relative flex items-center gap-2 mb-1.5 min-h-[36px] ${mark ? 'justify-between' : 'justify-end'}`}>
          {badges.length > 0 && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold border-[1.5px] shadow-lg -rotate-3 ${isAr ? '' : 'tracking-wide'} ${mark ? '' : 'absolute -top-[7px] -start-1 z-10'}${festive ? ' xmas-badge' : ''} ${
              badges[0] === 'spicy'
                ? 'bg-red-600/10 text-red-600 border-red-600/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-400/30'
                : 'bg-[#0A0A0A] text-[var(--primary)] border-[var(--primary)]'
            }`}>
              {badges[0] === 'spicy' && <Flame size={11} className="fill-red-500/25" aria-hidden="true" />}
              {badgeLabel(badges[0], lang)}
            </span>
          )}

          {isSoldOut && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-neutral-600 text-white">
              {isAr ? 'نفدت' : 'Sold out'}
            </span>
          )}

          {/* The heart rides the badge row: enough height for a 44px target
              without squeezing the price + cart action on narrow 2-up cards. */}
          <WishlistButton
            itemId={item.id}
            itemName={pickLangText(item.name, lang)}
            lang={lang}
            darkMode={darkMode}
            tone={showPhoto ? 'overlay' : 'surface'}
            size="sm"
            className="ms-auto"
          />
        </div>

        {descText ? (
          <>
            <h3
              dir="auto"
              className={`text-center font-black text-[20px] min-[380px]:text-[22px] leading-[1.25] line-clamp-1 -rotate-2 ${
                darkMode ? 'text-white' : 'text-[#0A0A0A]'
              }`}
            >
              {pickLangText(item.name, lang)}
            </h3>

            {/* Reserved 2-line description slot: uniform grid, no voids. */}
            <p
              dir="auto"
              className={`text-center text-[11px] mt-1 line-clamp-2 min-h-[2.6em] ${isAr ? 'leading-relaxed' : ''} ${
                darkMode ? 'text-neutral-400' : 'text-neutral-600'
              }`}
            >
              {descText}
            </p>
          </>
        ) : (
          /* No description: the name takes the card — big, centered and
             slightly tilted instead of an empty void. Same footprint. */
          <div className="flex-1 flex items-center justify-center py-1">
            <h3
              dir="auto"
              className={`text-center font-black text-[20px] min-[380px]:text-[22px] leading-[1.25] line-clamp-3 -rotate-2 ${
                darkMode ? 'text-white' : 'text-[#0A0A0A]'
              }`}
            >
              {pickLangText(item.name, lang)}
            </h3>
          </div>
        )}
      </div>

      {/* Price and Cart Action */}
      <div className={`relative flex justify-between items-center mt-3 pt-2 border-t border-dashed ${
        darkMode ? 'border-neutral-800' : 'border-neutral-200'
      }`}>
        <span className={`font-extrabold text-sm tabular-nums ${darkMode ? 'text-[var(--primary)]' : 'text-[#0A0A0A]'}`} dir="auto">
          {priceLabel(item, lang, currency, menu)}
        </span>

        {!isSoldOut && orderingEnabled && (
          <div onClick={(e) => e.stopPropagation()}>
            <MenuListItemAction item={item} small qty={qty} isAr={isAr} onAddItem={onAddItem} onUpdateLine={onUpdateLine} onOpenItem={onOpenItem} festive={festive} />
          </div>
        )}
      </div>
    </div>
  );
};
