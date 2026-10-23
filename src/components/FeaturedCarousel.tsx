import React from 'react';
import { motion } from 'motion/react';
import { MenuItem } from '../types/menu';
import { Plus } from 'lucide-react';
import { formatPrice } from '../utils/menuHelpers';

interface FeaturedCarouselProps {
  items: MenuItem[];
  onOpenItem: (item: MenuItem) => void;
  onAddToCart: (item: MenuItem) => void;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

export const FeaturedCarousel: React.FC<FeaturedCarouselProps> = ({
  items,
  onOpenItem,
  onAddToCart,
  currency,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';
  if (items.length === 0) return null;

  return (
    <div className="mt-6 mb-4 px-5 sm:px-8 max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full">
      {/* Section Title with Yellow Bar */}
      <div className="flex items-center gap-2.5 mb-3.5">
        <motion.span
          className="w-1.5 h-6 bg-[#FFC400] rounded-sm origin-center"
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
        />
        <h2 className={`text-xl sm:text-2xl font-extrabold ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
          {isAr ? 'المميز والأكثر طلباً' : 'Featured Items'}
        </h2>
      </div>

      {/* Responsive Track / Grid */}
      <div className="flex md:grid md:grid-cols-3 gap-3.5 sm:gap-4 overflow-x-auto md:overflow-visible no-scrollbar pb-2">
        {items.map((item, idx) => {
          const isYellowCard = idx % 2 === 1; // Alternating cards
          const badgeText = item.badges.includes('top')
            ? (isAr ? 'الأكثر طلباً' : 'BEST SELLER')
            : item.badges.includes('spicy')
            ? (isAr ? 'حار و مقرمش' : 'HOT & SPICY')
            : (isAr ? 'جديد' : 'NEW');

          return (
            <motion.div
              key={item.id}
              onClick={() => onOpenItem(item)}
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.55, delay: idx * 0.08, ease: [0.22, 1, 0.36, 1] }}
              className={`group relative flex-shrink-0 w-60 md:w-auto h-40 rounded-[22px] p-4 flex flex-col justify-between overflow-hidden cursor-pointer card-lift shadow-md border ${
                isYellowCard
                  ? 'bg-[#FFC400] text-[#0A0A0A] border-[#FFC400]'
                  : darkMode
                  ? 'bg-[#181818] text-white border-white/10'
                  : 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
              }`}
            >
              {/* Brand mark from the logo (pan + handle) as a quiet watermark */}
              <img
                src="/assets/pan-icon-yellow.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`absolute -right-3 -top-2 w-24 pointer-events-none select-none -rotate-12 transition-transform duration-500 group-hover:-rotate-3 group-hover:scale-110 ${
                  isYellowCard ? 'opacity-[0.16]' : 'opacity-[0.20]'
                }`}
                style={isYellowCard ? { filter: 'brightness(0)' } : undefined}
              />

              {/* Top Tag Badge */}
              <div className="relative flex justify-between items-start">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-[11px] font-extrabold tracking-wider uppercase ${
                    isYellowCard
                      ? 'bg-[#0A0A0A] text-[#FFC400]'
                      : 'bg-[#FFC400] text-[#0A0A0A]'
                  }`}
                >
                  {badgeText}
                </span>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToCart(item);
                  }}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform active:scale-90 shadow-sm ${
                    isYellowCard
                      ? 'bg-[#0A0A0A] text-[#FFC400] hover:bg-black/80'
                      : 'bg-[#FFC400] text-[#0A0A0A] hover:bg-[#ffd033]'
                  }`}
                  aria-label={isAr ? `أضف ${item.name.ar} إلى السلة` : `Add ${item.name.en} to cart`}
                  title={isAr ? 'أضف للطلب' : 'Add to cart'}
                >
                  <Plus size={16} className="stroke-[3]" />
                </button>
              </div>

              {/* Bottom Info: Name & Price */}
              <div className="relative flex justify-between items-end gap-2">
                <div className="flex-1 min-w-0 pe-2">
                  <h3 className="font-bold text-base leading-tight line-clamp-2">
                    {isAr ? item.name.ar : item.name.en}
                  </h3>
                  <p
                    className={`text-xs mt-0.5 line-clamp-1 ${
                      isYellowCard ? 'text-black/75' : 'text-neutral-400'
                    }`}
                  >
                    {isAr ? item.description.ar : item.description.en}
                  </p>
                </div>

                <div
                  className={`flex-shrink-0 px-3 py-1 rounded-full text-sm font-black shadow-sm ${
                    isYellowCard
                      ? 'bg-[#0A0A0A] text-[#FFC400]'
                      : 'bg-[#FFC400] text-[#0A0A0A]'
                  }`}
                >
                  {formatPrice(item.price, currency)}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
