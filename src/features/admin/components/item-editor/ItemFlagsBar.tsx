import React from 'react';
import { Award, Flame, Sparkles } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { isNewItem as isItemNew } from '@/src/utils/pricing';

interface ItemFlagsBarProps {
  item: MenuItem;
  menu: MenuData;
  lang: 'en' | 'ar';
  onChange: (item: MenuItem) => void;
}

/** Badges checkboxes + featured/available toggles + NEW-window control. */
export const ItemFlagsBar: React.FC<ItemFlagsBarProps> = ({
  item,
  menu,
  lang,
  onChange,
}) => {
  const isAr = lang === 'ar';
  return (
    <>
      {/* Badges Checkboxes (same icons as the menu) */}
      <div>
        <label className="block text-xs text-neutral-400 mb-1.5">{isAr ? 'الشارات' : 'Badges'}</label>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {([
            { id: 'new', en: 'New', ar: 'جديد' },
            { id: 'spicy', en: 'Spicy', ar: 'حار' },
            { id: 'top', en: 'Top', ar: 'الأكثر طلبًا' },
          ] as const).map((b) => (
            <label key={b.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={item.badges.includes(b.id)}
                onChange={(e) => {
                  const newBadges = e.target.checked
                    ? [...item.badges, b.id]
                    : item.badges.filter((x) => x !== b.id);
                  onChange({ ...item, badges: newBadges });
                }}
                className="w-4 h-4 rounded text-[var(--primary)]"
              />
              {b.id === 'spicy' && <Flame size={12} className="fill-[var(--primary)] text-[var(--primary)]" />}
              {b.id === 'top' && <Award size={12} className="fill-[var(--primary)] text-[var(--primary)]" />}
              {b.id === 'new' && <Sparkles size={12} className="text-[var(--primary)]" />}
              <span className="capitalize">{isAr ? b.ar : b.en}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Featured & Available toggles */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 border-t border-neutral-800">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={item.featured}
            onChange={(e) =>
              onChange({ ...item, featured: e.target.checked })
            }
            className="w-4 h-4 rounded text-[var(--primary)]"
          />
          <span className="font-bold">{isAr ? '★ مميز في الكاروسيل' : '★ Featured in Carousel'}</span>
        </label>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={item.available}
            onChange={(e) =>
              onChange({ ...item, available: e.target.checked })
            }
            className="w-4 h-4 rounded text-[var(--primary)]"
          />
          <span className="font-bold">{isAr ? 'متوفر في المخزون' : 'Available in Stock'}</span>
        </label>
      </div>

      {/* NEW badge control (automatic window from addedAt) */}
      <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 flex items-center justify-between gap-3">
        <div className="text-xs">
          {isItemNew(menu, item) ? (
            <>
              <span className="font-extrabold text-[var(--primary)]">{isAr ? 'NEW مفعّلة' : 'NEW active'}</span>
              <span className="block text-[11px] text-neutral-500 mt-0.5">
                {isAr ? 'تختفي تلقائيًا بعد مدة الـ NEW' : 'Auto-removed after the NEW period'}
                {item.addedAt ? ` (${new Date(item.addedAt).toLocaleDateString()})` : ''}
              </span>
            </>
          ) : (
            <span className="text-neutral-400">
              {isAr ? 'ليست NEW حاليًا' : 'Not NEW right now'}
            </span>
          )}
        </div>
        {isItemNew(menu, item) ? (
          <button
            type="button"
            onClick={() => {
              const copy = { ...item };
              delete (copy as Partial<MenuItem>).addedAt;
              onChange(copy);
            }}
            className="px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-red-400 hover:text-red-400"
          >
            {isAr ? 'إزالة شارة الجديد' : 'Remove new'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onChange({ ...item, addedAt: new Date().toISOString() })}
            className="btn-tactile px-3 py-1.5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-[11px] font-bold"
          >
            {isAr ? 'اعتبره جديد' : 'Mark as new'}
          </button>
        )}
      </div>
    </>
  );
};
