import React from 'react';
import { Search, X } from 'lucide-react';
import { Category } from '../types/menu';

interface SearchAndChipsProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  categories: Category[];
  selectedCategory: string;
  onSelectCategory: (id: string) => void;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

export const SearchAndChips: React.FC<SearchAndChipsProps> = ({
  searchQuery,
  onSearchChange,
  categories,
  selectedCategory,
  onSelectCategory,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';
  const visibleCategories = categories.filter((c) => c.visible);

  return (
    <div className="px-5 sm:px-8 max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full">
      {/* Overlapping Floating Search Bar */}
      <div className="relative -mt-6 z-20 max-w-xl mx-auto">
        <label htmlFor="menu-search-input" className="sr-only">
          {isAr ? 'البحث في قائمة الطعام' : 'Search the menu'}
        </label>
        <div className="relative flex items-center">
          <Search
            size={19}
            className={`absolute ${isAr ? 'right-4' : 'left-4'} text-[#FFC400] stroke-[2.5] pointer-events-none`}
          />
          <input
            id="menu-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={isAr ? 'ابحث عن وجبتك المفضلة...' : 'Search delicious burgers, sides, drinks...'}
            className={`w-full h-12 rounded-full border-[1.5px] text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#FFC400] ${
              isAr ? 'pr-11 pl-10' : 'pl-11 pr-10'
            } ${
              darkMode
                ? 'bg-[#141414] text-white border-[#2A2A2A] placeholder-neutral-500 shadow-[0_8px_24px_rgba(0,0,0,0.5)]'
                : 'bg-white text-[#0A0A0A] border-[#E5E5E5] placeholder-neutral-400 shadow-[0_8px_20px_rgba(0,0,0,0.1)]'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className={`absolute ${isAr ? 'left-3' : 'right-3'} p-1 rounded-full transition-colors ${
                darkMode ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-black'
              }`}
              aria-label={isAr ? 'مسح البحث' : 'Clear search'}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Sticky Horizontal Categories Navigation */}
      <nav
        aria-label={isAr ? 'تصنيفات القائمة' : 'Menu categories'}
          className={`sticky top-0 z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 mt-1.5 flex gap-2 sm:gap-2.5 md:gap-3 overflow-x-auto no-scrollbar md:justify-center transition-[background-color] duration-300 ${
          darkMode ? 'bg-[#0A0A0A] border-b border-white/5' : 'bg-white border-b border-black/5'
        }`}
      >
        {/* "All" Chip */}
        <button
          type="button"
          onClick={() => onSelectCategory('all')}
          className={`flex-shrink-0 h-11 px-5 rounded-full text-sm transition-all btn-tactile ${
            selectedCategory === 'all'
              ? 'bg-[#FFC400] text-[#0A0A0A] font-bold border-[1.5px] border-[#FFC400]'
              : darkMode
              ? 'bg-transparent text-white/90 font-semibold border-[1.5px] border-white hover:border-[#FFC400]'
              : 'bg-transparent text-[#0A0A0A] font-semibold border-[1.5px] border-[#0A0A0A]'
          }`}
          aria-pressed={selectedCategory === 'all'}
        >
          {isAr ? 'الكل' : 'All'}
        </button>

        {/* Dynamic Category Chips */}
        {visibleCategories.map((cat) => {
          const isSelected = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelectCategory(cat.id)}
            className={`flex-shrink-0 h-11 px-5 rounded-full text-sm transition-all btn-tactile ${
              isSelected
                ? 'bg-[#FFC400] text-[#0A0A0A] font-bold border-[1.5px] border-[#FFC400]'
                : darkMode
                ? 'bg-transparent text-white/90 font-semibold border-[1.5px] border-white hover:border-[#FFC400]'
                : 'bg-transparent text-[#0A0A0A] font-semibold border-[1.5px] border-[#0A0A0A]'
            }`}
              aria-pressed={isSelected}
            >
              {isAr ? cat.name.ar : cat.name.en}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
