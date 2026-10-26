import React from 'react';
import { motion } from 'motion/react';
import { MenuData, MenuItem, Category, CartLine } from '../types/menu';
import { Plus, Minus, Flame, Sparkles, Award } from 'lucide-react';
import { pickLangText } from '../utils/menuHelpers';
import { cartLineKey, hasOptions, priceLabel, effectiveBadges } from '../utils/pricing';

interface MenuListProps {
  categories: Category[];
  items: MenuItem[];
  menu: MenuData;
  selectedCategory: string;
  searchQuery: string;
  selectedBadge: string | null;
  cart: Record<string, CartLine>;
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

export const MenuList: React.FC<MenuListProps> = ({
  categories,
  items,
  menu,
  selectedCategory,
  searchQuery,
  selectedBadge,
  cart,
  onAddItem,
  onUpdateLine,
  onOpenItem,
  currency,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';
  const cleanQ = searchQuery.trim().toLowerCase();

  // Filter items
  const filteredItems = items.filter((item) => {
    const matchesCategory = selectedCategory === 'all' || item.categoryId === selectedCategory;
    if (!matchesCategory) return false;

    // Badge quick-filter (single-select) — uses effective badges (auto NEW included)
    if (selectedBadge && !effectiveBadges(menu, item).includes(selectedBadge)) return false;

    if (!cleanQ) return true;
    const nameMatch =
      item.name.en.toLowerCase().includes(cleanQ) ||
      item.name.ar.toLowerCase().includes(cleanQ);
    const descMatch =
      item.description.en.toLowerCase().includes(cleanQ) ||
      item.description.ar.toLowerCase().includes(cleanQ);

    return nameMatch || descMatch;
  });

  if (filteredItems.length === 0) {
    return (
      <div className="py-16 px-5 text-center">
        <div className="w-16 h-16 rounded-full bg-[#FFC400]/10 text-[#FFC400] flex items-center justify-center mx-auto mb-3">
          🔍
        </div>
        <p className={`text-base font-semibold ${darkMode ? 'text-white/80' : 'text-neutral-700'}`}>
          {isAr ? 'لم يتم العثور على وجبات مطابقة لبحثك' : 'Nothing matches your search yet.'}
        </p>
        <p className="text-xs text-neutral-500 mt-1">
          {isAr ? 'جرب كلمات أخرى أو اختر قسماً آخر' : 'Try different words or pick another category.'}
        </p>
      </div>
    );
  }

  // Lines of one item + helpers (option items route through the details sheet)
  const linesOf = (item: MenuItem) =>
    Object.entries(cart).filter(([, l]) => l.id === item.id);
  const totalQtyOf = (item: MenuItem) =>
    linesOf(item).reduce((s, [, l]) => s + l.quantity, 0);

  const renderStepper = (item: MenuItem, lineKey: string, qty: number, small: boolean) => (
    <div className={`flex items-center ${small ? 'gap-1 p-0.5' : 'gap-1.5 p-1'} bg-[#FFC400] text-[#0A0A0A] rounded-full ${small ? 'shadow-sm' : 'shadow-md'}`}>
      <button
        type="button"
        onClick={() => onUpdateLine(lineKey, -1)}
        className={`${small ? 'w-6 h-6' : 'w-7 h-7'} rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold transition-all`}
        aria-label={isAr ? 'إنقاص' : 'Decrease'}
      >
        <Minus size={small ? 12 : 14} className="stroke-[3]" />
      </button>
      <span className={`font-extrabold ${small ? 'text-xs px-1' : 'text-sm px-1.5'} min-w-[20px] text-center`}>
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onUpdateLine(lineKey, 1)}
        className={`${small ? 'w-6 h-6' : 'w-7 h-7'} rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold transition-all`}
        aria-label={isAr ? 'زيادة' : 'Increase'}
      >
        <Plus size={small ? 12 : 14} className="stroke-[3]" />
      </button>
    </div>
  );

  // Action control for a card/row: option items always open the sheet,
  // simple items add minQty directly then step.
  const renderAction = (item: MenuItem, small: boolean) => {
    const options = hasOptions(item);
    const qty = totalQtyOf(item);
    if (options) {
      if (qty === 0) {
        return (
          <button
            type="button"
            onClick={() => onAddItem(item)}
            className={`${small ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center font-bold shadow-md hover:bg-[#ffd033] active:scale-95 transition-all`}
            aria-label={isAr ? `إضافة ${item.name.ar}` : `Add ${item.name.en}`}
          >
            <Plus size={small ? 16 : 18} className="stroke-[2.5]" />
          </button>
        );
      }
      return (
        <button
          type="button"
          onClick={() => onOpenItem(item)}
          className={`rounded-full bg-[#FFC400] text-[#0A0A0A] font-extrabold shadow-md hover:bg-[#ffd033] active:scale-95 transition-all ${small ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm'}`}
          aria-label={isAr ? `تعديل ${item.name.ar}` : `Customize ${item.name.en}`}
        >
          <span className="tabular-nums">{qty}</span>
        </button>
      );
    }
    if (qty === 0) {
      return (
        <button
          type="button"
          onClick={() => onAddItem(item)}
          className={`${small ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center font-bold shadow-md hover:bg-[#ffd033] active:scale-95 transition-all`}
          aria-label={isAr ? `إضافة ${item.name.ar}` : `Add ${item.name.en}`}
        >
          <Plus size={small ? 16 : 18} className="stroke-[2.5]" />
        </button>
      );
    }
    return renderStepper(item, cartLineKey(item.id), qty, small);
  };

  // Get visible categories that have items in filtered list
  const activeCategoryIds = Array.from(new Set(filteredItems.map((i) => i.categoryId)));
  const visibleCats = categories.filter((c) => c.visible && activeCategoryIds.includes(c.id));

  return (
    <div className="px-5 sm:px-8 pb-12 space-y-7 max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full">
      {visibleCats.map((cat) => {
        const catItems = filteredItems.filter((i) => i.categoryId === cat.id);
        const layout = cat.layout || (cat.id === 'manakish' ? 'list' : 'cards');
        const isListSection = layout === 'list';
        const isCompactSection = layout === 'compact';

        return (
          <section key={cat.id} id={`category-${cat.id}`} className="scroll-mt-16 menu-section">
            {/* Category Header */}
            <div className="flex items-center gap-2.5 mb-4">
              <motion.span
                className="w-1.5 h-6 bg-[#FFC400] rounded-sm origin-center"
                initial={{ scaleY: 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                aria-hidden="true"
              />
              <h2 className={`text-xl sm:text-2xl font-extrabold ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                {isAr ? cat.name.ar : cat.name.en}
              </h2>
            </div>
            {/* Compact rows: dense single-line rows with smooth reflow on filter */}
            {isCompactSection ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
                {catItems.map((item, idx) => {
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
                              className="inline-flex shrink-0 items-center gap-0.5 px-1.5 py-px rounded-full text-[9px] font-extrabold bg-[#0A0A0A] text-[#FFC400] border border-[#FFC400]"
                            >
                              {b === 'spicy' && <Flame size={9} className="fill-[#FFC400]" />}
                              {b === 'top' && <Award size={9} className="fill-[#FFC400]" />}
                              {b === 'new' && <Sparkles size={9} />}
                              {b.toUpperCase()}
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
                      <span className={`shrink-0 text-sm font-extrabold tabular-nums ${darkMode ? 'text-[#FFC400]' : 'text-[#0A0A0A]'}`} dir="ltr">
                        {priceLabel(item, lang, currency)}
                      </span>
                      {!isSoldOut && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex-shrink-0"
                        >
                          {renderAction(item, true)}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            ) : (
            /* List View for text-first sections: 1-col on mobile, 2-col on
               tablet/desktop */
            isListSection ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-10 gap-y-4">
                {catItems.map((item, idx) => {
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
                      {/* Name, Badges, Dotted Leader, Price */}
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
                            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#0A0A0A] text-[#FFC400] border border-[#FFC400]"
                          >
                            {b === 'spicy' && <Flame size={10} className="fill-[#FFC400]" />}
                            {b === 'top' && <Award size={10} className="fill-[#FFC400]" />}
                            {b === 'new' && <Sparkles size={10} />}
                            {b.toUpperCase()}
                          </span>
                        ))}

                        {isSoldOut && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-600 text-white">
                            {isAr ? 'نفذت الكمية' : 'Sold out'}
                          </span>
                        )}

                        {/* Price Pill */}
                        <span className="ms-auto px-3 py-1 rounded-full text-sm font-extrabold bg-[#FFC400] text-[#0A0A0A] shadow-sm flex-shrink-0 group-hover:scale-105 transition-transform">
                          {priceLabel(item, lang, currency)}
                        </span>
                      </div>

                      {/* Description & Add/Stepper Row */}
                      <div className="flex justify-between items-start gap-4 mt-2">
                        {pickLangText(item.description, lang).trim() ? (
                          <p
                            className={`text-xs leading-relaxed flex-1 ${
                              darkMode ? 'text-neutral-400' : 'text-neutral-600'
                            }`}
                          >
                            {pickLangText(item.description, lang)}
                          </p>
                        ) : (
                          <span className="flex-1" />
                        )}

                        {/* Action Control: Add Button or Stepper */}
                        {!isSoldOut && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0"
                          >
                            {renderAction(item, false)}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              /* Grid View for Sides, Drinks, etc. (2-col mobile, 3-col tablet, 4-col desktop) */
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4 md:gap-5">
                {catItems.map((item, idx) => {
                  const isSoldOut = !item.available;

                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 18 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '-40px' }}
                      transition={{ duration: 0.5, delay: Math.min(idx, 5) * 0.06, ease: [0.22, 1, 0.36, 1] }}
                      onClick={() => !isSoldOut && onOpenItem(item)}
                      className={`grid-card relative flex flex-col justify-between p-3.5 rounded-2xl border-2 ${
                        darkMode
                          ? 'bg-[#141414] border-[#FFC400] offset-shadow-dark'
                          : 'bg-white border-[#0A0A0A] offset-shadow-yellow'
                      } ${isSoldOut ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer card-lift'}`}
                    >
                      <div>
                        {/* Badges (effective: stored + automatic NEW) */}
                        {(effectiveBadges(menu, item).length > 0 || isSoldOut) && (
                        <div className="flex items-center justify-between mb-2">
                          {effectiveBadges(menu, item).length > 0 ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-[#0A0A0A] text-[#FFC400] border border-[#FFC400]">
                              {effectiveBadges(menu, item)[0].toUpperCase()}
                            </span>
                          ) : <span />}

                          {isSoldOut && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-neutral-600 text-white">
                              {isAr ? 'نفذت' : 'Sold out'}
                            </span>
                          )}
                        </div>
                        )}

                        <h3
                          className={`font-bold text-sm leading-snug line-clamp-1 ${
                            darkMode ? 'text-white' : 'text-[#0A0A0A]'
                          }`}
                        >
                          {pickLangText(item.name, lang)}
                        </h3>

                        {pickLangText(item.description, lang).trim() ? (
                          <p
                            className={`text-[11px] mt-1 line-clamp-2 ${
                              darkMode ? 'text-neutral-400' : 'text-neutral-600'
                            }`}
                          >
                            {pickLangText(item.description, lang)}
                          </p>
                        ) : null}
                      </div>

                      {/* Price and Cart Action */}
                      <div className={`flex justify-between items-center mt-3 pt-2 border-t border-dashed ${
                        darkMode ? 'border-neutral-800' : 'border-neutral-200'
                      }`}>
                        <span className={`font-extrabold text-sm ${darkMode ? 'text-[#FFC400]' : 'text-[#0A0A0A]'}`}>
                          {priceLabel(item, lang, currency)}
                        </span>

                        {!isSoldOut && (
                          <div onClick={(e) => e.stopPropagation()}>
                            {renderAction(item, true)}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
};
