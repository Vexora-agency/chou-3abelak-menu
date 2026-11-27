import React, { useState } from 'react';
import {
  FlipHorizontal2,
  FlipVertical2,
  Image as ImageIcon,
  RotateCcw,
  RotateCw,
  Undo2,
} from 'lucide-react';
import type { CarouselImageAdjust, MenuData } from '@/src/types/menu';
import { pickLangText } from '@/src/utils/menuHelpers';
import {
  CAROUSEL_IMAGE_MAX_PAN,
  CAROUSEL_IMAGE_MAX_ROTATE,
  CAROUSEL_IMAGE_MAX_SCALE,
  CAROUSEL_IMAGE_MIN_SCALE,
  carouselImageTransform,
  normalizeCarouselImage,
} from '@/src/utils/carouselImage';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

interface CarouselImagesSectionProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  onUpdateMenu: (updater: (prev: MenuData) => MenuData) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const RangeField: React.FC<{
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}> = ({ label, value, display, min, max, step, onChange }) => (
  <label className="block">
    <span className="mb-0.5 flex items-center justify-between gap-2 text-[10.5px] font-bold text-neutral-400">
      <span>{label}</span>
      <span className="tabular-nums text-neutral-200" dir="ltr">{display}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      dir="ltr"
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-8 w-full cursor-pointer accent-[var(--primary)]"
      aria-label={label}
    />
  </label>
);

/**
 * Per-card carousel photo framing. The adjustments live on the item as
 * `carouselImage` and are applied ONLY by the featured carousel — the item
 * photo used everywhere else stays exactly as it is.
 */
