import React, { useState } from 'react';
import {
  Copy,
  Crosshair,
  FlipHorizontal2,
  FlipVertical2,
  Grid3x3,
  Image as ImageIcon,
  Minus,
  Moon,
  Move,
  MoveHorizontal,
  MoveVertical,
  Plus,
  RotateCcw,
  RotateCw,
  Sun,
  Undo2,
} from 'lucide-react';
import type { CarouselImageAdjust, MenuData } from '@/src/types/menu';
import { CarouselCardPreview } from '@/src/features/menu';
import { pickLangText } from '@/src/utils/menuHelpers';
import {
  CAROUSEL_DESCRIPTION_MAX,
  hasCustomCarouselDescription,
} from '@/src/utils/carouselDescription';
import {
  CAROUSEL_IMAGE_MAX_PAN,
  CAROUSEL_IMAGE_MAX_ROTATE,
  CAROUSEL_IMAGE_MAX_SCALE,
  CAROUSEL_IMAGE_MIN_SCALE,
  carouselImageTransform,
  isDefaultCarouselImage,
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
  icon?: React.ReactNode;
  disabled?: boolean;
}> = ({ label, value, display, min, max, step, onChange, icon, disabled = false }) => (
  <label className={`block ${disabled ? 'opacity-45' : ''}`}>
    <span className="mb-0.5 flex items-center justify-between gap-2 text-[10.5px] font-bold text-neutral-400">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {icon ? <span className="shrink-0 text-neutral-500">{icon}</span> : null}
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 tabular-nums text-neutral-200" dir="ltr">{display}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      dir="ltr"
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-8 w-full cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed"
      aria-label={label}
    />
  </label>
);

const ToolButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ label, onClick, disabled = false, active, className = '', children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={active === undefined ? undefined : active}
    title={label}
    className={`inline-flex min-h-[40px] min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-[10.5px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40 ${
      active
        ? 'border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]'
        : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-500 hover:text-white'
    } ${className}`}
  >
    {children}
  </button>
);

