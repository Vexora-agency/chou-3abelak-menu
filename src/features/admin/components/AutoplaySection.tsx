import React from 'react';
import type { MenuData, MenuSettings } from '@/src/types/menu';
import { FeaturedCarousel } from '@/src/features/menu';

type AutoplayValues = Pick<MenuSettings, 'featuredAutoplay' | 'featuredAutoplayInterval'>;

interface AutoplaySectionProps extends AutoplayValues {
  menu: MenuData;
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: AutoplayValues) => AutoplayValues) => void;
}

/** Featured Carousel autoplay card of the admin Settings tab, with a live
 *  preview running the REAL storefront slider (same motion customers see). */
export const AutoplaySection: React.FC<AutoplaySectionProps> = ({
  menu,
  featuredAutoplay,
  featuredAutoplayInterval,
  lang,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  const on = featuredAutoplay !== false;
  const every = Math.min(10, Math.max(2, featuredAutoplayInterval || 4));
  const featured = menu.items.filter((i) => i.featured && i.available);
  // With a single featured item the real slider can't move (same as the
  // site) — duplicate it as a clearly-marked demo clone so the preview
  // still shows the motion AND the alternating yellow card. The moment a
  // second real item is starred, the demo clone disappears on its own.
  const demoClone = featured.length === 1;
  const previewItems = demoClone
    ? [...featured, { ...featured[0], id: `${featured[0].id}__demo` }]
    : featured;
  const currency = menu.settings.currency[lang] || menu.settings.currency.en;
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onUpdate((prev) => ({ ...prev, featuredAutoplay: !(prev.featuredAutoplay !== false) }))}
        className="w-full flex items-center justify-between gap-3 text-start"
      >
        <span>
          <span className={`block text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`}>
            {isAr ? 'تحريك قسم المميز تلقائياً' : 'Featured Carousel Autoplay'}
          </span>
          <span className="block text-[11px] text-neutral-500 mt-0.5">
            {on
              ? (isAr ? 'يتحرك تلقائياً — يتوقف عند اللمس' : 'Auto-slides — pauses on touch')
              : (isAr ? 'متوقف — يتحرك يدوياً فقط' : 'Off — manual scroll only')}
          </span>
        </span>
        <span
          className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${
            on ? 'bg-[var(--primary)]' : 'bg-neutral-700'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
              on
                ? (isAr ? 'left-0.5' : 'left-5')
                : (isAr ? 'left-5' : 'left-0.5')
            }`}
          />
        </span>
      </button>
      {on && (
        <div className="anim-fade-in">
          <label className="block text-xs text-neutral-400 mb-1">
            {isAr ? 'بعد كم ثانية يتحرك؟ (2 - 10)' : 'Slide every N seconds (2 - 10)'}
          </label>
          <input
            type="number"
            min={2}
            max={10}
            value={featuredAutoplayInterval || 4}
            onChange={(e) => onUpdate((prev) => ({ ...prev, featuredAutoplayInterval: Math.min(10, Math.max(2, Number(e.target.value) || 4)) }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
      )}

      {/* Live preview — the real storefront slider, forced into mobile mode */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[11px] text-neutral-500 font-bold">
            {isAr ? 'معاينة حية — نفس حركة الموقع' : 'Live preview — same motion as the site'}
          </p>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-neutral-700/40 text-neutral-400'
            }`}
          >
            {on
              ? isAr
                ? `تلقائي كل ${every} ث`
                : `Auto · every ${every}s`
              : isAr
                ? 'يدوي'
                : 'Manual'}
          </span>
        </div>
        {featured.length > 0 ? (
          <div className="rounded-2xl border border-neutral-800 bg-black/40 overflow-hidden">
            <FeaturedCarousel
              key={previewItems.map((i) => i.id).join('|')}
              items={previewItems}
              menu={menu}
              onOpenItem={() => {}}
              onAddToCart={() => {}}
              currency={currency}
              lang={lang}
              darkMode={menu.settings.defaultTheme !== 'light'}
              autoplay={on}
              autoplayInterval={every}
              forceSlider
              showArrows
            />
            {demoClone && (
              <p className="px-4 pb-3 -mt-1 text-center text-[10px] text-neutral-500">
                {isAr
                  ? 'عرض تجريبي لكرتين (منها الكارت الأصفر) — علّم وجبة ثانية كمميزة لرؤية الحركة الحقيقية'
                  : 'Demoing two cards (incl. the yellow one) — star a second item as Featured for the real motion'}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-neutral-700 px-4 py-3 text-center">
            <p className="text-[11px] text-neutral-500">
              {isAr
                ? 'لا توجد وجبات مميزة بعد — علّم أي وجبة بـ «مميزة» من تبويب الوجبات لتراها هنا'
                : 'No featured items yet — star any item as Featured in the Items tab to preview it here'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
