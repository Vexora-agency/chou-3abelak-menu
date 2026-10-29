import React, { useEffect, useState } from 'react';
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
  const committedInitial = Number.isInteger(
    (showMore as { initial?: unknown } | undefined)?.initial
  )
    ? ((showMore as { initial: number }).initial)
    : 12;
  const committedBatch = Number.isInteger(
    (showMore as { batch?: unknown } | undefined)?.batch
  )
    ? ((showMore as { batch: number }).batch)
    : 8;
  // Free-text drafts: typing commits NOTHING until blur/Enter. Committing
  // (or autosaving) mid-typing is what made values snap back — the server
  // clamps out-of-range drafts to 4..50 and the round-trip overwrote the
  // half-typed number. Drafts never touch menu state, so autosave can't fight
  // the typing either.
  const [draft, setDraft] = useState<{ initial: string; batch: string } | null>(null);
  const shownInitial = draft?.initial ?? String(committedInitial);
  const shownBatch = draft?.batch ?? String(committedBatch);
  // Reconcile: whenever the committed values change (save round-trip, undo,
  // external edit), the draft has served its purpose — drop it so the truth
  // shows. Typing never triggers this (committed is stable mid-typing), so
  // focus and half-typed text survive; no remount, no focus loss.
  useEffect(() => {
    setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional sync on committed values only
  }, [committedInitial, committedBatch]);
  const clamp48 = (v: number) => Math.min(50, Math.max(4, v));
  const commit = (key: 'initial' | 'batch') => {
    const text = (draft?.[key] ?? '').trim();
    const v = text === '' ? NaN : Math.round(Number(text));
    // Invalid text reverts (draft dropped by the effect-free path below).
    if (!Number.isInteger(v)) {
      setDraft(null);
      return;
    }
    const clamped = clamp48(v);
    onUpdate((prev) => ({
      ...prev,
      showMore: {
        initial: key === 'initial' ? clamped : committedInitial,
        batch: key === 'batch' ? clamped : committedBatch,
      },
    }));
    // Display follows local state synchronously (no waiting for the server,
    // which clamps identically) — then the effect above reconciles.
  };
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
            value={shownInitial}
            onChange={(e) => setDraft((d) => ({ batch: shownBatch, ...d, initial: e.target.value }))}
            onBlur={() => commit('initial')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
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
            value={shownBatch}
            onChange={(e) => setDraft((d) => ({ initial: shownInitial, ...d, batch: e.target.value }))}
            onBlur={() => commit('batch')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
      </div>
      {biggest && biggest.n > 0 && (
        <p className="text-[11px] text-neutral-500">
          {isAr
            ? `مثال: ${biggest.name} (${biggest.n}) ← ${committedInitial} أولًا ثم دفعات ${committedBatch}`
            : `Example: ${biggest.name} (${biggest.n}) → ${committedInitial} first, then batches of ${committedBatch}`}
        </p>
      )}
    </div>
  );
};
