import React from 'react';
import { MenuItem, Category } from '../types/menu';
import { Plus, Minus, Flame, Sparkles, Award } from 'lucide-react';

interface MenuListProps {
  categories: Category[];
  items: MenuItem[];
  selectedCategory: string;
  searchQuery: string;
  cartQuantities: Record<string, number>;
  onAddToCart: (item: MenuItem) => void;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onOpenItem: (item: MenuItem) => void;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

export const MenuList: React.FC<MenuListProps> = ({
  categories,
  items,
  selectedCategory,
  searchQuery,
  cartQuantities,
  onAddToCart,
  onUpdateQuantity,
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
          {isAr ? 'جرب البحث بكلمات أخرى أو اختر قسماً آخر' : 'Try searching for burgers, fries, or drinks.'}
        </p>
      </div>
    );
  }

  // Get visible categories that have items in filtered list
  const activeCategoryIds = Array.from(new Set(filteredItems.map((i) => i.categoryId)));
  const visibleCats = categories.filter((c) => c.visible && activeCategoryIds.includes(c.id));

  return (
    <div className="px-5 sm:px-8 pb-12 space-y-10 max-w-5xl mx-auto w-full">
      {visibleCats.map((cat) => {
        const catItems = filteredItems.filter((i) => i.categoryId === cat.id);
        const isBurgerSection = cat.id.toLowerCase().includes('burger');

        return (
          <section key={cat.id} id={`category-${cat.id}`} className="scroll-mt-16">
            {/* Category Header */}
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-1.5 h-6 bg-[#FFC400] rounded-sm" aria-hidden="true" />
              <h2 className={`text-xl sm:text-2xl font-extrabold ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
                {isAr ? cat.name.ar : cat.name.en}
              </h2>
            </div>

            {/* List View for Burgers: 1-col on mobile, 2-col on tablet/desktop */}
            {isBurgerSection ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4">
                {catItems.map((item) => {
                  const qty = cartQuantities[item.id] || 0;
                  const isSoldOut = !item.available;

                  return (
                    <div
                      key={item.id}
                      onClick={() => !isSoldOut && onOpenItem(item)}
                      className={`group relative pb-4 border-b transition-all ${
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
                          {isAr ? item.name.ar : item.name.en}
                        </span>

                        {/* Badges */}
                        {item.badges.map((b) => (
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

                        {/* Dotted Leader Line */}
                        <span
                          className={`flex-1 border-b-2 border-dotted mx-1 ${
                            darkMode ? 'border-neutral-700' : 'border-neutral-300'
                          }`}
                          aria-hidden="true"
                        />

                        {/* Price Pill */}
                        <span className="px-3 py-1 rounded-full text-sm font-extrabold bg-[#FFC400] text-[#0A0A0A] shadow-sm flex-shrink-0 group-hover:scale-105 transition-transform">
                          {item.price} {currency}
                        </span>
                      </div>

                      {/* Description & Add/Stepper Row */}
                      <div className="flex justify-between items-start gap-4 mt-2">
                        <p
                          className={`text-xs leading-relaxed flex-1 ${
                            darkMode ? 'text-neutral-400' : 'text-neutral-600'
                          }`}
                        >
                          {isAr ? item.description.ar : item.description.en}
                        </p>

                        {/* Action Control: Add Button or Stepper */}
                        {!isSoldOut && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0"
                          >
                            {qty === 0 ? (
                              <button
                                type="button"
                                onClick={() => onAddToCart(item)}
                                className="w-10 h-10 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center font-bold shadow-md hover:bg-[#ffd033] active:scale-95 transition-all"
                                aria-label={isAr ? `إضافة ${item.name.ar}` : `Add ${item.name.en}`}
                              >
                                <Plus size={18} className="stroke-[2.5]" />
                              </button>
                            ) : (
                              <div className="flex items-center gap-1.5 bg-[#FFC400] text-[#0A0A0A] rounded-full p-1 shadow-md">
                                <button
                                  type="button"
                                  onClick={() => onUpdateQuantity(item.id, -1)}
                                  className="w-7 h-7 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold transition-all"
                                  aria-label={isAr ? 'إنقاص' : 'Decrease'}
                                >
                                  <Minus size={14} className="stroke-[3]" />
                                </button>
                                <span className="font-extrabold text-sm px-1.5 min-w-[20px] text-center">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onUpdateQuantity(item.id, 1)}
                                  className="w-7 h-7 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold transition-all"
                                  aria-label={isAr ? 'زيادة' : 'Increase'}
                                >
                                  <Plus size={14} className="stroke-[3]" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Grid View for Sides, Drinks, etc. (2-col mobile, 3-col tablet, 4-col desktop) */
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-4 md:gap-5">
                {catItems.map((item) => {
                  const qty = cartQuantities[item.id] || 0;
                  const isSoldOut = !item.available;

                  return (
                    <div
                      key={item.id}
                      onClick={() => !isSoldOut && onOpenItem(item)}
                      className={`relative flex flex-col justify-between p-3.5 rounded-2xl border-2 transition-all ${
                        darkMode
                          ? 'bg-[#141414] border-[#FFC400] offset-shadow-dark'
                          : 'bg-white border-[#0A0A0A] offset-shadow-yellow'
                      } ${isSoldOut ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer card-lift'}`}
                    >
                      <div>
                        {/* Badges */}
                        <div className="flex items-center justify-between mb-2">
                          {item.badges.length > 0 ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-[#0A0A0A] text-[#FFC400] border border-[#FFC400]">
                              {item.badges[0].toUpperCase()}
                            </span>
                          ) : <span />}

                          {isSoldOut && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-neutral-600 text-white">
                              {isAr ? 'نفذت' : 'Sold out'}
                            </span>
                          )}
                        </div>

                        <h3
                          className={`font-bold text-sm leading-snug line-clamp-1 ${
                            darkMode ? 'text-white' : 'text-[#0A0A0A]'
                          }`}
                        >
                          {isAr ? item.name.ar : item.name.en}
                        </h3>

                        <p
                          className={`text-[11px] mt-1 line-clamp-2 ${
                            darkMode ? 'text-neutral-400' : 'text-neutral-600'
                          }`}
                        >
                          {isAr ? item.description.ar : item.description.en}
                        </p>
                      </div>

                      {/* Price and Cart Action */}
                      <div className={`flex justify-between items-center mt-3 pt-2 border-t border-dashed ${
                        darkMode ? 'border-neutral-800' : 'border-neutral-200'
                      }`}>
                        <span className={`font-extrabold text-sm ${darkMode ? 'text-[#FFC400]' : 'text-[#0A0A0A]'}`}>
                          {item.price} {currency}
                        </span>

                        {!isSoldOut && (
                          <div onClick={(e) => e.stopPropagation()}>
                            {qty === 0 ? (
                              <button
                                type="button"
                                onClick={() => onAddToCart(item)}
                                className="w-8 h-8 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center font-bold shadow-sm hover:bg-[#ffd033] active:scale-90 transition-all"
                                aria-label={isAr ? `إضافة ${item.name.ar}` : `Add ${item.name.en}`}
                              >
                                <Plus size={16} className="stroke-[2.5]" />
                              </button>
                            ) : (
                              <div className="flex items-center gap-1 bg-[#FFC400] text-[#0A0A0A] rounded-full p-0.5 shadow-sm">
                                <button
                                  type="button"
                                  onClick={() => onUpdateQuantity(item.id, -1)}
                                  className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center font-bold"
                                  aria-label={isAr ? 'إنقاص' : 'Decrease'}
                                >
                                  <Minus size={12} className="stroke-[3]" />
                                </button>
                                <span className="font-bold text-xs px-1">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onUpdateQuantity(item.id, 1)}
                                  className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center font-bold"
                                  aria-label={isAr ? 'زيادة' : 'Increase'}
                                >
                                  <Plus size={12} className="stroke-[3]" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};
