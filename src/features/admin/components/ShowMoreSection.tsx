import React from 'react';
import type { MenuData, MenuSettings } from '@/src/types/menu';

type ShowMoreValues = Pick<MenuSettings, 'showMore'>;

interface ShowMoreSectionProps extends ShowMoreValues {
  menu: MenuData;
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: ShowMoreValues) => ShowMoreValues) => void;
}

const clamp412 = (v: number, fb: number) =>
  Number.isInteger(v) && v >= 4 && v <= 50 ? v : fb;

/** Show-more paging controls: how many items a long section shows first and
 *  per tap. The expander appears only when the rest is worth a tap (> 4). */
export const ShowMoreSection: React.FC<ShowMoreSectionProps> = ({
  menu,
  showMore,
  lang,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  const initial = clamp412(showMore?.initial, 12);
  const batch = clamp412(showMore?.batch, 8);
  // Live example from the longest visible category.
  const biggest = menu.categories
    .map((c) => ({
      name: isAr ? c.name.ar : c.name.en,
      n: menu.items.filter((i) => i.categoryId === c.id).length,
    }))
    .sort((a, b) => b.n - a.n)[0];
  const setNum = (key: 'initial' | 'batch', fb: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.round(Number(e.target.value));
    onUpdate((prev) => ({
      ...prev,
      showMore: {
        initial: key === 'initial' ? clamp412(v, fb) : clamp412(prev.showMore?.initial, 12),
        batch: key === 'batch' ? clamp412(v, fb) : clamp412(prev.showMore?.batch, 8),
      },
    }));
  };
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div>
        <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
          {isAr ? 'عرض المزيد في الأقسام' : 'Section Show-More'}
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {isAr
            ? 'الأقسام الطويلة تُطوى، والزر يكشف دفعات. الزر يظهر فقط عندما يستحق الباقي ضغطة (أكثر من 4).'
            : 'Long sections collapse; the button reveals batches. It appears only when the rest is worth a tap (more than 4).'}
        </p>
      </div>
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">
            {isAr ? 'عدد البداية (4 - 50)' : 'Initial count (4 - 50)'}
          </label>
          <input
            type="number"
            min={4}
            max={50}
            step={1}
            value={initial}
            onChange={setNum('initial', 12)}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">
            {isAr ? 'عدد كل دفعة (4 - 50)' : 'Batch size (4 - 50)'}
          </label>
          <input
            type="number"
            min={4}
            max={50}
            step={1}
            value={batch}
            onChange={setNum('batch', 8)}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
      </div>
      {biggest && biggest.n > 0 && (
        <p className="text-[11px] text-neutral-500">
          {isAr
            ? `مثال: ${biggest.name} (${biggest.n}) ← ${initial} أولًا ثم دفعات ${batch}`
            : `Example: ${biggest.name} (${biggest.n}) → ${initial} first, then batches of ${batch}`}
        </p>
      )}
    </div>
  );
};
