import React from 'react';
import { motion } from 'motion/react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { Flame, Sparkles, Award } from 'lucide-react';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import { priceLabel, effectiveBadges } from '@/src/utils/pricing';
import { MenuListItemAction } from './MenuListItemAction';

interface MenuListSectionHeaderProps {
  title: string;
  darkMode: boolean;
  /** Item count pill (total in section, or filtered count while searching). */
  count?: number;
}

export const MenuListSectionHeader: React.FC<MenuListSectionHeaderProps> = ({
  title,
  darkMode,
  count,
}) => {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <motion.span
        className="w-1.5 h-6 bg-[var(--primary)] rounded-sm origin-center"
        initial={{ scaleY: 0 }}
        whileInView={{ scaleY: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        aria-hidden="true"
      />
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
  menu: MenuData;
  lang: 'en' | 'ar';
  currency: string;
  darkMode: boolean;
  isAr: boolean;
  qty: number;
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
}

export const MenuListCompactRow: React.FC<MenuListRowProps> = ({
  item,
  index,
  menu,
  lang,
  currency,
  darkMode,
  isAr,
  qty,
  onAddItem,
  onUpdateLine,
  onOpenItem,
}) => {
  const idx = index;
  const isSoldOut = !item.available;
  return (
    <motion.div
      key={item.id}
      layout
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, delay: Math.min(idx, 5) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => !isSoldOut && onOpenItem(item)}
      className={`group relative flex items-center gap-3 py-3 px-2 -mx-2 rounded-xl border-b transition-colors ${
        darkMode ? 'border-neutral-800 hover:bg-white/[0.04]' : 'border-neutral-200 hover:bg-black/[0.04]'
      } ${isSoldOut ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`font-bold text-[15px] truncate transition-transform group-hover:translate-x-0.5 ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
            {pickLangText(item.name, lang)}
          </span>
          {effectiveBadges(menu, item).map((b) => (
            <span
              key={b}
              className="inline-flex shrink-0 items-center gap-0.5 px-1.5 py-px rounded-full text-[9px] font-extrabold bg-[#0A0A0A] text-[var(--primary)] border border-[var(--primary)]"
            >
                {b === 'spicy' && <Flame size={9} className="fill-[var(--primary)]" />}
                {b === 'top' && <Award size={9} className="fill-[var(--primary)]" />}
                {b === 'new' && <Sparkles size={9} />}
                {badgeLabel(b, lang)}
            </span>
          ))}
          {isSoldOut && (
            <span className="shrink-0 px-2 py-px rounded-full text-[10px] font-bold bg-neutral-600 text-white">
              {isAr ? 'نفذت الكمية' : 'Sold out'}
            </span>
          )}
        </div>
        {pickLangText(item.description, lang).trim() ? (
          <p
            title={pickLangText(item.description, lang)}
            className={`text-xs truncate mt-0.5 ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}
          >
            {pickLangText(item.description, lang)}
          </p>
        ) : null}
      </div>
      <span className={`shrink-0 text-sm font-extrabold tabular-nums ${darkMode ? 'text-[var(--primary)]' : 'text-[#0A0A0A]'}`} dir="ltr">
        {priceLabel(item, lang, currency)}
      </span>
      {!isSoldOut && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0"
        >
          <MenuListItemAction item={item} small qty={qty} isAr={isAr} onAddItem={onAddItem} onUpdateLine={onUpdateLine} onOpenItem={onOpenItem} />
        </div>
      )}
    </motion.div>
  );
};
