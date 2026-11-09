import React from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import type { MenuData } from '@/src/types/menu';
import { Pager } from './Pager';

interface CategoriesTabProps {
  categories: MenuData['categories'];
  page: number;
  pageSize: number;
  lang: 'en' | 'ar';
  onPageChange: (p: number) => void;
  onAdd: () => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
  onDelete: (catId: string) => void;
  onUpdate: (updater: (prev: MenuData['categories']) => MenuData['categories']) => void;
}

/** Categories tab body of the admin panel. */
export const CategoriesTab: React.FC<CategoriesTabProps> = ({
  categories,
  page,
  pageSize,
  lang,
  onPageChange,
  onAdd,
  onMove,
  onDelete,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="space-y-4 stagger">
      <div className="flex justify-between items-center mb-2">
        <h2 className={`text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`}>
          {categories.length} {isAr ? 'أقسام مضافة' : 'Categories'}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="btn-tactile px-3.5 py-1.5 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-bold text-xs flex items-center gap-1"
        >
          <Plus size={14} />
          <span>{isAr ? 'إضافة قسم جديد' : 'Add Category'}</span>
        </button>
      </div>

      <div className="space-y-2.5">
        {(() => {
          const pageCount = Math.max(1, Math.ceil(categories.length / pageSize));
          const safe = Math.max(0, Math.min(page, Math.max(0, pageCount - 1)));
          const shown = categories.slice(safe * pageSize, safe * pageSize + pageSize);
          return (
            <>
              {shown.map((cat) => {
                const idx = categories.findIndex((c) => c.id === cat.id);
                const activeLayout = cat.layout || (cat.id === 'manakish' ? 'list' : 'cards');
                return (
          <div
            key={cat.id}
            className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2.5"
          >
          <div className="flex items-center gap-3">
            {/* Reorder Buttons */}
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={idx === 0}
                onClick={() => onMove(idx, 'up')}
                className="p-1 rounded text-neutral-400 hover:text-white disabled:opacity-20"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                disabled={idx === categories.length - 1}
                onClick={() => onMove(idx, 'down')}
                className="p-1 rounded text-neutral-400 hover:text-white disabled:opacity-20"
              >
                <ChevronDown size={14} />
              </button>
            </div>

            {/* Name inputs */}
            <div className="flex-1 grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
              <input
                type="text"
                value={cat.name.en}
                onChange={(e) =>
                  onUpdate((prev) => prev.map((c) =>
                    c.id === cat.id ? { ...c, name: { ...c.name, en: e.target.value } } : c
                  ))
                }
                className="h-11 min-h-[44px] px-2.5 rounded bg-black border border-neutral-700 text-sm text-white"
                placeholder="Category (EN)"
              />
              <input
                type="text"
                dir="rtl"
                value={cat.name.ar}
                onChange={(e) =>
                  onUpdate((prev) => prev.map((c) =>
                    c.id === cat.id ? { ...c, name: { ...c.name, ar: e.target.value } } : c
                  ))
                }
                className="h-11 min-h-[44px] px-2.5 rounded bg-black border border-neutral-700 text-sm text-white"
                placeholder="القسم (عربي)"
              />
            </div>

            {/* Visibility Toggle */}
            <button
              type="button"
              onClick={() =>
                onUpdate((prev) => prev.map((c) =>
                  c.id === cat.id ? { ...c, visible: !c.visible } : c
                ))
              }
              className={`p-2 rounded-lg ${
                cat.visible ? 'text-green-400 bg-green-500/10' : 'text-neutral-500 bg-neutral-800'
              }`}
              title={cat.visible ? 'Visible' : 'Hidden'}
            >
              {cat.visible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>

            {/* Delete */}
            <button
              type="button"
              onClick={() => onDelete(cat.id)}
              className="p-2 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10"
            >
              <Trash2 size={16} />
            </button>
          </div>

          {/* Display layout: cards grid, text-first list, compact rows,
              photo-first cards or round dish cards */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-neutral-500 font-bold">{isAr ? 'الشكل:' : 'Style:'}</span>
            <div className="flex flex-wrap gap-1 p-0.5 bg-black rounded-full border border-neutral-800" role="group" aria-label={isAr ? 'شكل القسم' : 'Section style'}>
              {(['cards', 'list', 'compact', 'photos', 'round'] as const).map((l) => {
                const active = activeLayout === l;
                return (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      onUpdate((prev) => prev.map((c) =>
                        c.id === cat.id ? { ...c, layout: l } : c
                      ))
                    }
                    className={`px-3 h-7 rounded-full text-[11px] font-bold transition-colors ${active ? 'bg-[var(--primary)] text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}
                  >
                    {l === 'cards' ? (isAr ? 'بطاقات' : 'Cards') : l === 'list' ? (isAr ? 'قائمة' : 'List') : l === 'compact' ? (isAr ? 'مدمج' : 'Compact') : l === 'photos' ? (isAr ? 'معرض' : 'Gallery') : (isAr ? 'دائري' : 'Round')}
                  </button>
                );
              })}
            </div>
          </div>
          {activeLayout === 'photos' && (
            <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-neutral-500">
              <ImageIcon size={12} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
              <span>
                {isAr
                  ? 'أضف صورة لكل صنف من تبويب الأصناف (حقل الصورة: رفع ثم قص الإطار). الأصناف بدون صورة بتظهر بشعار القسم.'
                  : 'Add a photo to each item from the Items tab (photo field: upload, then frame the crop). Items without one show the category mark.'}
              </span>
            </p>
          )}
          {activeLayout === 'cards' && (
            <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-neutral-500">
              <ImageIcon size={12} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
              <span>
                {isAr
                  ? 'الصنف اللي له صورة بتظهر خلفية للكارت مع تعتيم مريح للقراءة. الأصناف بدون صورة بتفضل كروت نصية.'
                  : 'Items with a photo show it as the card background behind a readable scrim. Items without one stay text cards.'}
              </span>
            </p>
          )}
          {activeLayout === 'round' && (
            <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-neutral-500">
              <ImageIcon size={12} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
              <span>
                {isAr
                  ? 'صورة دائرية بإطار دوّار — أضف صورة لكل صنف من تبويب الأصناف. الأصناف بدون صورة بتظهر بشعار القسم.'
                  : 'Round photo in a spinning ring — add a photo to each item from the Items tab. Items without one show the category mark.'}
              </span>
            </p>
          )}
          </div>
                );
              })}
              <Pager
                page={safe}
                pageCount={pageCount}
                onChange={onPageChange}
                from={categories.length === 0 ? 0 : safe * pageSize + 1}
                to={Math.min(categories.length, safe * pageSize + pageSize)}
                total={categories.length}
                unit={isAr ? 'من' : 'of'}
              />
            </>
          );
        })()}
      </div>
    </div>
  );
};
