import React from 'react';
import { motion } from 'motion/react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { Flame, Sparkles, Award } from 'lucide-react';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import { priceLabel, effectiveBadges } from '@/src/utils/pricing';
import { MenuListItemAction } from './MenuListItemAction';
import '@/src/features/seasonal/xmas-accents.css';

interface MenuListSectionHeaderProps {
  title: string;
  darkMode: boolean;
  /** Item count pill (total in section, or filtered count while searching). */
  count?: number;
  /** Christmas theme on: frosty bar instead of the gold bar (same size). */
  festive?: boolean;
}

export const MenuListSectionHeader: React.FC<MenuListSectionHeaderProps> = ({
  title,
  darkMode,
  count,
  festive = false,
}) => {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      {festive ? (
        <motion.span
          className="xmas-stocking"
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 26 36" fill="none" aria-hidden="true">
            {/* cuff */}
            <rect x="6" y="1.5" width="14" height="6.5" rx="3" fill="#F7F3EA" />
            <rect x="6" y="5.5" width="14" height="2.5" rx="1.2" fill="#D9E4EC" />
            {/* sock body */}
            <path
              d="M8 8h10v9.5l4.6 3.4c2.4 1.8 2.6 5.3.4 7.2-2 1.8-5.2 1.6-7.2-.2L8 22.4V8Z"
              fill="#C93333"
            />
            <path
              d="M8 8h10v9.5l4.6 3.4c2.4 1.8 2.6 5.3.4 7.2-.6.5-1.3.9-2 1.1C16.6 27 13 24.6 11.4 22L8 18.6V8Z"
              fill="#E04848"
            />
            {/* heel + toe patches */}
            <ellipse cx="9.5" cy="23.5" rx="3.4" ry="2.6" fill="#F7F3EA" transform="rotate(-18 9.5 23.5)" />
            <ellipse cx="19" cy="27.5" rx="3.6" ry="2.6" fill="#F7F3EA" transform="rotate(8 19 27.5)" />
          </svg>
        </motion.span>
      ) : (
      <motion.span
        className="w-1.5 h-6 bg-[var(--primary)] rounded-sm origin-center"
        initial={{ scaleY: 0 }}
        whileInView={{ scaleY: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        aria-hidden="true"
      />
      )}
      <h2 className={`text-xl sm:text-2xl font-extrabold ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
        {title}
      </h2>
      {typeof count === 'number' && (
        <span className={`text-[11px] font-extrabold tabular-nums px-2 py-0.5 rounded-full border ${darkMode ? 'text-neutral-400 border-neutral-800 bg-black/40' : 'text-neutral-600 border-neutral-200 bg-black/5'}`}>
          {count}
        </span>
      )}
    </div>
  );
};

interface MenuListRowProps {
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
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
  /** Menu-only mode (starter): hides ordering UI, rows are not clickable. */
  orderingEnabled?: boolean;
  /** Christmas theme on: snow-capped badges + snowfall add-button. */
  festive?: boolean;
}

export const MenuListCompactRow: React.FC<MenuListRowProps> = ({
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
  onAddItem,
  onUpdateLine,
  onOpenItem,
  orderingEnabled = true,
  festive = false,
}) => {
  const idx = index;
  const isSoldOut = !item.available;
  const interactive = orderingEnabled && !isSoldOut;
  return (
    <motion.div
      key={item.id}
      // No `layout`: it re-measures on every render and animates phantom
      // corrections (e.g. the one-frame rect shift when the details modal
      // locks the body) — the list visibly jolts up and back on tap.
      // Entrance stays on initial/whileInView below; nothing else needs FLIP.
      initial={skipEntrance ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '100px' }}
      transition={{ duration: 0.45, delay: Math.min(idx, 5) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      style={leaveDelayMs != null ? ({ '--leave-d': `${leaveDelayMs}ms` } as React.CSSProperties) : undefined}
      onClick={() => interactive && onOpenItem(item)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${pickLangText(item.name, lang)} ${priceLabel(item, lang, currency, menu)}` : undefined}
      data-testid={`menu-compact-${item.id}`}
      data-item-id={item.id}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenItem(item);
        }
      }}
      className={`group relative flex items-center gap-3 py-3 px-2 -mx-2 rounded-xl border-b transition-colors ${
        darkMode ? 'border-neutral-800 hover:bg-white/[0.04]' : 'border-neutral-200 hover:bg-black/[0.04]'
      } ${interactive ? 'cursor-pointer' : isSoldOut ? 'opacity-60 cursor-not-allowed' : ''}${leaveDelayMs != null ? ' row-leaving' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span dir="auto" className={`font-bold text-sm min-[380px]:text-[15px] truncate transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
            {pickLangText(item.name, lang)}
          </span>
          {effectiveBadges(menu, item).map((b) => (
            <span
              key={b}
              className={`inline-flex shrink-0 items-center gap-0.5 px-1.5 py-px rounded-full text-[10px] font-extrabold bg-[#0A0A0A] text-[var(--primary)] border border-[var(--primary)]${festive ? ' xmas-badge' : ''}`}
            >
                {b === 'spicy' && <Flame size={9} className="fill-[var(--primary)]" />}
                {b === 'top' && <Award size={9} className="fill-[var(--primary)]" />}
                {b === 'new' && <Sparkles size={9} />}
                {badgeLabel(b, lang)}
            </span>
          ))}
          {isSoldOut && (
            <span className="shrink-0 px-2 py-px rounded-full text-[10px] font-bold bg-neutral-600 text-white">
              {isAr ? 'نفدت الكمية' : 'Sold out'}
            </span>
          )}
        </div>
        {pickLangText(item.description, lang).trim() ? (
          <p
            title={pickLangText(item.description, lang)}
            dir="auto"
            className={`text-xs truncate mt-0.5 ${isAr ? 'leading-relaxed' : ''} ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}
          >
            {pickLangText(item.description, lang)}
          </p>
        ) : null}
      </div>
      <span className={`shrink-0 text-sm font-extrabold tabular-nums ${darkMode ? 'text-[var(--primary)]' : 'text-[#0A0A0A]'}`} dir="auto">
        {priceLabel(item, lang, currency, menu)}
      </span>
      {!isSoldOut && orderingEnabled && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0"
        >
          <MenuListItemAction item={item} small qty={qty} isAr={isAr} onAddItem={onAddItem} onUpdateLine={onUpdateLine} onOpenItem={onOpenItem} festive={festive} />
        </div>
      )}
    </motion.div>
  );
};
