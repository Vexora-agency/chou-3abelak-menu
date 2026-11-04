import React from 'react';
import { ChevronDown, Lock, Plus, Trash2 } from 'lucide-react';
import type { MenuData, MenuSettings } from '@/src/types/menu';
import { featuresByGroup, normalizePricing } from '@/src/utils/pricing';
import { isProtectedGroupId } from '@/src/utils/menuHelpers';
import { FeatureRow } from './features/FeatureRow';
import { FeatureSectionFooter } from './features/FeatureSectionFooter';

type LibraryValues = Pick<MenuSettings, 'featureGroups' | 'featureDefs'>;

/** The sizes section (id "sizes" or a sizes-like name) stays
 *  single-required by design — no choice-mode toggle there. */
function isSizesGroup(g: { id: string; name: { en: string; ar: string } }): boolean {
  if (g.id === 'sizes') return true;
  const names = [g.name?.en, g.name?.ar].map((s) => (s || '').trim().toLowerCase());
  return names.some((n) => n === 'size' || n === 'sizes' || n === 'أحجام' || n === 'احجام');
}

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

interface GroupChoiceModeProps {
  group: { id: string; name: { en: string; ar: string }; selection?: 'single' | 'multi'; prompt?: { en: string; ar: string } };
  isAr: boolean;
  isSizes: boolean;
  promptOpen: boolean;
  onTogglePrompt: () => void;
  onUpdate: (updater: (prev: LibraryValues) => LibraryValues) => void;
}

/** Per-section choice mode + optional customer title. The sizes section stays
 *  single-required by design and the locked spicy section stays
 *  single-choice (mild/medium/extra-hot) — both toggles render disabled. */
const GroupChoiceMode: React.FC<GroupChoiceModeProps> = ({
  group,
  isAr,
  isSizes,
  promptOpen,
  onTogglePrompt,
  onUpdate,
}) => {
  const isLockedSingle = isSizes || isProtectedGroupId(group.id);
  const sel = group.selection === 'single' ? 'single' : 'multi';
  const open = promptOpen || !!((group.prompt?.en || '').trim() || (group.prompt?.ar || '').trim());
  const setSel = (mode: 'single' | 'multi') =>
    onUpdate((prev) => ({
      ...prev,
      featureGroups: (prev.featureGroups || []).map((x) =>
        x.id === group.id ? { ...x, selection: mode } : x
      ),
    }));
  const setPrompt = (side: 'en' | 'ar', value: string) =>
    onUpdate((prev) => ({
      ...prev,
      featureGroups: (prev.featureGroups || []).map((x) =>
        x.id === group.id
          ? { ...x, prompt: { en: x.prompt?.en ?? '', ar: x.prompt?.ar ?? '', [side]: value } }
          : x
      ),
    }));
  const btn = (active: boolean) =>
    `px-3 h-9 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
      active ? 'bg-[var(--primary)] text-[#0A0A0A]' : 'text-neutral-300 hover:text-[var(--primary)]'
    }`;
  return (
    <div className="rounded-xl border border-neutral-800 bg-black/30 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-neutral-400">{isAr ? 'وضع الاختيار' : 'Choice mode'}</span>
        <div
          className={`inline-flex rounded-full border border-neutral-700 overflow-hidden ${isLockedSingle ? 'opacity-50' : ''}`}
          role="group"
          aria-label={isAr ? 'وضع الاختيار' : 'Choice mode'}
        >
          <button
            type="button"
            disabled={isLockedSingle}
            aria-pressed={sel === 'single'}
            onClick={() => setSel('single')}
            className={btn(sel === 'single')}
            title={isAr ? 'اختيار واحد' : 'One choice'}
          >
            {isAr ? 'اختيار واحد' : 'One choice'}
          </button>
          <button
            type="button"
            disabled={isLockedSingle}
            aria-pressed={sel === 'multi'}
            onClick={() => setSel('multi')}
            className={`${btn(sel === 'multi')} border-s border-neutral-700`}
            title={isAr ? 'اختيارات متعددة' : 'Multiple'}
          >
            {isAr ? 'اختيارات متعددة' : 'Multiple'}
          </button>
        </div>
      </div>
      {isLockedSingle && (
        <p className="text-[11px] text-neutral-500">
          {isProtectedGroupId(group.id)
            ? (isAr
              ? 'قسم الحار اختيار واحد بطبيعته (درجة واحدة للطلب) — لا وضع اختيار هنا.'
              : 'The spicy section is one choice by design (one heat level per order) — no choice mode here.')
            : (isAr
              ? 'الأحجام اختيار واحد إجباري بطبيعتها — لا وضع اختيار هنا.'
              : 'Sizes stay single-required by design — no choice mode here.')}
        </p>
      )}
      <button
        type="button"
        onClick={onTogglePrompt}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-start text-xs text-neutral-400 hover:text-neutral-200"
      >
        <span>{isAr ? 'عنوان للزبون (اختياري)' : 'Customer title (optional)'}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'العنوان (EN)' : 'Title (EN)'}</label>
              <input
                type="text"
                value={group.prompt?.en ?? ''}
                maxLength={120}
                onChange={(e) => setPrompt('en', e.target.value)}
                placeholder={isAr ? 'مثال: اختر نوع مشروبك' : 'e.g. Choose your drink type'}
                className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'العنوان (AR)' : 'Title (AR)'}</label>
              <input
                type="text"
                dir="rtl"
                value={group.prompt?.ar ?? ''}
                maxLength={120}
                onChange={(e) => setPrompt('ar', e.target.value)}
                placeholder={isAr ? 'مثال: اختر نوع مشروبك' : 'e.g. Choose your drink type'}
                className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
              />
            </div>
          </div>
          <p className="text-[11px] text-neutral-500">
            {isAr
              ? 'يظهر فوق خيارات هذا القسم عند الزبون. اتركه فارغاً بدون عنوان.'
              : 'Shown above this section’s choices in the customer sheet. Leave empty for no title.'}
          </p>
        </div>
      )}
    </div>
  );
};

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
  // Per-section prompt disclosure (open when the section already has one).
  const [promptOpen, setPromptOpen] = React.useState<Record<string, boolean>>({});
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div>
        <h2 className={`text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`}>
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
              isProtectedGroupId(group.id) ? (
                <span
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)] text-[11px] font-bold"
                  title={isAr ? 'قسم ثابت لا يمكن حذفه' : 'Locked section, cannot be deleted'}
                >
                  <Lock size={12} />
                  {isAr ? 'ثابت' : 'Locked'}
                </span>
              ) : (
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
              )
            ) : null}
          </button>

          {!collapsed[group.id] && (
            <div className="px-3 pb-3 space-y-3">
              {group.id ? (
                <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
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
              {group.id ? (
                <GroupChoiceMode
                  group={group}
                  isAr={isAr}
                  isSizes={isSizesGroup(group)}
                  promptOpen={!!promptOpen[group.id]}
                  onTogglePrompt={() =>
                    setPromptOpen((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                  }
                  onUpdate={onUpdate}
                />
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
