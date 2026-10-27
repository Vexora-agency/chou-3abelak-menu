import React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { FeatureGroup, MenuData, MenuItem } from '@/src/types/menu';
import { featuresByGroup } from '@/src/utils/pricing';

interface ItemAddonsEditorProps {
  item: MenuItem;
  menu: MenuData;
  lang: 'en' | 'ar';
  pickingAddonSec: boolean;
  nonEmptySections: FeatureGroup[];
  sizesSection: FeatureGroup | undefined;
  onChange: (item: MenuItem) => void;
  onToggleAddonPicker: () => void;
  onCloseAddonPicker: () => void;
}

/** Add-ons enabled on this item (price here, 0 = free). */
export const ItemAddonsEditor: React.FC<ItemAddonsEditorProps> = ({
  item,
  menu,
  lang,
  pickingAddonSec,
  nonEmptySections,
  sizesSection,
  onChange,
  onToggleAddonPicker,
  onCloseAddonPicker,
}) => {
  const isAr = lang === 'ar';
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs text-neutral-400">{isAr ? 'إضافات هذا الصنف' : 'Add-ons on this item'}</label>
      </div>
      {((item.addons || []).length === 0) && (
        <p className="text-[11px] text-neutral-500 mb-1.5">
          {isAr ? 'بدون إضافات.' : 'No add-ons.'}
        </p>
      )}
      {(() => {
        const addons = item.addons || [];
        const defOf = (fid: string) => (menu.settings.featureDefs || []).find((d) => d.id === fid);
        const validGroupOf = (fid: string) => {
          const def = defOf(fid);
          if (!def) return '';
          if (sizesSection && def.groupId === sizesSection.id) return '';
          return (menu.settings.featureGroups || []).some((g) => g.id === def.groupId) ? def.groupId : '';
        };
        const box = (a: { featureId: string; price: number }, ai: number, gid: string, showPrice: boolean) => {
          const ownGroup = gid ? (menu.settings.featureGroups || []).find((g) => g.id === gid) : undefined;
          // A feature already used in another box can't be picked again — no duplicates
          const takenElsewhere = new Set(
            (item.addons || []).filter((_, i) => i !== ai).map((x) => x.featureId)
          );
          const isFree = (id: string) => id === a.featureId || !takenElsewhere.has(id);
          const ownFeats = gid ? (menu.settings.featureDefs || []).filter((d) => d.groupId === gid && isFree(d.id)) : null;
          return (
          <div key={`${a.featureId}-${ai}`} className="flex items-end gap-1.5 sm:gap-2 mb-1.5">
            <select
              value={a.featureId}
              onChange={(e) => {
              const list = [...(item.addons || [])];
              list[ai] = { ...list[ai], featureId: e.target.value };
              onChange({ ...item, addons: list });
            }}
              className="w-full min-w-0 h-9 px-2 rounded-lg bg-black border border-neutral-700 text-xs"
              aria-label={isAr ? 'الميزة' : 'Feature'}
            >
              {gid ? null : <option value="">—</option>}
              {ownFeats ? (
                <optgroup label={isAr ? (ownGroup?.name.ar ?? '') : (ownGroup?.name.en ?? '')}>
                  {ownFeats.map((d) => (
                    <option key={d.id} value={d.id}>
                      {isAr ? d.name.ar : d.name.en}
                    </option>
                  ))}
                </optgroup>
              ) : (
              featuresByGroup(menu)
                .filter(({ group }) => !(sizesSection && group.id && group.id === sizesSection.id))
                .map(({ group, features }) => ({
                  group,
                  features: features.filter((d) => isFree(d.id)),
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
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <span className={`text-[9px] font-bold text-neutral-500 leading-none${showPrice ? '' : ' invisible'}`}>{isAr ? 'السعر' : 'price'}</span>
              <input
                type="number"
                step="any"
                value={a.price}
                aria-label={isAr ? 'سعر الإضافة' : 'Add-on price'}
                title={isAr ? 'سعر هذه الإضافة لهذا الصنف (0 = مجاناً)' : 'This add-on’s price on this item (0 = free)'}
                onChange={(e) => {
                  const list = [...(item.addons || [])];
                  list[ai] = { ...list[ai], price: Number(e.target.value) };
                  onChange({ ...item, addons: list });
                }}
                className="w-16 sm:w-20 h-9 px-1.5 sm:px-2 rounded-lg bg-black border border-neutral-700 text-xs text-center tabular-nums"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onChange({ ...item, addons: (item.addons || []).filter((_, i) => i !== ai) });
              }}
              className="p-1 self-center text-neutral-400 hover:text-red-400"
              title="Remove"
            >
              <Trash2 size={14} />
            </button>
          </div>
          );
        };
        return (
          <>
            {(menu.settings.featureGroups || [])
              .filter((g) => !(sizesSection && g.id === sizesSection.id))
              .filter((g) => addons.some((a) => validGroupOf(a.featureId) === g.id))
              .map((g) => {
                const missing = (menu.settings.featureDefs || []).filter(
                  (d) => d.groupId === g.id && !addons.some((a) => a.featureId === d.id)
                );
                return (
                <div key={g.id} className="rounded-xl border border-neutral-800 bg-black/30 px-2.5 sm:px-3 pt-2 pb-1 mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[11px] font-extrabold text-[#FFC400]">
                      {isAr ? g.name.ar : g.name.en}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(isAr ? 'حذف كل ميزات هذا القسم من الصنف؟' : 'Remove all features of this section from this item?')) return;
                        onChange({
                          ...item,
                          addons: (item.addons || []).filter((a) => validGroupOf(a.featureId) !== g.id),
                        });
                      }}
                      className="btn-tactile shrink-0 w-6 h-6 rounded-full border border-neutral-700 text-neutral-500 hover:border-red-500 hover:text-red-400 hover:bg-red-900/30 transition-colors flex items-center justify-center"
                      title={isAr ? 'حذف القسم كاملاً' : 'Remove whole section'}
                      aria-label={isAr ? 'حذف القسم كاملاً' : 'Remove whole section'}
                    >
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  </div>
                  {addons
                    .map((a, ai) => ({ a, ai }))
                    .filter((x) => validGroupOf(x.a.featureId) === g.id)
                    .map((x, gi) => box(x.a, x.ai, g.id, gi === 0))}
                  {missing.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5 pb-1.5">
                      {missing.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            onChange({
                              ...item,
                              addons: [...(item.addons || []), { featureId: d.id, price: 0 }],
                            });
                          }}
                          className="btn-tactile px-2.5 py-1 rounded-full border border-dashed border-neutral-600 text-neutral-400 text-[10px] font-bold hover:border-[#FFC400] hover:text-[#FFC400]"
                        >
                          <Plus size={10} className="inline me-1" />
                          {isAr ? d.name.ar : d.name.en}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
            {addons
              .map((a, ai) => ({ a, ai }))
              .filter((x) => !validGroupOf(x.a.featureId))
              .map((x, oi) => box(x.a, x.ai, '', oi === 0))}
          </>
        );
      })()}
      <button
        type="button"
        onClick={() => onToggleAddonPicker()}
        className="btn-tactile px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-[#FFC400] hover:text-[#FFC400]"
      >
        <Plus size={12} className="inline me-1" />
        {isAr ? 'إضافة إضافة' : 'Add add-on'}
      </button>
      {pickingAddonSec && (() => {
        const usedIds = new Set((item.addons || []).map((x) => x.featureId));
        const candidateSecs = nonEmptySections.filter((g) => !(sizesSection && g.id === sizesSection.id));
        const groupIdOf = (fid: string) => (menu.settings.featureDefs || []).find((d) => d.id === fid)?.groupId ?? '';
        const openSecs = candidateSecs.filter((g) =>
          !(item.addons || []).some((a) => groupIdOf(a.featureId) === g.id)
        );
        return (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-neutral-500">
            {isAr ? 'اختر قسماً — كل ميزاته ستضاف دفعة واحدة:' : 'Pick a section — all its features get added at once:'}
          </p>
          {candidateSecs.length === 0 && (
            <p className="text-[11px] text-neutral-500">
              {isAr ? 'لا توجد أقسام — أنشئها من المكتبة أولاً' : 'No sections — create them in the library first'}
            </p>
          )}
          {candidateSecs.length > 0 && openSecs.length === 0 && (
            <p className="text-[11px] text-neutral-500">
              {isAr ? 'كل الأقسام مضافة بالفعل' : 'All sections already added'}
            </p>
          )}
          {openSecs.map((g) => {
            const feats = (menu.settings.featureDefs || []).filter((d) => d.groupId === g.id);
            const remaining = feats.filter((d) => !usedIds.has(d.id)).length;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  const fresh = feats.filter((d) => !usedIds.has(d.id));
                  if (fresh.length === 0) {
                    alert(isAr ? 'كل ميزات هذا القسم مضافة بالفعل' : 'All features of this section already added');
                    return;
                  }
                  onChange({
                    ...item,
                    addons: [...(item.addons || []), ...fresh.map((d) => ({ featureId: d.id, price: 0 }))],
                  });
                  onCloseAddonPicker();
                }}
                className="btn-tactile w-full text-start rounded-xl border border-neutral-700 bg-black/40 px-3 py-2 hover:border-[#FFC400] transition-colors"
              >
                <span className="flex items-center justify-between gap-2">
                  <b className="text-xs text-white">{isAr ? g.name.ar : g.name.en}</b>
                  <span className="text-[10px] text-neutral-500 tabular-nums">
                    {isAr ? `${remaining} جديدة` : `${remaining} new`}
                  </span>
                </span>
                <span className="block text-[11px] text-neutral-400 mt-0.5 leading-relaxed">
                  {feats.map((d) => (isAr ? d.name.ar : d.name.en)).join(' · ')}
                </span>
              </button>
            );
          })}
        </div>
        );
      })()}
      <p className="text-[11px] text-neutral-500 mt-1.5">
        {isAr
          ? 'السعر يُكتب هنا لكل صنف — وهو الذي يظهر للزبون محسوباً مع الكمية. لو الميزة ناقصة أنشئها من مكتبة الميزات.'
          : 'The price is written here per item — it is what the customer sees, multiplied by quantity. If a feature is missing, create it in the Features library.'}
      </p>
    </div>
  );
};
