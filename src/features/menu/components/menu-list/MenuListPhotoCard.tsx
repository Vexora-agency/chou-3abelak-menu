import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Award, Flame, SlidersHorizontal, Sparkles, UtensilsCrossed } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import type { ResolvedMark } from '@/src/utils/cardMark';
import { SmartMenuImage } from '@/src/components/SmartMenuImage';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import { priceLabel, effectiveBadges, hasOptions } from '@/src/utils/pricing';
import { MenuListItemAction } from './MenuListItemAction';

interface MenuListPhotoCardProps {
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
}
/**
 * Fourth display layout: photo-first cards.
 *
 * The card keeps the menu's offset-shadow language, then adds the one thing
 * text cards cannot carry — a real photo. The yellow price tag overlaps the
 * photo/body seam so price, name and CTA stay scannable in one pass. Hover
 * motion is transform-only (image zoom, light sweep, tag swing, marker
 * underline) so a long menu stays smooth; touch devices get the static card.
 */
export const MenuListPhotoCard: React.FC<MenuListPhotoCardProps> = ({
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
}) => {
  const idx = index;
  const isSoldOut = !item.available;
  const interactive = orderingEnabled && !isSoldOut;
  const descText = pickLangText(item.description, lang).trim();
  const badges = effectiveBadges(menu, item);
  const badge = badges[0];
  const BadgeIcon =
    badge === 'top' ? Award : badge === 'new' ? Sparkles : badge === 'spicy' ? Flame : null;
  const options = hasOptions(item);
  const price = priceLabel(item, lang, currency);
  const name = pickLangText(item.name, lang);
  const showOptionsHint = options || isSoldOut;

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
      initial={skipEntrance ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '100px' }}
      transition={{ duration: 0.55, delay: Math.min(idx, 3) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      style={leaveDelayMs != null ? ({ '--leave-d': `${leaveDelayMs}ms` } as React.CSSProperties) : undefined}
      onClick={() => interactive && onOpenItem(item)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${name} ${price}` : undefined}
      data-testid={`menu-photo-${item.id}`}
      data-item-id={item.id}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenItem(item);
        }
      }}
      className={`photo-card group relative flex flex-col overflow-hidden rounded-2xl border-2 ${
        darkMode ? 'bg-[#141414] border-[var(--primary)]' : 'bg-white border-[#0A0A0A] photo-card-soft'
      } ${interactive ? 'cursor-pointer photo-card-interactive' : isSoldOut ? 'opacity-60 cursor-not-allowed' : ''}${
        leaveDelayMs != null ? ' row-leaving' : ''
      }`}
    >
      <div className="relative">
        <div className="relative aspect-[16/10] overflow-hidden">
          {showImage ? (
            <SmartMenuImage
              item={item}
              name={name}
              sizes="(max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw"
              eager={eager}
              onError={() => setFailedSrc(item.imageUrl ?? '')}
              className="photo-card-img absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div
              className={`absolute inset-0 flex items-center justify-center ${
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
                <MarkIcon aria-hidden="true" strokeWidth={1.25} className={`h-16 w-16 sm:h-20 sm:w-20 ${markTone}`} />
              ) : (
                <UtensilsCrossed
                  aria-hidden="true"
                  strokeWidth={1.25}
                  className={`h-16 w-16 sm:h-20 sm:w-20 ${markTone}`}
                />
              )}
            </div>
          )}

          {/* Bottom scrim keeps the photo readable behind the tag; the light
              sweep only paints while the card is hovered (fine pointers). */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-black/10"
          />
          <span aria-hidden="true" className="photo-card-shine" />

          {badge && BadgeIcon && (
            <span className={`absolute start-3 top-3 z-10 inline-flex -rotate-2 items-center gap-1 rounded-full border-2 px-2.5 py-1 text-[10px] font-black shadow-[2px_2px_0_#0A0A0A] rtl:rotate-2 ${
              badge === 'spicy'
                ? 'border-red-600/25 bg-red-600/10 text-red-600 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-400'
                : 'border-[#0A0A0A] bg-[var(--primary)] text-[#0A0A0A]'
            }`}>
              <BadgeIcon size={11} strokeWidth={3} aria-hidden="true" className={badge === 'spicy' ? 'fill-red-500/25' : undefined} />
              {badgeLabel(badge, lang)}
            </span>
          )}

          {isSoldOut && (
            <div className="absolute inset-0 z-[15] flex items-center justify-center bg-black/55">
              <span className="rounded-full border-2 border-white/80 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-white">
                {isAr ? 'نفذت' : 'Sold out'}
              </span>
            </div>
          )}
        </div>

        {/* Price tag: half on the photo, half on the body — the card's
            signature element and the fastest price read in the section. */}
        <span className="photo-card-ticket absolute bottom-[-12px] start-3 z-20 inline-flex items-center rounded-lg border-2 border-[#0A0A0A] bg-[var(--primary)] px-2 py-0.5 text-[10.5px] font-black text-[#0A0A0A] shadow-[3px_3px_0_#0A0A0A] rtl:shadow-[-3px_3px_0_#0A0A0A] sm:bottom-[-14px] sm:start-4 sm:px-2.5 sm:py-1 sm:text-[12px]">
          <bdi>{price}</bdi>
        </span>
      </div>

      <div className="relative flex flex-1 flex-col p-3 pt-5 sm:p-4 sm:pt-6">
        <h3
          dir="auto"
          className={`photo-card-title w-fit max-w-full text-[14px] font-black leading-snug line-clamp-2 sm:text-[17px] ${
            darkMode ? 'text-white' : 'text-[#0A0A0A]'
          }`}
        >
          {name}
        </h3>

        {/* Compact 2-up phones skip the description (a ~150px column fits
            ~3 words a line); sm+ keeps the reserved 2-line slot. `hidden`
            loses to `sm:line-clamp-2` (display) above the breakpoint. */}
        {descText && (
          <p
            dir="auto"
            className={`mb-2 mt-1 hidden text-[11px] sm:mb-3 sm:mt-1.5 sm:line-clamp-2 sm:min-h-[2.6em] sm:text-[11.5px] ${isAr ? 'leading-relaxed' : 'leading-[1.55]'} ${
              darkMode ? 'text-neutral-400' : 'text-neutral-600'
            }`}
          >
            {descText}
          </p>
        )}

        <div className={`mt-auto flex items-center justify-between gap-2 border-t border-dashed pt-2 sm:pt-3 ${
          darkMode ? 'border-neutral-800' : 'border-neutral-200'
        }`}>
          {showOptionsHint ? (
            <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold ${darkMode ? 'text-neutral-500' : 'text-neutral-500'}`}>
              <SlidersHorizontal size={12} aria-hidden="true" />
              {isSoldOut ? (isAr ? 'غير متوفر' : 'Unavailable') : isAr ? 'خيارات' : 'Options'}
            </span>
          ) : (
            <span aria-hidden="true" />
          )}

          {!isSoldOut && orderingEnabled && (
            <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <MenuListItemAction
                item={item}
                small={false}
                qty={qty}
                isAr={isAr}
                onAddItem={onAddItem}
                onUpdateLine={onUpdateLine}
                onOpenItem={onOpenItem}
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
