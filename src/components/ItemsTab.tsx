import React from 'react';
import { Award, ChevronDown, ChevronUp, Copy, Flame, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { normalizePricing, priceLabel } from '@/src/utils/pricing';
import { Pager } from '@/src/components/Pager';

export type ItemBadgeFilter = 'all' | 'new' | 'spicy' | 'top';

interface ItemsTabProps {
  menu: MenuData;
  search: string;
  categoryFilter: string;
  badgeFilter: ItemBadgeFilter;
  page: number;
  pageSize: number;
  lang: 'en' | 'ar';
  onSearchChange: (v: string) => void;
  onCategoryFilterChange: (v: string) => void;
  onBadgeFilterChange: (v: ItemBadgeFilter) => void;
  onPageChange: (p: number) => void;
  onAdd: () => void;
  onOpenItem: (item: MenuItem, isNew: boolean) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onDuplicate: (item: MenuItem) => void;
  onDelete: (id: string) => void;
  onUpdateItems: (updater: (prev: MenuData['items']) => MenuData['items']) => void;
}

/** Items tab body of the admin panel (list only — the edit modal stays mounted by the parent). */
export const ItemsTab: React.FC<ItemsTabProps> = ({
  menu,
  search,
  categoryFilter,
  badgeFilter,
  page,
  pageSize,
  lang,
  onSearchChange,
  onCategoryFilterChange,
  onBadgeFilterChange,
  onPageChange,
  onAdd,
  onOpenItem,
  onMove,
  onDuplicate,
  onDelete,
  onUpdateItems,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="space-y-4 stagger">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={isAr ? 'بحث في الوجبات...' : 'Search items...'}
              className="h-9 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-xs w-full"
            />
            <select
              value={categoryFilter}
              onChange={(e) => onCategoryFilterChange(e.target.value)}
            className="h-9 px-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs"
          >
            <option value="all">{isAr ? 'كل الأقسام' : 'All Categories'}</option>
            {menu.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name.en}
              </option>
            ))}
          </select>
            <select
              value={badgeFilter}
              onChange={(e) => onBadgeFilterChange(e.target.value as ItemBadgeFilter)}
            className="h-9 px-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs"
            aria-label={isAr ? 'فلترة بالشارة' : 'Filter by badge'}
          >
            <option value="all">{isAr ? 'كل الشارات' : 'All Badges'}</option>
            <option value="new">{isAr ? 'جديد' : 'New'}</option>
            <option value="spicy">{isAr ? 'حار' : 'Spicy'}</option>
            <option value="top">{isAr ? 'الأكثر طلباً' : 'Top'}</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="btn-tactile px-3.5 py-2 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-bold text-xs flex items-center gap-1 shadow-md"
        >
          <Plus size={14} />
          <span>{isAr ? 'إضافة وجبة' : 'Add Item'}</span>
        </button>
      </div>

      {/* Items List */}
      <div className="space-y-2.5">
        {(() => {
          const filtered = menu.items.filter((i) => {
            if (categoryFilter !== 'all' && i.categoryId !== categoryFilter) return false;
            if (badgeFilter !== 'all' && !i.badges.includes(badgeFilter)) return false;
            if (!search) return true;
            return (
              i.name.en.toLowerCase().includes(search.toLowerCase()) ||
              i.name.ar.toLowerCase().includes(search.toLowerCase())
            );
          });
          const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
          const safe = Math.max(0, Math.min(page, Math.max(0, pageCount - 1)));
          const shown = filtered.slice(safe * pageSize, safe * pageSize + pageSize);
          return (
            <>
              {shown.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition-colors"
            >
                <div
                  onClick={() => onOpenItem({ ...item, pricing: normalizePricing(item) }, false)}
                  className="flex-1 min-w-0 cursor-pointer"
                >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-white truncate">
                    {isAr ? item.name.ar : item.name.en}
                  </span>
                  {/* Badges — same icons as the customer menu */}
                  {item.badges.includes('new') && (
                    <span title={isAr ? 'جديد' : 'New'} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#0A0A0A] text-[var(--primary)] border border-[var(--primary)]">
                      <Sparkles size={10} />
                    </span>
                  )}
                  {item.badges.includes('spicy') && (
                    <span title={isAr ? 'حار' : 'Spicy'} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#0A0A0A] text-[var(--primary)] border border-[var(--primary)]">
                      <Flame size={10} />
                    </span>
                  )}
                  {item.badges.includes('top') && (
                    <span title={isAr ? 'الأكثر طلباً' : 'Top'} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#0A0A0A] text-[var(--primary)] border border-[var(--primary)]">
                      <Award size={10} />
                    </span>
                  )}
                  {item.featured && (
                    <span title={isAr ? 'مميز — يظهر في الكاروسيل' : 'Featured — shows in the carousel'} className="text-[10px] bg-[var(--primary)] text-black font-extrabold px-1.5 py-0.5 rounded">
                      ★
                    </span>
                  )}
                  {!item.available && (
                    <span className="text-[10px] bg-red-500/20 text-red-400 font-bold px-1.5 py-0.5 rounded">
                      {isAr ? 'نفذت الكمية' : 'Sold out'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-neutral-400 mt-0.5">
                  {priceLabel(item, lang, menu.settings.currency[lang] || menu.settings.currency.en)} ·{' '}
                  {menu.categories.find((c) => c.id === item.categoryId)?.name[lang] || item.categoryId}
                </div>
              </div>

              {/* Quick Toggles & Actions */}
              <div className="flex items-center gap-1.5">
                {/* Available toggle */}
                <button
                  type="button"
                  onClick={() =>
                    onUpdateItems((prev) => prev.map((i) =>
                      i.id === item.id ? { ...i, available: !i.available } : i
                    ))
                  }
                  className={`text-xs px-2 py-1 rounded-md font-bold ${
                    item.available
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-neutral-800 text-neutral-500'
                  }`}
                  title={isAr ? 'تبديل التوفر' : 'Toggle availability'}
                >
                  {item.available ? (isAr ? 'متوفر' : 'In Stock') : (isAr ? 'نافذ' : 'Out')}
                </button>

                {/* Move Up/Down */}
                <button
                  type="button"
                  onClick={() => onMove(item.id, 'up')}
                  className="p-1 text-neutral-400 hover:text-white"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(item.id, 'down')}
                  className="p-1 text-neutral-400 hover:text-white"
                >
                  <ChevronDown size={14} />
                </button>

                {/* Duplicate */}
                <button
                  type="button"
                  onClick={() => onDuplicate(item)}
                  className="p-1.5 text-neutral-400 hover:text-[var(--primary)]"
                  title="Duplicate"
                >
                  <Copy size={14} />
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  className="p-1.5 text-neutral-400 hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
              ))}
              <Pager
                page={safe}
                pageCount={pageCount}
                onChange={onPageChange}
                from={filtered.length === 0 ? 0 : safe * pageSize + 1}
                to={Math.min(filtered.length, safe * pageSize + pageSize)}
                total={filtered.length}
                unit={isAr ? 'من' : 'of'}
              />
            </>
          );
        })()}
      </div>
    </div>
  );
};
