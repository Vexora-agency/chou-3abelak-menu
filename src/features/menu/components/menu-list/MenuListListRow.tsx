import React, { useState } from 'react';
import { Flame, Sparkles, Award, UtensilsCrossed } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import type { ResolvedMark } from '@/src/utils/cardMark';
import { SmartMenuImage } from '@/src/components/SmartMenuImage';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import { priceLabel, effectiveBadges } from '@/src/utils/pricing';
import { WishlistButton } from '@/src/features/wishlist';
import { MenuListItemAction } from './MenuListItemAction';
import '@/src/features/seasonal/xmas-accents.css';

interface MenuListListRowProps {
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
  /** Menu-only mode (starter): hides ordering UI, rows are not clickable. */
  orderingEnabled?: boolean;
  /** Christmas theme on: snow-capped badge + snowfall add-button. */
  festive?: boolean;
}

/**
 * The `list` layout: a compact horizontal product card with a real photo,
 * name/description/price, and a narrow action column (bare wishlist heart on
 * top, icon-only add/stepper at the bottom). Modelled on the owner's compact
 * menu reference, translated into the site's black/gold language and its
 * light/dark/RTL rules.
 */
export const MenuListListRow: React.FC<MenuListListRowProps> = ({
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
  festive = false,
}) => {
  const idx = index;
  const isSoldOut = !item.available;
  const interactive = orderingEnabled && !isSoldOut;
  const name = pickLangText(item.name, lang);
  const description = pickLangText(item.description, lang).trim();
  const badges = effectiveBadges(menu, item);
  const topBadge = badges[0];

  // Broken/removed photo: fall back to the branded category mark exactly like
  // the photo cards. `failedSrc` records WHICH url broke, so a changed url
  // retries automatically.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(item.imageUrl) && failedSrc !== (item.imageUrl ?? '');
  const markImg = sectionMark?.kind === 'img' ? sectionMark.src : null;
  const MarkIcon = sectionMark?.kind === 'glyph' ? sectionMark.Comp : null;
  const markTone = darkMode
    ? 'text-[var(--primary)] opacity-30'
    : 'text-[#0A0A0A] opacity-20';

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
      aria-label={interactive ? `${name} ${priceLabel(item, lang, currency, menu)}` : undefined}
      data-testid={`menu-row-${item.id}`}
      data-item-id={item.id}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenItem(item);
        }
      }}
      className={`menu-cv-list group relative flex h-[116px] sm:h-[128px] w-full rounded-2xl border p-1.5 sm:p-2 shadow-sm transition-colors hover:shadow-md ${
        darkMode
          ? 'border-[var(--primary)]/25 bg-[#141414] hover:border-[var(--primary)]/60'
          : 'border-[#0A0A0A]/15 bg-white hover:border-[var(--primary)]'
      } ${interactive ? 'cursor-pointer card-lift' : isSoldOut ? 'opacity-70 cursor-not-allowed' : ''}${
        leaveDelayMs != null ? ' row-leaving' : ''
      }`}
    >
      {/* Photo (or branded stand-in), with the automatic badge overlaid. */}
      <div
        className={`relative w-[38%] sm:w-[36%] shrink-0 self-stretch overflow-hidden rounded-xl border ${
          darkMode ? 'border-white/10' : 'border-black/5'
        }`}
      >
        {showImage ? (
          <SmartMenuImage
            item={item}
            name={name}
            sizes="(max-width: 639px) 40vw, 260px"
            onError={() => setFailedSrc(item.imageUrl ?? '')}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
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
                className={`max-h-[44%] w-auto max-w-[44%] object-contain ${markTone}`}
              />
            ) : MarkIcon ? (
              <MarkIcon aria-hidden="true" strokeWidth={1.35} className={`h-10 w-10 ${markTone}`} />
            ) : (
              <UtensilsCrossed aria-hidden="true" strokeWidth={1.35} className={`h-10 w-10 ${markTone}`} />
            )}
          </div>
        )}

        {/* Bottom scrim: keeps a badge/label legible on a bright photo. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10"
        />

        {topBadge && (
          <span
            className={`absolute start-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black shadow-sm ${
              topBadge === 'spicy'
                ? 'border-red-500/40 bg-red-600/85 text-white'
                : 'border-[var(--primary)] bg-[#0A0A0A] text-[var(--primary)]'
            }${festive ? ' xmas-badge' : ''}`}
          >
            {topBadge === 'spicy' && <Flame size={9} className="fill-white/30" aria-hidden="true" />}
            {topBadge === 'top' && <Award size={9} className="fill-[var(--primary)]" aria-hidden="true" />}
            {topBadge === 'new' && <Sparkles size={9} aria-hidden="true" />}
            {badgeLabel(topBadge, lang)}
          </span>
        )}

        {isSoldOut && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center bg-black/55">
            <span className="rounded-full border border-white/70 px-2 py-0.5 text-[9px] font-black text-white">
              {isAr ? 'نفدت' : 'Sold out'}
            </span>
          </div>
        )}
      </div>

      {/* Name / description / price. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5 sm:px-3.5">
        <h3
          dir="auto"
          className={`line-clamp-2 text-[14px] min-[380px]:text-[15px] sm:text-[17px] font-extrabold leading-[1.25] transition-transform duration-300 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 ${
            darkMode ? 'text-white' : 'text-[#0A0A0A]'
          }`}
        >
          {name}
        </h3>
        {description && (
          <p
            dir="auto"
            title={description}
            className={`mt-0.5 line-clamp-2 text-[10.5px] min-[380px]:text-[11px] sm:text-[11.5px] leading-[1.35] ${
              darkMode ? 'text-neutral-400' : 'text-neutral-500'
            }`}
          >
            {description}
          </p>
        )}
        <span
          dir="auto"
          className={`mt-1 text-[14px] min-[380px]:text-[15px] sm:text-[17px] font-black leading-none tabular-nums ${
            darkMode ? 'text-[var(--primary)]' : 'text-[#8a6d00]'
          }`}
        >
          {priceLabel(item, lang, currency, menu)}
        </span>
      </div>

      {/* Action column: bare heart on top, icon-only add/stepper at the
          bottom — the reference's layout, kept to the site's black/gold UI. */}
      <div
        className="flex w-12 sm:w-[54px] shrink-0 flex-col items-center justify-between"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-9 items-start justify-center">
          <WishlistButton
            itemId={item.id}
            itemName={name}
            lang={lang}
            darkMode={darkMode}
            variant="bare"
            size="sm"
          />
        </div>

        {!isSoldOut && orderingEnabled && (
          <MenuListItemAction
            item={item}
            small
            qty={qty}
            isAr={isAr}
            onAddItem={onAddItem}
            onUpdateLine={onUpdateLine}
            onOpenItem={onOpenItem}
            festive={festive}
            layout="vertical"
          />
        )}
      </div>
    </div>
  );
};
