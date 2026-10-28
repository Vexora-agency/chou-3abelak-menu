import React from 'react';
import { motion } from 'motion/react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { Flame, Sparkles, Award } from 'lucide-react';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import { priceLabel, effectiveBadges } from '@/src/utils/pricing';
import { MenuListItemAction } from './MenuListItemAction';

interface MenuListListRowProps {
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

export const MenuListListRow: React.FC<MenuListListRowProps> = ({
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
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay: Math.min(idx, 5) * 0.06, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => !isSoldOut && onOpenItem(item)}
      className={`group relative pb-4 border-b transition-colors ${
        darkMode ? 'border-neutral-800' : 'border-neutral-200'
      } ${isSoldOut ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {/* Name, Badges, Price (+ action when there is no
          description, so the + never dangles on an empty row) */}
      {pickLangText(item.description, lang).trim() ? (
      <>
      <div className="flex items-baseline gap-2">
        <span
          className={`font-bold text-base transition-transform group-hover:translate-x-1 ${
            darkMode ? 'text-white' : 'text-[#0A0A0A]'
          }`}
        >
          {pickLangText(item.name, lang)}
        </span>

        {/* Badges (effective: stored + automatic NEW) */}
        {effectiveBadges(menu, item).map((b) => (
          <span
            key={b}
            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#0A0A0A] text-[var(--primary)] border border-[var(--primary)]"
          >
            {b === 'spicy' && <Flame size={10} className="fill-[var(--primary)]" />}
            {b === 'top' && <Award size={10} className="fill-[var(--primary)]" />}
            {b === 'new' && <Sparkles size={10} />}
                        {badgeLabel(b, lang)}
          </span>
        ))}

        {isSoldOut && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-600 text-white">
            {isAr ? 'نفذت الكمية' : 'Sold out'}
          </span>
        )}

        {/* Price Pill */}
        <span className="ms-auto px-3 py-1 rounded-full text-sm font-extrabold bg-[var(--primary)] text-[#0A0A0A] shadow-sm flex-shrink-0 group-hover:scale-105 transition-transform">
          {priceLabel(item, lang, currency)}
        </span>
      </div>

      {/* Description & Add/Stepper Row */}
      <div className="flex justify-between items-start gap-4 mt-2">
        <p
          className={`text-xs leading-relaxed flex-1 ${
            darkMode ? 'text-neutral-400' : 'text-neutral-600'
          }`}
        >
          {pickLangText(item.description, lang)}
        </p>

        {/* Action Control: Add Button or Stepper */}
        {!isSoldOut && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex-shrink-0"
          >
            <MenuListItemAction item={item} small={false} qty={qty} isAr={isAr} onAddItem={onAddItem} onUpdateLine={onUpdateLine} onOpenItem={onOpenItem} />
          </div>
        )}
      </div>
      </>
      ) : (
      /* No description: single balanced row — name left,
         price + action right, no empty second row. */
      <div className="flex items-center gap-2">
        <span
          className={`font-bold text-base min-w-0 flex-1 truncate transition-transform group-hover:translate-x-1 ${
            darkMode ? 'text-white' : 'text-[#0A0A0A]'
          }`}
        >
          {pickLangText(item.name, lang)}
        </span>

        {effectiveBadges(menu, item).map((b) => (
          <span
            key={b}
            className="shrink-0 inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#0A0A0A] text-[var(--primary)] border border-[var(--primary)]"
          >
            {b === 'spicy' && <Flame size={10} className="fill-[var(--primary)]" />}
            {b === 'top' && <Award size={10} className="fill-[var(--primary)]" />}
            {b === 'new' && <Sparkles size={10} />}
                        {badgeLabel(b, lang)}
          </span>
        ))}

        {isSoldOut && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-600 text-white">
            {isAr ? 'نفذت الكمية' : 'Sold out'}
          </span>
        )}

        <span className="ms-auto px-3 py-1 rounded-full text-sm font-extrabold bg-[var(--primary)] text-[#0A0A0A] shadow-sm flex-shrink-0 transition-transform group-hover:scale-105">
          {priceLabel(item, lang, currency)}
        </span>

        {!isSoldOut && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex-shrink-0"
          >
            <MenuListItemAction item={item} small={false} qty={qty} isAr={isAr} onAddItem={onAddItem} onUpdateLine={onUpdateLine} onOpenItem={onOpenItem} />
          </div>
        )}
      </div>
      )}
    </motion.div>
  );
};
