import React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { FeatureGroup, MenuData, MenuItem } from '@/src/types/menu';
import { featuresByGroup } from '@/src/utils/pricing';

interface ItemVariantsEditorProps {
  item: MenuItem;
  menu: MenuData;
  lang: 'en' | 'ar';
  sizesSection: FeatureGroup | undefined;
  onChange: (item: MenuItem) => void;
}

/** Sizes on this item (★ = default). */
export const ItemVariantsEditor: React.FC<ItemVariantsEditorProps> = ({
  item,
  menu,
  lang,
  sizesSection,
  onChange,
}) => {
  const isAr = lang === 'ar';
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs text-neutral-400">
          {isAr ? 'أحجام هذا الصنف (★ = الافتراضي)' : 'Sizes on this item (★ = default)'}
        </label>
      </div>
      <p className="text-[11px] text-neutral-500 mb-1.5">
        {isAr
          ? 'اللي تحط عليه النجمة هو الافتراضي — والنجمة ثابتة مكانها مبتحركش الترتيب. بدون نجمة: الأول افتراضياً.'
          : 'Whatever you star is the default — the star stays in place and never reorders. No star: the first is the default.'}
      </p>
      {((item.variants || []).length === 0) && (
        <p className="text-[11px] text-neutral-500 mb-1.5">
          {isAr ? 'بدون أحجام.' : 'No sizes.'}
        </p>
      )}
      {((item.variants || []).length > 0) && (
        <div className="rounded-xl border border-neutral-800 bg-black/30 px-2.5 sm:px-3 pt-2 pb-1 mb-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] font-extrabold text-[#FFC400]">
              {sizesSection ? (isAr ? sizesSection.name.ar : sizesSection.name.en) : (isAr ? 'الأحجام' : 'Sizes')}
            </p>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(isAr ? 'حذف كل الأحجام من الصنف؟' : 'Remove all sizes from this item?')) return;
                onChange({ ...item, variants: [], defaultVariant: undefined });
              }}
              className="btn-tactile shrink-0 w-6 h-6 rounded-full border border-neutral-700 text-neutral-500 hover:border-red-500 hover:text-red-400 hover:bg-red-900/30 transition-colors flex items-center justify-center"
              title={isAr ? 'حذف القسم كاملاً' : 'Remove whole section'}
              aria-label={isAr ? 'حذف القسم كاملاً' : 'Remove whole section'}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
      {(item.variants || []).map((v, vi) => {
        const isDefault = (item.defaultVariant ?? item.variants?.[0]?.featureId) === v.featureId;
        const vDef = (menu.settings.featureDefs || []).find((d) => d.id === v.featureId);
        const vInSizes = !!sizesSection && !!vDef && vDef.groupId === sizesSection.id;
        // A size already used in another row can't be picked again — no duplicates
        const takenV = new Set((item.variants || []).filter((_, i) => i !== vi).map((x) => x.featureId));
        const isFreeV = (id: string) => id === v.featureId || !takenV.has(id);
        const sizeOpts = sizesSection ? (menu.settings.featureDefs || []).filter((d) => d.groupId === sizesSection.id && isFreeV(d.id)) : [];
        return (
          <div key={`${v.featureId}-${vi}`} className="flex items-end gap-1.5 sm:gap-2 mb-1.5">
            <select
              value={v.featureId}
              onChange={(e) => {
              const vs = [...(item.variants || [])];
              vs[vi] = { ...vs[vi], featureId: e.target.value };
              onChange({ ...item, variants: vs });
            }}
              className="w-full min-w-0 h-9 px-2 rounded-lg bg-black border border-neutral-700 text-xs"
              aria-label={isAr ? 'الميزة' : 'Feature'}
            >
              {vInSizes ? null : <option value="">—</option>}
              {vInSizes && sizesSection ? (
                <optgroup label={isAr ? sizesSection.name.ar : sizesSection.name.en}>
                  {sizeOpts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {isAr ? d.name.ar : d.name.en}
                    </option>
                  ))}
                </optgroup>
              ) : (
              featuresByGroup(menu)
                .map(({ group, features }) => ({
                  group,
                  features: features.filter((d) => isFreeV(d.id)),
                }))
                .filter(({ features }) => features.length > 0)
                .map(({ group, features }) => (
                <optgroup key={group.id || 'other'} label={isAr ? group.name.ar : group.name.en}>
                  {features.map((d) => (
                    <option key={d.id} value={d.id}>
                      {isAr ? d.name.ar : d.name.en}
                    </option>
                  ))}
                </optgroup>
              )))}
            </select>
            <button
              type="button"
              onClick={() => {
                // Mark in place — row order never changes
                onChange({ ...item, defaultVariant: v.featureId });
              }}
              title={isAr ? 'الافتراضي' : 'Default'}
              aria-label={isAr ? 'اجعله الافتراضي' : 'Make default'}
              aria-pressed={isDefault}
              className={`shrink-0 self-center w-7 h-7 rounded-full border text-[10px] font-black transition-colors ${
                isDefault
                  ? 'bg-[#FFC400] text-[#0A0A0A] border-[#FFC400]'
                  : 'border-neutral-700 text-neutral-500 hover:border-[#FFC400] hover:text-[#FFC400]'
              }`}
            >
              ★
            </button>
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <span className={`text-[9px] font-bold text-neutral-500 leading-none${vi === 0 ? '' : ' invisible'}`}>{isAr ? 'السعر' : 'price'}</span>
              <input
                type="number"
                step="any"
                value={v.price}
                aria-label={isAr ? 'سعر الحجم' : 'Size price'}
                title={isAr ? 'سعر هذا الحجم لهذا الصنف' : 'This size’s price on this item'}
                onChange={(e) => {
                  const vs = [...(item.variants || [])];
                  vs[vi] = { ...vs[vi], price: Number(e.target.value) };
                  onChange({ ...item, variants: vs });
                }}
                className="w-16 sm:w-20 h-9 px-1.5 sm:px-2 rounded-lg bg-black border border-neutral-700 text-xs text-center tabular-nums"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                const vs = (item.variants || []).filter((_, i) => i !== vi);
                onChange({
                  ...item,
                  variants: vs,
                  defaultVariant: vs.some((x) => x.featureId === item.defaultVariant)
                    ? item.defaultVariant
                    : undefined,
                });
              }}
              className="p-1 self-center text-neutral-400 hover:text-red-400"
              title="Remove"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      {(() => {
        const usedV = new Set((item.variants || []).map((x) => x.featureId));
        const missingV = sizesSection
          ? (menu.settings.featureDefs || []).filter((d) => d.groupId === sizesSection.id && !usedV.has(d.id))
          : [];
        return missingV.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5 pb-1.5">
            {missingV.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onChange({
                    ...item,
                    variants: [...(item.variants || []), { featureId: d.id, price: 0 }],
                  });
                }}
                className="btn-tactile px-2.5 py-1 rounded-full border border-dashed border-neutral-600 text-neutral-400 text-[10px] font-bold hover:border-[#FFC400] hover:text-[#FFC400]"
              >
                <Plus size={10} className="inline me-1" />
                {isAr ? d.name.ar : d.name.en}
              </button>
            ))}
          </div>
        ) : null;
      })()}
        </div>
      )}
      {((item.variants || []).length === 0) && (
      <button
        type="button"
        onClick={() => {
          // Direct bulk: everything inside the sizes section drops in
          // at once — no picker, no questions
          if (!sizesSection) {
            alert(
              isAr
                ? 'لا يوجد قسم أحجام — أنشئ قسماً وسمّه أحجام (Sizes) في المكتبة أولاً'
                : 'No sizes section — create one and name it Sizes in the library first'
            );
            return;
          }
          const used = new Set((item.variants || []).map((x) => x.featureId));
          const fresh = (menu.settings.featureDefs || []).filter(
            (d) => d.groupId === sizesSection.id && !used.has(d.id)
          );
          if (fresh.length === 0) {
            alert(isAr ? 'كل الأحجام مضافة بالفعل' : 'All sizes already added');
            return;
          }
          onChange({
            ...item,
            variants: [...(item.variants || []), ...fresh.map((d) => ({ featureId: d.id, price: 0 }))],
          });
        }}
        className="btn-tactile px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-[#FFC400] hover:text-[#FFC400]"
      >
        <Plus size={12} className="inline me-1" />
        {isAr ? 'إضافة حجم' : 'Add size'}
      </button>
      )}
    </div>
  );
};
