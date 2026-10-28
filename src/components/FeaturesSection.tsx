import React from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { MenuData, MenuSettings } from '@/src/types/menu';
import { featuresByGroup, normalizePricing } from '@/src/utils/pricing';
import { FeatureRow } from '@/src/components/features/FeatureRow';
import { FeatureSectionFooter } from '@/src/components/features/FeatureSectionFooter';

type LibraryValues = Pick<MenuSettings, 'featureGroups' | 'featureDefs'>;

export interface AdminConfirmBox {
  title: string;
  body: string;
  confirmText: string;
  mode?: 'confirm' | 'info';
  action?: () => void;
}

interface FeaturesSectionProps {
  menu: MenuData;
  collapsed: Record<string, boolean>;
  lang: 'en' | 'ar';
  onToggleCollapse: (groupId: string) => void;
  onConfirm: (box: AdminConfirmBox) => void;
  /** Delete features everywhere: strips them from all items, then removes
   *  the defs (and the group when a section is deleted). */
  onDeleteFeatures: (defIds: string[], groupId?: string) => void;
  onUpdate: (updater: (prev: LibraryValues) => LibraryValues) => void;
}

/** Features Library card of the admin Settings tab. */
export const FeaturesSection: React.FC<FeaturesSectionProps> = ({
  menu,
  collapsed,
  lang,
  onToggleCollapse,
  onConfirm,
  onDeleteFeatures,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div>
        <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
          {isAr ? 'مكتبة الميزات' : 'Features Library'}
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {isAr
            ? 'جهّز الخيارات هنا مرة واحدة بالأسماء، ثم فعّلها وسعّرها من داخل كل صنف'
            : 'Define the options here once by name, then enable and price them inside each item'}
        </p>
      </div>

      {featuresByGroup(menu).map(({ group, features }) => (
        <div key={group.id || '(ungrouped)'} className="rounded-xl border border-neutral-800 bg-black/40 overflow-hidden">
          <button
            type="button"
            onClick={() => group.id && onToggleCollapse(group.id)}
            className="w-full flex items-center justify-between gap-3 p-3 text-start"
          >
            <span className="flex items-center gap-2 min-w-0">
              <ChevronDown size={15} className={`shrink-0 text-neutral-500 transition-transform duration-300 ${collapsed[group.id] ? '' : 'rotate-180'}`} />
              <span className="font-extrabold text-sm text-white truncate">
                {group.id ? (isAr ? group.name.ar : group.name.en) || group.id : (isAr ? 'أخرى' : 'Other')}
              </span>
              <span className="shrink-0 text-[11px] text-neutral-500 tabular-nums">{features.length}</span>
            </span>
            {group.id ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  const sectionName = ((isAr ? group.name.ar : group.name.en) || group.id);
                  const inItems = menu.items.filter(
                    (it) =>
                      (it.variants || []).some((v) => (menu.settings.featureDefs || []).some((x) => x.id === v.featureId && x.groupId === group.id)) ||
                      (it.addons || []).some((a) => (menu.settings.featureDefs || []).some((x) => x.id === a.featureId && x.groupId === group.id))
                  ).length;
                  if (inItems > 0) {
                    // Free delete: features are stripped from the items too.
                    const defIds = (menu.settings.featureDefs || [])
                      .filter((x) => x.groupId === group.id)
                      .map((x) => x.id);
                    const doomed = menu.items.filter((it) => {
                      const vs = it.variants || [];
                      return (
                        vs.length > 0 &&
                        vs.every((v) =>
                          (menu.settings.featureDefs || []).some((x) => x.id === v.featureId && x.groupId === group.id)
                        ) &&
                        normalizePricing(it).price === undefined
                      );
                    }).length;
                    onConfirm({
                      title: isAr ? `حذف قسم "${sectionName}"؟` : `Delete the "${sectionName}" section?`,
                      body: isAr
                        ? `ميزاته مستخدمة في ${inItems === 1 ? 'صنف واحد' : `${inItems} أصناف`} — ستُحذف منها أيضاً.${
                            doomed > 0
                              ? ` ${doomed === 1 ? 'صنف واحد' : `${doomed} أصناف`} سيفقد مقاسه الوحيد ويتحول لسعر ثابت بنفس السعر.`
                              : ''
                          }`
                        : `Its features are used by ${inItems === 1 ? '1 item' : `${inItems} items`} — they will also be removed from those items.${
                            doomed > 0
                              ? ` ${doomed === 1 ? '1 item' : `${doomed} items`} will lose their only size and switch to a fixed price instead.`
                              : ''
                          }`,
                      confirmText: isAr ? 'حذف القسم' : 'Delete section',
                      action: () => onDeleteFeatures(defIds, group.id),
                    });
                    return;
                  }
                  const n = (menu.settings.featureDefs || []).filter((x) => x.groupId === group.id).length;
                  onConfirm({
                    title: isAr ? `حذف قسم "${sectionName}"؟` : `Delete the "${sectionName}" section?`,
                    body: isAr
                      ? n === 0
                        ? 'القسم فارغ. الحذف نهائي ولا يمكن التراجع عنه.'
                        : `القسم فيه ${n === 1 ? 'ميزة واحدة' : `${n} ميزات`} وستحذف معه. الحذف نهائي ولا يمكن التراجع عنه.`
                      : n === 0
                        ? 'The section is empty. Deletion is permanent and cannot be undone.'
                        : `The section holds ${n === 1 ? '1 feature' : `${n} features`}, which will be deleted with it. Deletion is permanent and cannot be undone.`,
                    confirmText: isAr ? 'حذف القسم' : 'Delete section',
                    action: () =>
                      onUpdate((prev) => ({
                        featureGroups: (prev.featureGroups || []).filter((x) => x.id !== group.id),
                        featureDefs: (prev.featureDefs || []).filter((x) => x.groupId !== group.id),
                      })),
                  });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-500/40 text-red-400 text-[11px] font-bold hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                <Trash2 size={12} />
                {isAr ? 'حذف القسم' : 'Delete section'}
              </span>
            ) : null}
          </button>

          {!collapsed[group.id] && (
            <div className="px-3 pb-3 space-y-3">
              {group.id ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'اسم القسم (EN)' : 'Section name (EN)'}</label>
                    <input
                      type="text"
                      value={group.name.en}
                      onChange={(e) =>
                        onUpdate((prev) => ({
                          ...prev,
                          featureGroups: (prev.featureGroups || []).map((x) =>
                            x.id === group.id ? { ...x, name: { ...x.name, en: e.target.value } } : x
                          ),
                        }))
                      }
                      className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'اسم القسم (AR)' : 'Section name (AR)'}</label>
                    <input
                      type="text"
                      dir="rtl"
                      value={group.name.ar}
                      onChange={(e) =>
                        onUpdate((prev) => ({
                          ...prev,
                          featureGroups: (prev.featureGroups || []).map((x) =>
                            x.id === group.id ? { ...x, name: { ...x.name, ar: e.target.value } } : x
                          ),
                        }))
                      }
                      className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                    />
                  </div>
                </div>
              ) : null}
              {features.length === 0 ? (
                <p className="text-[11px] text-neutral-500">
                  {isAr ? 'فارغ — أضف ميزة من الزر أدناه.' : 'Empty — add a feature below.'}
                </p>
              ) : (
                <div className="rounded-xl border border-neutral-800 bg-black/40 divide-y divide-neutral-800 overflow-hidden">
                  {features.map((f) => (
                    <FeatureRow key={f.id} f={f} menu={menu} isAr={isAr} onConfirm={onConfirm} onDeleteFeatures={onDeleteFeatures} onUpdate={onUpdate} />
                  ))}
                </div>
              )}

              {group.id ? (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate((prev) => ({
                        ...prev,
                        featureDefs: [
                          ...(prev.featureDefs || []),
                          { id: `f_${Date.now().toString(36)}`, groupId: group.id, name: { en: '', ar: '' } },
                        ],
                      }))
                    }
                    className="btn-tactile px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    <Plus size={12} className="inline me-1" />
                    {isAr ? 'إضافة هنا' : 'Add here'}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ))}

      <FeatureSectionFooter isAr={isAr} onUpdate={onUpdate} />
    </div>
  );
};
