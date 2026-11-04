import React from 'react';
import { Flame, Plus, Trash2, X, Star } from 'lucide-react';
import type { FeatureGroup, ItemAddon, MenuData, MenuItem } from '@/src/types/menu';
import { featureName, featuresByGroup } from '@/src/utils/pricing';
import { isSpicyAddon } from '@/src/utils/menuHelpers';

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
  // A badged-spicy item offering a "Make It Spicy" option is a contradiction:
  // the badge says the heat is inherent, the option says it's optional.
  const spicyOverlap = (item.badges || []).includes('spicy')
    && (item.addons || []).some((a) => a.featureId === 'spicy');
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs text-neutral-400">{isAr ? 'مكتبة الميزات' : 'Features Library'}</label>
      </div>
      {spicyOverlap && (
        <div className="mb-2 rounded-xl border border-red-500/50 bg-red-950/40 px-3 py-2 flex items-center justify-between gap-2">
          <p className="text-[11px] leading-relaxed text-red-200">
            <Flame size={12} className="inline me-1 -mt-0.5" />
            {isAr
              ? 'هذا الصنف عليه شارة «حار» — خيار «إضافة حار» زائد ويشتّت الزبون. الشارة تكفي.'
              : 'This item is badged Spicy — the “Make It Spicy” option is redundant and confuses customers. The badge is enough.'}
          </p>
          <button
            type="button"
            onClick={() => onChange({ ...item, addons: (item.addons || []).filter((a) => a.featureId !== 'spicy') })}
            className="btn-tactile shrink-0 px-2.5 py-1 rounded-full bg-red-500 text-white text-[10px] font-bold hover:brightness-110"
          >
            {isAr ? 'أزل خيار الحار' : 'Remove spicy option'}
          </button>
        </div>
      )}
      {((item.addons || []).length === 0) && (
        <p className="text-[11px] text-neutral-500 mb-1.5">
          {isAr ? 'لا توجد مكتبات مرفقة — أرفق واحدة أدناه.' : 'No libraries attached — attach one below.'}
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
        const box = (a: ItemAddon, ai: number, gid: string, showPrice: boolean) => {
          const ownGroup = gid ? (menu.settings.featureGroups || []).find((g) => g.id === gid) : undefined;
          // A feature already used in another box can't be picked again — no duplicates
          const takenElsewhere = new Set(
            (item.addons || []).filter((_, i) => i !== ai).map((x) => x.featureId)
          );
          const isFree = (id: string) => id === a.featureId || !takenElsewhere.has(id);
          const ownFeats = gid ? (menu.settings.featureDefs || []).filter((d) => d.groupId === gid && isFree(d.id)) : null;
          // Spicy row marker: a native <select> can't render icons inside its
          // options, so the flame lives next to it — instantly visible while
          // scanning the add-on list. Matched by id OR display name so a
          // custom-named spicy feature (any id) still gets its flame.
          const spicyRow = isSpicyAddon(a.featureId, featureName(menu, a.featureId, lang));
          return (
          <div key={`${a.featureId}-${ai}`} className="flex items-end gap-1.5 sm:gap-2 mb-1.5">
            {spicyRow && (
              <span
                className="shrink-0 w-9 h-9 min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center bg-red-500/10 border border-red-500/40 text-red-400 self-center"
                title={isAr ? 'خيار الحار' : 'Spicy option'}
                aria-hidden="true"
              >
                <Flame size={15} />
              </span>
            )}
            <select
              value={a.featureId}
              onChange={(e) => {
              const list = [...(item.addons || [])];
              list[ai] = { ...list[ai], featureId: e.target.value };
              onChange({ ...item, addons: list });
            }}
              className="w-full min-w-0 h-11 min-h-[44px] px-2 rounded-lg bg-black border border-neutral-700 text-xs"
              aria-label={isAr ? 'الميزة' : 'Feature'}
            >
              {gid ? null : <option value="">—</option>}
              {/* Orphan id (legacy/import, not in the library): show it so
                  the row never renders blank and forces a re-pick. */}
              {a.featureId && !(menu.settings.featureDefs || []).some((d) => d.id === a.featureId) && (
                <option value={a.featureId}>
                  {featureName(menu, a.featureId, lang)} ({isAr ? 'غير مسجل' : 'unlisted'})
                </option>
              )}
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
                min={0}
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
                const list = [...(item.addons || [])];
                const next = { ...list[ai] };
                if (next.default) delete next.default;
                else next.default = true;
                list[ai] = next;
                onChange({ ...item, addons: list });
              }}
              className={`p-1 self-center transition-colors ${a.default ? 'text-[var(--primary)]' : 'text-neutral-600 hover:text-[var(--primary)]'}`}
              title={isAr ? 'مضمّنة افتراضياً — تظهر مختارة للزبون ويقدر يشيلها' : 'Included by default — pre-selected for the customer, who can remove it'}
              aria-pressed={!!a.default}
              aria-label={isAr ? 'تضمين افتراضي' : 'Include by default'}
            >
              <Star size={14} fill={a.default ? 'currentColor' : 'none'} />
            </button>
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
                const mode = g.selection === 'single' ? 'single' : 'multi';
                const pEn = typeof g.prompt?.en === 'string' ? g.prompt.en : '';
                const pAr = typeof g.prompt?.ar === 'string' ? g.prompt.ar : '';
                const promptText = ((isAr ? pAr : pEn).trim() || (isAr ? pEn : pAr).trim());
                // Non-blocking: the customer sheet pre-selects the first.
                const defaultCount = (item.addons || []).filter(
                  (a) => a.default === true && (menu.settings.featureDefs || []).some((d) => d.id === a.featureId && d.groupId === g.id)
                ).length;
                const missing = (menu.settings.featureDefs || []).filter(
                  (d) => d.groupId === g.id && !addons.some((a) => a.featureId === d.id)
                );
                return (
                <div key={g.id} className="rounded-xl border border-neutral-800 bg-black/30 px-2.5 sm:px-3 pt-2 pb-1 mb-2">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <p className="text-[11px] font-extrabold text-[var(--primary)] truncate">
                        {isAr ? g.name.ar : g.name.en}
                      </p>
                      <span className="shrink-0 px-2 py-0.5 rounded-full border border-neutral-700 text-neutral-400 text-[10px] font-bold">
                        {mode === 'single'
                          ? (isAr ? 'اختيار واحد' : 'One choice')
                          : (isAr ? 'اختيارات متعددة' : 'Multiple')}
                      </span>
                    </span>
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
                  {promptText ? (
                    <p className="text-[11px] text-neutral-400 leading-relaxed mb-1">{promptText}</p>
                  ) : null}
                  {mode === 'single' && defaultCount >= 2 && (
                    <p className="text-[11px] leading-relaxed text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5 mb-1.5">
                      {isAr
                        ? 'تنبيه: خياران أو أكثر مُعلَّمة كافتراضية في مكتبة «اختيار واحد» — شاشة الزبون تختار الأول مسبقاً.'
                        : 'Heads-up: two or more options are starred as default in a One-choice library — the customer sheet pre-selects the first.'}
                    </p>
                  )}
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
                      className={`btn-tactile px-2.5 py-1 rounded-full border border-dashed text-[10px] font-bold hover:border-[var(--primary)] hover:text-[var(--primary)] ${
                        isSpicyAddon(d.id, d.name.ar) || isSpicyAddon(d.id, d.name.en)
                          ? 'border-red-500/60 text-red-300'
                          : 'border-neutral-600 text-neutral-400'
                      }`}
                    >
                      <Plus size={10} className="inline me-1" />
                      {(isSpicyAddon(d.id, d.name.ar) || isSpicyAddon(d.id, d.name.en)) && <Flame size={10} className="inline me-0.5 -mt-0.5 text-red-400" aria-hidden="true" />}
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
        className="btn-tactile px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-[var(--primary)] hover:text-[var(--primary)]"
      >
        <Plus size={12} className="inline me-1" />
        {isAr ? 'إرفاق مكتبة' : 'Attach library'}
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
            {isAr ? 'اختر مكتبة — كل ميزاتها ستُرفق بسعر 0 دفعة واحدة:' : 'Pick a library — all its features attach at price 0 at once:'}
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
                className="btn-tactile w-full text-start rounded-xl border border-neutral-700 bg-black/40 px-3 py-2 hover:border-[var(--primary)] transition-colors"
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
          ? 'السعر يُكتب هنا لكل صنف — وهو الذي يظهر للزبون محسوباً مع الكمية. النجمة ★ تعني أن الإضافة مختارة مسبقاً للزبون (ويقدر يشيلها). لو الميزة ناقصة أنشئها من مكتبة الميزات.'
          : 'The price is written here per item — it is what the customer sees, multiplied by quantity. The star ★ means the add-on is pre-selected for the customer (who can still remove it). If a feature is missing, create it in the Features library.'}
      </p>
    </div>
  );
};
