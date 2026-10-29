import React from 'react';
import type { MenuData, MenuSettings } from '@/src/types/menu';

type ShowMoreValues = Pick<MenuSettings, 'showMore'>;

interface ShowMoreSectionProps extends ShowMoreValues {
  menu: MenuData;
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: ShowMoreValues) => ShowMoreValues) => void;
}

/** Show-more paging controls: how many items a long section shows first and
 *  per tap. The expander appears only when the rest is worth a tap (> 4). */
export const ShowMoreSection: React.FC<ShowMoreSectionProps> = ({
  menu,
  showMore,
  lang,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  // Displayed as typed (raw ints); clamping lives server-side on save.
  const rawInitial = (showMore as { initial?: unknown } | undefined)?.initial;
  const rawBatch = (showMore as { batch?: unknown } | undefined)?.batch;
  const initial = Number.isInteger(rawInitial) ? (rawInitial as number) : 12;
  const batch = Number.isInteger(rawBatch) ? (rawBatch as number) : 8;
  const biggest = menu.categories
    .map((c) => ({
      name: isAr ? c.name.ar : c.name.en,
      n: menu.items.filter((i) => i.categoryId === c.id).length,
    }))
    .sort((a, b) => b.n - a.n)[0];
  // NOTE: no clamping while typing — clamping every keystroke makes multi-digit
  // values untypable ("20" snaps back at the "2"). Raw ints are stored; the
  // server clamps to 4..50 on save and the storefront clamps on read, so an
  // out-of-range draft can never leak anywhere visible.
  const setNum = (key: 'initial' | 'batch', fb: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const v = raw.trim() === '' ? fb : Math.round(Number(raw));
    const stored = Number.isInteger(v) ? v : fb;
    onUpdate((prev) => ({
      ...prev,
      showMore: {
        initial: key === 'initial' ? stored : (Number.isInteger(prev.showMore?.initial) ? (prev.showMore as { initial: number }).initial : 12),
        batch: key === 'batch' ? stored : (Number.isInteger(prev.showMore?.batch) ? (prev.showMore as { batch: number }).batch : 8),
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
