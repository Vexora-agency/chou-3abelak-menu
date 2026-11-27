import React from 'react';
import { ChevronDown, Timer } from 'lucide-react';
import type { MenuData, MenuSettings } from '@/src/types/menu';
import { FeaturedCarousel } from '@/src/features/menu';
import { autoplayIntervalOrDefault } from '@/src/utils/settingsDefaults';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

type AutoplayValues = Pick<MenuSettings, 'featuredAutoplay' | 'featuredAutoplayInterval'>;

interface AutoplaySectionProps extends AutoplayValues {
  menu: MenuData;
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: AutoplayValues) => AutoplayValues) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Featured Carousel autoplay card of the admin Settings tab, with a live
 *  preview running the REAL storefront slider (same motion customers see). */
export const AutoplaySection: React.FC<AutoplaySectionProps> = ({
  menu,
  featuredAutoplay,
  featuredAutoplayInterval,
  lang,
  onUpdate,
  collapsed = false,
  onToggleCollapse,
}) => {
  const isAr = lang === 'ar';
  const on = featuredAutoplay !== false;
  const every = autoplayIntervalOrDefault(featuredAutoplayInterval);
  const secondsLabel = (n: number) =>
    isAr ? (n === 2 ? 'ثانيتان' : `${n} ثوانٍ`) : `${n} seconds`;
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
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'تحريك قسم المميز تلقائيًا' : 'Featured Carousel Autoplay'}
        subtitle={on
          ? (isAr ? 'يتحرك تلقائيًا — يتوقف عند اللمس' : 'Auto-slides — pauses on touch')
          : (isAr ? 'متوقف — يتحرك يدويًا فقط' : 'Off — manual scroll only')}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
      <div className="rounded-xl border border-neutral-800 bg-black/40 p-3">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={isAr ? 'تشغيل أو إيقاف التحريك التلقائي' : 'Turn autoplay on or off'}
          onClick={() => onUpdate((prev) => ({ ...prev, featuredAutoplay: !(prev.featuredAutoplay !== false) }))}
          className="w-full flex items-center justify-between gap-3 text-start min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <span className="text-xs font-bold">{isAr ? 'التشغيل' : 'Enabled'}</span>
          <span
            className={`relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200 ${
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
      </div>
      {on && (
        <div className="anim-fade-in space-y-1.5">
          <label
            htmlFor="carousel-autoplay-interval"
            className="block text-xs font-bold text-neutral-300"
          >
            {isAr ? 'كل كم ثانية يتحرك الكاروسيل؟' : 'How often should the carousel move?'}
          </label>
          <div className="relative">
            <Timer
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--primary)]"
            />
            <select
              id="carousel-autoplay-interval"
              value={every}
              onChange={(event) =>
                onUpdate((prev) => ({
                  ...prev,
                  featuredAutoplayInterval: Number(event.target.value),
                }))
              }
              aria-describedby="carousel-autoplay-interval-hint"
              className="h-11 min-h-[44px] w-full appearance-none rounded-xl border border-neutral-700 bg-neutral-950 ps-10 pe-10 text-sm font-bold text-white focus:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              {Array.from({ length: 9 }, (_, index) => index + 2).map((seconds) => (
                <option key={seconds} value={seconds}>
                  {secondsLabel(seconds)}
                </option>
              ))}
            </select>
            <ChevronDown
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
          </div>
          <p id="carousel-autoplay-interval-hint" className="text-[10px] leading-relaxed text-neutral-500">
            {isAr
              ? 'القيمة المختارة تُطبَّق على كاروسيل الموقع بعد حفظ الإعدادات، وتظهر مباشرة في المعاينة.'
              : 'The selected value is applied to the storefront carousel after saving, and updates this preview instantly.'}
          </p>
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
              variant="dark"
              title={isAr ? 'المميز والأكثر طلبًا' : 'Featured Items'}
              items={previewItems}
              menu={menu}
              onOpenItem={() => {}}
              onAddToCart={() => false}
              currency={currency}
              lang={lang}
              autoplay={on}
              autoplayIntervalMs={every * 1000}
              orderingEnabled={false}
              compact
            />
            {demoClone && (
              <p className="px-4 pb-3 -mt-1 text-center text-[10px] text-neutral-500">
                {isAr
                  ? 'عرض تجريبي لبطاقتين (منها البطاقة الصفراء) — علّم صنفًا ثانيًا كمميز لرؤية الحركة الحقيقية'
                  : 'Demoing two cards (incl. the yellow one) — star a second item as Featured for the real motion'}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-neutral-700 px-4 py-3 text-center">
            <p className="text-[11px] text-neutral-500">
              {isAr
                ? 'لا توجد أصناف مميزة بعد — علّم أي صنف بـ «مميز» من تبويب الأصناف لتراه هنا'
                : 'No featured items yet — star any item as Featured in the Items tab to preview it here'}
            </p>
          </div>
        )}
      </div>
      </SettingsGroupBody>
    </div>
  );
};
