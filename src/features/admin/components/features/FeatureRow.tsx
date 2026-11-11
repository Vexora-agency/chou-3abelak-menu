import React from 'react';
import { Flame, Lock, Trash2 } from 'lucide-react';
import type { FeatureDef, MenuData, MenuSettings } from '@/src/types/menu';
import { normalizePricing } from '@/src/utils/pricing';
import { isProtectedFeatureId, isSpicyFeatureId } from '@/src/utils/menuHelpers';

type LibraryValues = Pick<MenuSettings, 'featureGroups' | 'featureDefs'>;

interface FeatureRowProps {
  f: FeatureDef;
  menu: MenuData;
  isAr: boolean;
  onConfirm: (box: {
    title: string;
    body: string;
    confirmText: string;
    mode?: 'confirm' | 'info';
    action?: () => void;
  }) => void;
  /** Delete this feature everywhere: stripped from all items, then removed. */
  onDeleteFeatures: (defIds: string[]) => void;
  onUpdate: (updater: (prev: LibraryValues) => LibraryValues) => void;
}

export const FeatureRow: React.FC<FeatureRowProps> = ({
  f,
  menu,
  isAr,
  onConfirm,
  onDeleteFeatures,
  onUpdate,
}) => {
  const usage = menu.items.filter(
    (it) =>
      (it.variants || []).some((v) => v.featureId === f.id) ||
      (it.addons || []).some((a) => a.featureId === f.id)
  ).length;
  return (
    <div key={f.id} className="p-3 space-y-3">
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">Name (EN)</label>
          <input
            type="text"
            value={f.name.en}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                featureDefs: (prev.featureDefs || []).map((x) =>
                  x.id === f.id ? { ...x, name: { ...x.name, en: e.target.value } } : x
                ),
              }))
            }
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">الاسم (AR)</label>
          <input
            type="text"
            dir="rtl"
            value={f.name.ar}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                featureDefs: (prev.featureDefs || []).map((x) =>
                  x.id === f.id ? { ...x, name: { ...x.name, ar: e.target.value } } : x
                ),
              }))
            }
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-neutral-500 flex items-center gap-1.5">
          {isSpicyFeatureId(f.id) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-500/10 border border-red-500/40 text-red-400">
              <Flame size={11} />
              {isAr ? 'حار' : 'Spicy'}
            </span>
          )}
          {usage > 0
            ? isAr ? `مستخدمة في ${usage} أصناف` : `Used by ${usage} items`
            : isAr ? 'غير مستخدمة' : 'Unused'}
        </span>
        {isProtectedFeatureId(f.id) ? (
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)] text-[11px] font-bold"
            title={isAr ? 'ميزة ثابتة لا يمكن حذفها' : 'Built-in feature, cannot be deleted'}
          >
            <Lock size={12} />
            {isAr ? 'ثابتة' : 'Built-in'}
          </span>
        ) : (
        <button
          type="button"
          onClick={() => {
            const n = menu.items.filter(
              (it) =>
                (it.variants || []).some((v) => v.featureId === f.id) ||
                (it.addons || []).some((a) => a.featureId === f.id)
            ).length;
            if (n > 0) {
              // Free delete: the feature is stripped from the items too.
              // Items left with no sizes become fixed-price at the same amount.
              const doomed = menu.items.filter((it) => {
                const vs = it.variants || [];
                return (
                  vs.length === 1 &&
                  vs[0].featureId === f.id &&
                  normalizePricing(it).price === undefined
                );
              }).length;
              const featName = ((isAr ? f.name.ar : f.name.en) || f.id);
              onConfirm({
                title: isAr ? `حذف "${featName}"؟` : `Delete "${featName}"?`,
                body: isAr
                  ? `مستخدمة في ${n === 1 ? 'صنف واحد' : `${n} أصناف`} — ستُحذف منها أيضًا.${
                      doomed > 0
                        ? ` ${doomed === 1 ? 'صنف واحد' : `${doomed} أصناف`} سيفقد مقاسه الوحيد ويتحول لسعر ثابت بنفس السعر.`
                        : ''
                    }`
                  : `Used by ${n === 1 ? '1 item' : `${n} items`} — it will also be removed from those items.${
                      doomed > 0
                        ? ` ${doomed === 1 ? '1 item' : `${doomed} items`} will lose their only size and switch to a fixed price instead.`
                        : ''
                    }`,
                confirmText: isAr ? 'حذف' : 'Delete',
                action: () => onDeleteFeatures([f.id]),
              });
              return;
            }
            const featName = ((isAr ? f.name.ar : f.name.en) || f.id);
            onConfirm({
              title: isAr ? `حذف "${featName}"؟` : `Delete "${featName}"?`,
              body: isAr
                ? 'غير مستخدمة حاليًا. الحذف نهائي ولا يمكن التراجع عنه.'
                : 'Currently unused. Deletion is permanent and cannot be undone.',
              confirmText: isAr ? 'حذف' : 'Delete',
              action: () =>
                onUpdate((prev) => ({
                  ...prev,
                  featureDefs: (prev.featureDefs || []).filter((x) => x.id !== f.id),
                })),
            });
          }}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-500/40 text-red-400 text-[11px] font-bold hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={12} />
          {isAr ? 'حذف' : 'Delete'}
        </button>
        )}
      </div>
    </div>
  );
};