export const CarouselImagesSection: React.FC<CarouselImagesSectionProps> = ({
  menu,
  lang,
  onUpdateMenu,
  collapsed = false,
  onToggleCollapse,
}) => {
  const isAr = lang === 'ar';
  const featured = menu.items.filter((item) => item.featured && item.available);
  const [selectedId, setSelectedId] = useState('');
  const active = featured.find((item) => item.id === selectedId) || featured[0] || null;
  const adjust = active ? normalizeCarouselImage(active.carouselImage) : null;

  const patch = (next: Partial<CarouselImageAdjust>) => {
    if (!active || !adjust) return;
    const merged = normalizeCarouselImage({ ...adjust, ...next });
    onUpdateMenu((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === active.id ? { ...item, carouselImage: merged } : item
      ),
    }));
  };

  const reset = () => {
    if (!active) return;
    onUpdateMenu((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== active.id) return item;
        const { carouselImage: _dropped, ...rest } = item;
        void _dropped;
        return rest;
      }),
    }));
  };

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'صور الكاروسيل' : 'Carousel Images'}
        subtitle={
          isAr
            ? 'اضبط صورة كل كارت: تكبير، تحريك، تدوير، وقلب'
            : 'Frame each carousel card photo: zoom, pan, rotate and flip'
        }
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
        action={
          <span className="shrink-0 w-9 h-9 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/30 text-[var(--primary)] flex items-center justify-center">
            <ImageIcon size={16} aria-hidden="true" />
          </span>
        }
      />
      <SettingsGroupBody open={!collapsed}>
        {featured.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-700 px-4 py-3 text-center text-[11px] text-neutral-500">
            {isAr
              ? 'لا توجد أصناف مميزة بعد — علّم أي صنف بـ «مميز» ليظهر هنا.'
              : 'No featured items yet — star an item as Featured to edit its carousel photo here.'}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {featured.map((item) => {
                const name = pickLangText(item.name, lang) || item.id;
                const selected = active?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-pressed={selected}
                    className={`inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                      selected
                        ? 'border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]'
                        : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-500'
                    }`}
                  >
                    <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-neutral-800">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                          style={{ transform: carouselImageTransform(item.carouselImage) }}
                        />
                      ) : (
                        <ImageIcon size={12} className="m-auto mt-2 text-neutral-500" aria-hidden="true" />
                      )}
                    </span>
                    <span className="truncate">{name}</span>
                  </button>
                );
              })}
            </div>

            {active && adjust ? (
              <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)]">
                <div className="mx-auto w-full max-w-[180px] sm:mx-0 sm:max-w-none">
                  <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-neutral-700 bg-black">
                    {active.imageUrl ? (
                      <img
                        src={active.imageUrl}
                        alt={
                          isAr
                            ? `معاينة صورة ${pickLangText(active.name, lang)} في الكاروسيل`
                            : `Carousel preview for ${pickLangText(active.name, lang)}`
                        }
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover"
                        style={{ transform: carouselImageTransform(adjust) }}
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
                        <ImageIcon size={22} className="text-neutral-600" aria-hidden="true" />
                        <span className="text-[10px] text-neutral-500">
                          {isAr ? 'لا توجد صورة لهذا الصنف' : 'No photo for this item'}
                        </span>
                      </div>
                    )}
                    <span className="pointer-events-none absolute bottom-1.5 start-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-bold text-neutral-200">
                      {isAr ? 'معاينة الكاروسيل' : 'Carousel preview'}
                    </span>
                  </div>
                  <p className="mt-1 text-[9.5px] leading-relaxed text-neutral-500">
                    {isAr
                      ? 'هذه المعاينة تقريبية؛ التعديل يخص الكاروسيل فقط ولا يغيّر صورة الصنف في بقية الصفحات.'
                      : 'Approximate preview; changes apply to the carousel only, never to the item photo elsewhere.'}
                  </p>
                </div>

                <div className="min-w-0 space-y-1">
                  <RangeField
                    label={isAr ? 'الحجم' : 'Size'}
                    value={adjust.scale}
                    display={`${Math.round(adjust.scale * 100)}%`}
                    min={CAROUSEL_IMAGE_MIN_SCALE}
                    max={CAROUSEL_IMAGE_MAX_SCALE}
                    step={0.05}
                    onChange={(value) => patch({ scale: value })}
                  />
                  <RangeField
                    label={isAr ? 'الموضع الأفقي' : 'Horizontal position'}
                    value={adjust.x}
                    display={`${adjust.x}%`}
                    min={-CAROUSEL_IMAGE_MAX_PAN}
                    max={CAROUSEL_IMAGE_MAX_PAN}
                    step={1}
                    onChange={(value) => patch({ x: value })}
                  />
                  <RangeField
                    label={isAr ? 'الموضع الرأسي' : 'Vertical position'}
                    value={adjust.y}
                    display={`${adjust.y}%`}
                    min={-CAROUSEL_IMAGE_MAX_PAN}
                    max={CAROUSEL_IMAGE_MAX_PAN}
                    step={1}
                    onChange={(value) => patch({ y: value })}
                  />
                  <RangeField
                    label={isAr ? 'التدوير' : 'Rotation'}
                    value={adjust.rotate}
                    display={`${adjust.rotate}°`}
                    min={-CAROUSEL_IMAGE_MAX_ROTATE}
                    max={CAROUSEL_IMAGE_MAX_ROTATE}
                    step={5}
                    onChange={(value) => patch({ rotate: value })}
                  />

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => patch({ rotate: adjust.rotate - 90 })}
                      className="inline-flex h-9 items-center gap-1 rounded-full bg-neutral-800 px-2.5 text-[10.5px] font-bold text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      aria-label={isAr ? 'تدوير 90 درجة لليسار' : 'Rotate 90° left'}
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                      90°
                    </button>
                    <button
                      type="button"
                      onClick={() => patch({ rotate: adjust.rotate + 90 })}
                      className="inline-flex h-9 items-center gap-1 rounded-full bg-neutral-800 px-2.5 text-[10.5px] font-bold text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      aria-label={isAr ? 'تدوير 90 درجة لليمين' : 'Rotate 90° right'}
                    >
                      <RotateCw size={13} aria-hidden="true" />
                      90°
                    </button>
                    <button
                      type="button"
                      onClick={() => patch({ flipX: !adjust.flipX })}
                      aria-pressed={adjust.flipX === true}
                      className={`inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[10.5px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                        adjust.flipX
                          ? 'bg-[var(--primary)] text-[#0A0A0A]'
                          : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
                      }`}
                      aria-label={isAr ? 'قلب أفقي' : 'Flip horizontally'}
                    >
                      <FlipHorizontal2 size={13} aria-hidden="true" />
                      {isAr ? 'قلب أفقي' : 'Flip H'}
                    </button>
                    <button
                      type="button"
                      onClick={() => patch({ flipY: !adjust.flipY })}
                      aria-pressed={adjust.flipY === true}
                      className={`inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[10.5px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                        adjust.flipY
                          ? 'bg-[var(--primary)] text-[#0A0A0A]'
                          : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
                      }`}
                      aria-label={isAr ? 'قلب رأسي' : 'Flip vertically'}
                    >
                      <FlipVertical2 size={13} aria-hidden="true" />
                      {isAr ? 'قلب رأسي' : 'Flip V'}
                    </button>
                    <button
                      type="button"
                      onClick={reset}
                      className="inline-flex h-9 items-center gap-1 rounded-full border border-neutral-700 px-2.5 text-[10.5px] font-bold text-neutral-300 hover:border-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      aria-label={isAr ? 'إعادة ضبط صورة الكاروسيل' : 'Reset carousel photo'}
                    >
                      <Undo2 size={13} aria-hidden="true" />
                      {isAr ? 'إعادة ضبط' : 'Reset'}
                    </button>
                  </div>
                  <p className="pt-1 text-[9.5px] leading-relaxed text-neutral-500">
                    {isAr
                      ? 'التعديلات تُحفظ مع القائمة. استخدم «تغيير الصورة» من تبويب الأصناف لتغيير الصورة نفسها.'
                      : 'Changes save with the menu. Use “Change photo” in the Items tab to replace the image itself.'}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SettingsGroupBody>
    </div>
  );
};