/**
 * Per-card carousel editor. The photo framing lives on the item as
 * `carouselImage`, and the optional carousel-only copy lives as
 * `carouselDescription`; both are applied ONLY by the featured carousel — the
 * item photo and description used everywhere else stay exactly as they are.
 *
 * The editor shows the actual card (photo + text + action bar) and lets the
 * owner drag the photo directly inside it, so framing is judged in context.
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
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    menu.settings.defaultTheme === 'light' ? 'light' : 'dark'
  );
  const [showGrid, setShowGrid] = useState(false);

  const active = featured.find((item) => item.id === selectedId) || featured[0] || null;
  const activeIndex = active ? Math.max(0, featured.findIndex((item) => item.id === active.id)) : 0;
  const adjust = active ? normalizeCarouselImage(active.carouselImage) : null;
  const hasPhoto = Boolean(active?.imageUrl);
  const isDefault = adjust ? isDefaultCarouselImage(adjust) : true;
  const itemDescription = {
    en: typeof active?.description?.en === 'string' ? active.description.en : '',
    ar: typeof active?.description?.ar === 'string' ? active.description.ar : '',
  };
  const hasItemDescription = Boolean(
    itemDescription.en.trim() || itemDescription.ar.trim()
  );
  const itemDescriptionPreview =
    pickLangText(itemDescription, lang) || itemDescription.en || itemDescription.ar;
  const customDescription = active?.carouselDescription;
  const hasCustomDescription = active ? hasCustomCarouselDescription(active) : false;
  const descriptionEn =
    typeof customDescription?.en === 'string' ? customDescription.en : '';
  const descriptionAr =
    typeof customDescription?.ar === 'string' ? customDescription.ar : '';

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

  const zoomBy = (delta: number) => {
    if (!adjust) return;
    patch({ scale: adjust.scale + delta });
  };

  const panDisplay = (value: number) =>
    `${value > 0 ? '+' : ''}${Math.round(value)}%`;

  const setDescriptionField = (key: 'en' | 'ar', value: string) => {
    if (!active) return;
    const current = {
      en: typeof active.carouselDescription?.en === 'string' ? active.carouselDescription.en : '',
      ar: typeof active.carouselDescription?.ar === 'string' ? active.carouselDescription.ar : '',
    };
    const next = { ...current, [key]: value.slice(0, CAROUSEL_DESCRIPTION_MAX) };
    onUpdateMenu((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== active.id) return item;
        if (!next.en.trim() && !next.ar.trim()) {
          const { carouselDescription: _dropped, ...rest } = item;
          void _dropped;
          return rest;
        }
        return { ...item, carouselDescription: next };
      }),
    }));
  };

  const useItemDescription = () => {
    if (!active || !hasItemDescription) return;
    const next = {
      en: (itemDescription.en ?? '').slice(0, CAROUSEL_DESCRIPTION_MAX),
      ar: (itemDescription.ar ?? '').slice(0, CAROUSEL_DESCRIPTION_MAX),
    };
    onUpdateMenu((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === active.id ? { ...item, carouselDescription: next } : item
      ),
    }));
  };

  const clearCustomDescription = () => {
    if (!active) return;
    onUpdateMenu((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== active.id) return item;
        const { carouselDescription: _dropped, ...rest } = item;
        void _dropped;
        return rest;
      }),
    }));
  };

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'بطاقات الكاروسيل' : 'Carousel Cards'}
        subtitle={
          isAr
            ? 'اضبط صورة كل بطاقة ووصفها داخل شكلها الحقيقي: اسحب الصورة أو كبّرها، واكتب وصفًا خاصًا بالكاروسيل إن أردت.'
            : 'Frame each card photo and write its copy inside the real card: drag or zoom the photo, and add a carousel-only description when needed.'
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
              : 'No featured items yet — star an item as Featured to edit its carousel card here.'}
          </p>
        ) : (
          <div className="space-y-3">
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label={isAr ? 'اختر صنفًا لضبط صورته' : 'Choose an item to frame'}
            >
              {featured.map((item) => {
                const name = pickLangText(item.name, lang) || item.id;
                const selected = active?.id === item.id;
                const customized = !isDefaultCarouselImage(normalizeCarouselImage(item.carouselImage));
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-pressed={selected}
                    className={`relative inline-flex min-h-[44px] max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                      selected
                        ? 'border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]'
                        : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-500'
                    }`}
                  >
                    <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-neutral-800">
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
                    {customized ? (
                      <span
                        className="absolute -top-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-neutral-900 bg-[var(--primary)]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>

            {active && adjust ? (
              <div className="space-y-3">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-neutral-200">
                        {isAr ? 'معاينة داخل البطاقة' : 'In-card preview'}
                      </p>
                      <p className="text-[9.5px] leading-relaxed text-neutral-500">
                        {isAr
                          ? 'نفس البطاقة والنص وشريط الطلب الذين يراهم العميل'
                          : 'The same card, text and order bar customers see'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <ToolButton
                        label={
                          showGrid
                            ? isAr
                              ? 'إخفاء شبكة التقسيم'
                              : 'Hide framing grid'
                            : isAr
                              ? 'إظهار شبكة التقسيم'
                              : 'Show framing grid'
                        }
                        onClick={() => setShowGrid((value) => !value)}
                        active={showGrid}
                        className="h-10 w-10 px-0"
                      >
                        <Grid3x3 size={15} aria-hidden="true" />
                      </ToolButton>
                      <div
                        className="inline-flex items-center rounded-xl border border-neutral-700 bg-neutral-950 p-0.5"
                        role="group"
                        aria-label={isAr ? 'معاينة البطاقة فاتحة أو داكنة' : 'Preview the card light or dark'}
                      >
                        <button
                          type="button"
                          onClick={() => setTheme('dark')}
                          aria-pressed={theme === 'dark'}
                          aria-label={isAr ? 'معاينة داكنة' : 'Dark preview'}
                          title={isAr ? 'معاينة داكنة' : 'Dark preview'}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                            theme === 'dark'
                              ? 'bg-[var(--primary)] text-[#0A0A0A]'
                              : 'text-neutral-400 hover:text-white'
                          }`}
                        >
                          <Moon size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setTheme('light')}
                          aria-pressed={theme === 'light'}
                          aria-label={isAr ? 'معاينة فاتحة' : 'Light preview'}
                          title={isAr ? 'معاينة فاتحة' : 'Light preview'}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                            theme === 'light'
                              ? 'bg-[var(--primary)] text-[#0A0A0A]'
                              : 'text-neutral-400 hover:text-white'
                          }`}
                        >
                          <Sun size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mx-auto w-full max-w-[430px]">
                    <CarouselCardPreview
                      key={`${active.id}:${active.imageUrl ?? ''}`}
                      item={active}
                      menu={menu}
                      lang={lang}
                      theme={theme}
                      index={activeIndex}
                      adjust={adjust}
                      onAdjust={hasPhoto ? patch : undefined}
                      showGrid={showGrid}
                    />
                  </div>

                  {!hasPhoto ? (
                    <p className="mt-2 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2.5 py-2 text-[10px] font-bold leading-relaxed text-[var(--primary)]">
                      {isAr
                        ? 'لا توجد صورة لهذا الصنف. أضف صورته من تبويب «الأصناف»، ثم ارجع هنا لضبطها داخل البطاقة.'
                        : 'This item has no photo. Add one from the “Items” tab, then come back here to frame it.'}
                    </p>
                  ) : null}

                  <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950/60 px-2.5 py-2 text-[9.5px] leading-relaxed text-neutral-500">
                    <Move size={13} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
                    <p>
                      {isAr
                        ? 'اسحب الصورة داخل البطاقة لتحريكها، واستخدم عجلة الفأرة أو إصبعين للتكبير والتصغير. يمكنك أيضًا تحريك البطاقة بالأسهم و + / − بعد التركيز عليها، وهذا لا يغيّر صورة الصنف في بقية الصفحات.'
                        : 'Drag the photo inside the card to move it, and use the wheel or two fingers to zoom. Arrow keys and + / − also work after focusing the card. This never changes the item photo elsewhere.'}
                    </p>
                  </div>
                </div>

                <div className="min-w-0 space-y-2.5">
                  <div className="rounded-2xl border border-neutral-800 bg-black/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-neutral-200">
                        {isAr ? 'حجم الصورة' : 'Photo size'}
                      </span>
                      <span
                        className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-bold tabular-nums text-neutral-100"
                        dir="ltr"
                      >
                        {Math.round(adjust.scale * 100)}%
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => zoomBy(-0.1)}
                        disabled={!hasPhoto || adjust.scale <= CAROUSEL_IMAGE_MIN_SCALE + 0.001}
                        aria-label={isAr ? 'تصغير الصورة' : 'Make photo smaller'}
                        title={isAr ? 'تصغير الصورة' : 'Make photo smaller'}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-700 bg-neutral-950 text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Minus size={16} aria-hidden="true" />
                      </button>
                      <input
                        type="range"
                        min={CAROUSEL_IMAGE_MIN_SCALE}
                        max={CAROUSEL_IMAGE_MAX_SCALE}
                        step={0.01}
                        value={adjust.scale}
                        dir="ltr"
                        disabled={!hasPhoto}
                        onChange={(event) => patch({ scale: Number(event.target.value) })}
                        aria-label={isAr ? 'حجم الصورة داخل البطاقة' : 'Photo size inside the card'}
                        className="h-8 min-w-0 flex-1 cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed"
                      />
                      <button
                        type="button"
                        onClick={() => zoomBy(0.1)}
                        disabled={!hasPhoto || adjust.scale >= CAROUSEL_IMAGE_MAX_SCALE - 0.001}
                        aria-label={isAr ? 'تكبير الصورة' : 'Make photo larger'}
                        title={isAr ? 'تكبير الصورة' : 'Make photo larger'}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-700 bg-neutral-950 text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-neutral-600" dir="ltr">
                      <span>{Math.round(CAROUSEL_IMAGE_MIN_SCALE * 100)}%</span>
                      <span>{Math.round(CAROUSEL_IMAGE_MAX_SCALE * 100)}%</span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-neutral-800 bg-black/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-neutral-200">
                        {isAr ? 'الموضع' : 'Position'}
                      </span>
                      <button
                        type="button"
                        onClick={() => patch({ x: 0, y: 0 })}
                        disabled={!hasPhoto || (adjust.x === 0 && adjust.y === 0)}
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-[10px] font-bold text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Crosshair size={12} aria-hidden="true" />
                        {isAr ? 'توسيط' : 'Center'}
                      </button>
                    </div>
                    <div className="mt-1 space-y-1">
                      <RangeField
                        icon={<MoveHorizontal size={12} aria-hidden="true" />}
                        label={isAr ? 'أفقي' : 'Horizontal'}
                        value={adjust.x}
                        display={panDisplay(adjust.x)}
                        min={-CAROUSEL_IMAGE_MAX_PAN}
                        max={CAROUSEL_IMAGE_MAX_PAN}
                        step={0.1}
                        disabled={!hasPhoto}
                        onChange={(value) => patch({ x: value })}
                      />
                      <RangeField
                        icon={<MoveVertical size={12} aria-hidden="true" />}
                        label={isAr ? 'رأسي' : 'Vertical'}
                        value={adjust.y}
                        display={panDisplay(adjust.y)}
                        min={-CAROUSEL_IMAGE_MAX_PAN}
                        max={CAROUSEL_IMAGE_MAX_PAN}
                        step={0.1}
                        disabled={!hasPhoto}
                        onChange={(value) => patch({ y: value })}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-neutral-800 bg-black/30 p-3">
                    <RangeField
                      icon={<RotateCw size={12} aria-hidden="true" />}
                      label={isAr ? 'التدوير' : 'Rotation'}
                      value={adjust.rotate}
                      display={`${Math.round(adjust.rotate)}°`}
                      min={-CAROUSEL_IMAGE_MAX_ROTATE}
                      max={CAROUSEL_IMAGE_MAX_ROTATE}
                      step={5}
                      disabled={!hasPhoto}
                      onChange={(value) => patch({ rotate: value })}
                    />
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      <ToolButton
                        label={isAr ? 'تدوير 90 درجة لليسار' : 'Rotate 90° left'}
                        onClick={() => patch({ rotate: adjust.rotate - 90 })}
                        disabled={!hasPhoto}
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                        <span dir="ltr">90°</span>
                      </ToolButton>
                      <ToolButton
                        label={isAr ? 'تدوير 90 درجة لليمين' : 'Rotate 90° right'}
                        onClick={() => patch({ rotate: adjust.rotate + 90 })}
                        disabled={!hasPhoto}
                      >
                        <RotateCw size={14} aria-hidden="true" />
                        <span dir="ltr">90°</span>
                      </ToolButton>
                      <ToolButton
                        label={isAr ? 'قلب أفقي' : 'Flip horizontally'}
                        onClick={() => patch({ flipX: !adjust.flipX })}
                        active={adjust.flipX === true}
                        disabled={!hasPhoto}
                      >
                        <FlipHorizontal2 size={14} aria-hidden="true" />
                        {isAr ? 'قلب أفقي' : 'Flip H'}
                      </ToolButton>
                      <ToolButton
                        label={isAr ? 'قلب رأسي' : 'Flip vertically'}
                        onClick={() => patch({ flipY: !adjust.flipY })}
                        active={adjust.flipY === true}
                        disabled={!hasPhoto}
                      >
                        <FlipVertical2 size={14} aria-hidden="true" />
                        {isAr ? 'قلب رأسي' : 'Flip V'}
                      </ToolButton>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={reset}
                    disabled={!hasPhoto || isDefault}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-950 px-3 text-[11px] font-bold text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Undo2 size={14} aria-hidden="true" />
                    {isAr ? 'إعادة ضبط الصورة' : 'Reset photo framing'}
                  </button>
                  <p className="text-[9.5px] leading-relaxed text-neutral-500">
                    {isAr
                      ? 'التعديلات تُحفظ مع القائمة، وتخص كاروسيل المميز فقط. لتغيير الصورة نفسها استخدم «تغيير الصورة» من تبويب الأصناف.'
                      : 'Changes save with the menu and apply to the featured carousel only. To replace the photo itself, use “Change photo” in the Items tab.'}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-black/30 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[11px] font-bold text-neutral-200">
                        {isAr ? 'وصف الكاروسيل' : 'Carousel description'}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                          hasCustomDescription
                            ? 'border-[var(--primary)]/30 bg-[var(--primary)]/15 text-[var(--primary)]'
                            : 'border-neutral-700 bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {hasCustomDescription
                          ? isAr
                            ? 'وصف مخصص'
                            : 'Custom copy'
                          : hasItemDescription
                            ? isAr
                              ? 'يتبع وصف الصنف'
                              : 'Uses item description'
                            : isAr
                              ? 'بدون وصف'
                              : 'No copy'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[9.5px] leading-relaxed text-neutral-500">
                      {isAr
                        ? 'نص يظهر في بطاقة الكاروسيل فقط، ولا يغيّر وصف الصنف في القائمة أو صفحة التفاصيل.'
                        : 'Copy shown in the carousel card only; it never changes the item description in the menu or details sheet.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {hasItemDescription ? (
                      <button
                        type="button"
                        onClick={useItemDescription}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2 text-[10px] font-bold text-[var(--primary)] transition-colors hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      >
                        <Copy size={13} aria-hidden="true" />
                        {isAr ? 'استخدام وصف الصنف' : 'Use item description'}
                      </button>
                    ) : null}
                    {hasCustomDescription ? (
                      <button
                        type="button"
                        onClick={clearCustomDescription}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-[10px] font-bold text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      >
                        <Undo2 size={13} aria-hidden="true" />
                        {isAr ? 'مسح الوصف المخصص' : 'Clear custom copy'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {hasItemDescription ? (
                  <p className="mt-1.5 rounded-lg bg-neutral-950/60 px-2.5 py-2 text-[9.5px] leading-relaxed text-neutral-500">
                    <span className="font-bold text-neutral-400">
                      {isAr ? 'وصف الصنف الحالي: ' : 'Current item description: '}
                    </span>
                    <span className="line-clamp-2">{itemDescriptionPreview}</span>
                  </p>
                ) : (
                  <p className="mt-1.5 rounded-lg border border-dashed border-neutral-700 px-2.5 py-2 text-[9.5px] leading-relaxed text-neutral-500">
                    {isAr
                      ? 'لا يوجد وصف للصنف — اكتب وصفًا خاصًا بالكاروسيل هنا.'
                      : 'This item has no description — write a carousel-only one here.'}
                  </p>
                )}

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-0.5 flex items-center justify-between gap-2 text-[10px] font-bold text-neutral-400">
                      <span>{isAr ? 'الوصف بالعربية' : 'Arabic description'}</span>
                      <span className="tabular-nums text-neutral-500" dir="ltr">
                        {descriptionAr.length}/{CAROUSEL_DESCRIPTION_MAX}
                      </span>
                    </span>
                    <textarea
                      rows={3}
                      maxLength={CAROUSEL_DESCRIPTION_MAX}
                      value={descriptionAr}
                      onChange={(event) => setDescriptionField('ar', event.target.value)}
                      dir="rtl"
                      placeholder={
                        isAr
                          ? 'اكتب وصفًا قصيرًا يظهر في بطاقة الكاروسيل...'
                          : 'Arabic carousel-only copy…'
                      }
                      className="w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-xs leading-relaxed text-white placeholder:text-neutral-600 focus:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 flex items-center justify-between gap-2 text-[10px] font-bold text-neutral-400">
                      <span>{isAr ? 'الوصف بالإنجليزية' : 'English description'}</span>
                      <span className="tabular-nums text-neutral-500" dir="ltr">
                        {descriptionEn.length}/{CAROUSEL_DESCRIPTION_MAX}
                      </span>
                    </span>
                    <textarea
                      rows={3}
                      maxLength={CAROUSEL_DESCRIPTION_MAX}
                      value={descriptionEn}
                      onChange={(event) => setDescriptionField('en', event.target.value)}
                      dir="ltr"
                      placeholder={
                        isAr
                          ? 'English carousel-only copy…'
                          : 'Write a short carousel-only description…'
                      }
                      className="w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-xs leading-relaxed text-white placeholder:text-neutral-600 focus:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    />
                  </label>
                </div>
                <p className="mt-1.5 text-[9px] leading-relaxed text-neutral-500">
                  {hasCustomDescription
                    ? isAr
                      ? 'هذا النص يظهر في الكاروسيل فقط. اترك لغة فارغة لاستخدام وصف الصنف بها.'
                      : 'This copy appears in the carousel only. Leave a language empty to use the item description there.'
                    : hasItemDescription
                      ? isAr
                        ? 'لا يوجد وصف مخصص بعد؛ يعرض الكاروسيل وصف الصنف تلقائيًا. اكتب هنا لتخصيصه.'
                        : 'No custom copy yet — the carousel currently shows the item description. Write here to override it.'
                      : isAr
                        ? 'اكتب وصفًا بالعربية أو الإنجليزية ليظهر في بطاقة الكاروسيل.'
                        : 'Write an Arabic or English description to show it on the carousel card.'}
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
