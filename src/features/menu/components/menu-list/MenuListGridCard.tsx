import React, { useState } from 'react';
import { motion } from 'motion/react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import type { CardMarkStyleId, ResolvedMark } from '@/src/utils/cardMark';
import { CardMarkView } from '../CardMark';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import { priceLabel, effectiveBadges } from '@/src/utils/pricing';
import { MenuListItemAction } from './MenuListItemAction';

interface MenuListGridCardProps {
  item: MenuItem;
  index: number;
  /** Phased-collapse fade delay (null = not leaving). See .row-leaving. */
  leaveDelayMs?: number | null;
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
}

export const MenuListGridCard: React.FC<MenuListGridCardProps> = ({
  item,
  index,
  leaveDelayMs,
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
    <motion.div
      key={item.id}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay: Math.min(idx, 5) * 0.06, ease: [0.22, 1, 0.36, 1] }}
      style={leaveDelayMs != null ? ({ '--leave-d': `${leaveDelayMs}ms` } as React.CSSProperties) : undefined}
      onClick={() => interactive && onOpenItem(item)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${pickLangText(item.name, lang)} ${priceLabel(item, lang, currency)}` : undefined}
      data-testid={`menu-card-${item.id}`}
      data-item-id={item.id}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenItem(item);
        }
      }}
      className={`grid-card relative flex flex-col justify-between p-3.5 rounded-2xl border-2 ${mark ? 'overflow-hidden' : ''} ${
        darkMode
          ? 'bg-[#141414] border-[var(--primary)] offset-shadow-dark'
          : 'bg-white border-[#0A0A0A] offset-shadow-yellow'
      } ${interactive ? 'cursor-pointer card-lift' : isSoldOut ? 'opacity-60 cursor-not-allowed' : ''}${leaveDelayMs != null ? ' row-leaving' : ''}`}
    >
      {/* Photo background: the dish behind the card content, sealed to the
          rounded corners by its own clipped wrapper (the card itself clips
          only when the watermark is on). The gradient scrim stays darkest
          behind the price row and badge, lighter mid-card so the photo
          shows through while the name keeps full contrast. */}
      {showPhoto && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            sizes="(max-width: 359px) 100vw, (max-width: 639px) 50vw, (max-width: 1023px) 33vw, (max-width: 1279px) 25vw, 20vw"
            onError={() => setFailedSrc(item.imageUrl ?? '')}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            className={`absolute inset-0 ${
              darkMode
                ? 'bg-gradient-to-t from-black/85 via-black/40 to-black/65'
                : 'bg-gradient-to-t from-white/95 via-white/70 to-white/85'
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
        <div className={`relative flex items-center gap-2 mb-2 h-[18px] ${mark ? 'justify-between' : 'justify-end'}`}>
          {badges.length > 0 && (
            <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-[#0A0A0A] text-[var(--primary)] border-[1.5px] border-[var(--primary)] shadow-lg -rotate-3 ${isAr ? '' : 'tracking-wide'} ${mark ? '' : 'absolute -top-[7px] -start-1 z-10'}`}>
              {badgeLabel(badges[0], lang)}
            </span>
          )}

          {isSoldOut && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-neutral-600 text-white">
              {isAr ? 'نفذت' : 'Sold out'}
            </span>
          )}
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
          {priceLabel(item, lang, currency)}
        </span>

        {!isSoldOut && orderingEnabled && (
          <div onClick={(e) => e.stopPropagation()}>
            <MenuListItemAction item={item} small qty={qty} isAr={isAr} onAddItem={onAddItem} onUpdateLine={onUpdateLine} onOpenItem={onOpenItem} />
          </div>
        )}
      </div>
    </motion.div>
  );
};
