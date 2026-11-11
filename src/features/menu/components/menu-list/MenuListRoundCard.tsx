import React, { useState } from 'react';
import { motion } from 'motion/react';
import { UtensilsCrossed } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import type { ResolvedMark } from '@/src/utils/cardMark';
import { SmartMenuImage } from '@/src/components/SmartMenuImage';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import { priceLabel, effectiveBadges } from '@/src/utils/pricing';
import { MenuListItemAction } from './MenuListItemAction';
import '@/src/features/seasonal/xmas-accents.css';

interface MenuListRoundCardProps {
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
  /** Category mark, reused as the branded stand-in when an item has no photo. */
  sectionMark: ResolvedMark;
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
  /** Menu-only mode (starter): hides ordering UI, cards are not clickable. */
  orderingEnabled?: boolean;
  /** First-row images load eager (passed from MenuList for index < 2). */
  eager?: boolean;
  /** Christmas theme on: snow-capped badge + snowfall add-button. */
  festive?: boolean;
}

/**
 * Fifth display layout: round dish photo in a branded gold ring.
 *
 * Compact centered card (black/gold rotated badge, framed conic ring photo,
 * name, description, price + real cart action — no wishlist heart by owner
 * call). The layered elevation, ring frame, entrance pop and hover lift/zoom
 * all live in components.css next to the photo-card language this card reuses
 * (hover lift, image zoom, shine).
 */
export const MenuListRoundCard: React.FC<MenuListRoundCardProps> = ({
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
  onAddItem,
  onUpdateLine,
  onOpenItem,
  orderingEnabled = true,
  eager = false,
  festive = false,
}) => {
  const idx = index;
  const isSoldOut = !item.available;
  const interactive = orderingEnabled && !isSoldOut;
  const descText = pickLangText(item.description, lang).trim();
  const badges = effectiveBadges(menu, item);
  const name = pickLangText(item.name, lang);
  const price = priceLabel(item, lang, currency);

  // A broken/removed remote image must never leave a blank hole: fall back to
  // the branded category placeholder exactly like an item without a photo.
  // `failedSrc` records WHICH url broke — a changed url retries automatically.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(item.imageUrl) && failedSrc !== (item.imageUrl ?? '');

  const markImg = sectionMark?.kind === 'img' ? sectionMark.src : null;
  const MarkIcon = sectionMark?.kind === 'glyph' ? sectionMark.Comp : null;
  const markTone = darkMode
    ? 'text-[var(--primary)] opacity-25'
    : 'text-[#0A0A0A] opacity-20';

  return (
    <motion.div
      key={item.id}
      initial={skipEntrance ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '100px' }}
      transition={{ duration: 0.5, delay: Math.min(idx, 5) * 0.06, ease: [0.22, 1, 0.36, 1] }}
      style={leaveDelayMs != null ? ({ '--leave-d': `${leaveDelayMs}ms` } as React.CSSProperties) : undefined}
      onClick={() => interactive && onOpenItem(item)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${name} ${price}` : undefined}
      data-testid={`menu-round-${item.id}`}
      data-item-id={item.id}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenItem(item);
        }
      }}
      className={`round-card group relative flex min-h-[224px] flex-col items-center rounded-[24px] border px-3 pt-[13px] pb-3.5 text-center ${
        darkMode ? '' : 'round-card-light'
      } ${interactive ? 'cursor-pointer card-lift' : isSoldOut ? 'opacity-60 cursor-not-allowed' : ''}${
        leaveDelayMs != null ? ' row-leaving' : ''
      }`}
    >
      {badges.length > 0 && (
        <span
          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-[#0A0A0A] text-[var(--primary)] border-[1.5px] border-[var(--primary)] shadow-lg -rotate-3 absolute -top-[7px] -start-1 z-10${festive ? ' xmas-badge' : ''} ${
            isAr ? '' : 'tracking-wide'
          }`}
        >
          {badgeLabel(badges[0], lang)}
        </span>
      )}

      <div className="round-ring relative mb-3 mt-px h-[116px] w-[116px] shrink-0 rounded-full p-1">
        <span className="round-photo relative block h-full w-full overflow-hidden rounded-full">
          {showImage ? (
            <SmartMenuImage
              item={item}
              name={name}
              sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 20vw"
              eager={eager}
              // No shimmer/fade here: dish-pop owns this element's `animation`
              // and the .round-photo well already covers the loading state.
              plain
              onError={() => setFailedSrc(item.imageUrl ?? '')}
              className={`photo-card-img dish-pop block h-full w-full rounded-full border-2 object-cover ${
                darkMode ? 'border-[#141414]' : 'border-white'
              }`}
            />
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center rounded-full ${
                darkMode ? 'photo-placeholder' : 'photo-placeholder-light'
              }`}
            >
              {markImg ? (
                <img
                  src={markImg}
                  alt=""
                  aria-hidden="true"
                  className={`max-h-[42%] w-auto max-w-[42%] object-contain ${markTone}`}
                />
              ) : MarkIcon ? (
                <MarkIcon aria-hidden="true" strokeWidth={1.25} className={`h-10 w-10 ${markTone}`} />
              ) : (
                <UtensilsCrossed
                  aria-hidden="true"
                  strokeWidth={1.25}
                  className={`h-10 w-10 ${markTone}`}
                />
              )}
            </span>
          )}
          <span aria-hidden="true" className="photo-card-shine" />
        </span>
      </div>

      <h3
        dir="auto"
        className={`w-full text-[13.5px] font-extrabold leading-snug tracking-[-0.025em] line-clamp-1 sm:text-sm ${
          darkMode ? 'text-white' : 'text-[#0A0A0A]'
        }`}
      >
        {name}
      </h3>

      {/* Description only when the admin wrote one: without it the title
          sits closer to the price + action instead of floating over an
          empty reserved slot. */}
      {descText ? (
        <p
          dir="auto"
          className={`mt-1.5 mb-2.5 w-full max-w-[145px] text-center text-[10.5px] leading-[1.45] line-clamp-2 min-h-[2.6em] ${isAr ? 'leading-relaxed' : ''} ${
            darkMode ? 'text-neutral-400' : 'text-neutral-600'
          }`}
        >
          {descText}
        </p>
      ) : null}

      {/* Vertical stack (phones first): name, description, price, then the
          add action under it — side-by-side squeezes Arabic prices and the
          button into ~150px columns. */}
      <div className="mt-auto flex flex-col items-center gap-1.5 pt-2.5">
        <span className={`text-[13.5px] font-extrabold tracking-[-0.03em] tabular-nums ${darkMode ? 'text-[var(--primary)]' : 'text-[#0A0A0A]'}`} dir="auto">
          {price}
        </span>

        {!isSoldOut && orderingEnabled ? (
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <MenuListItemAction item={item} small qty={qty} isAr={isAr} onAddItem={onAddItem} onUpdateLine={onUpdateLine} onOpenItem={onOpenItem} festive={festive} />
          </div>
        ) : (
          isSoldOut && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-neutral-600 text-white">
              {isAr ? 'نفذت' : 'Sold out'}
            </span>
          )
        )}
      </div>
    </motion.div>
  );
};
