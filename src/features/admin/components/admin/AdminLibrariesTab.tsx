import React from 'react';
import type { MenuData } from '@/src/types/menu';
import { isProtectedFeatureId, isProtectedGroupId } from '@/src/utils/menuHelpers';
import { FeaturesSection } from '../FeaturesSection';

interface AdminLibrariesTabProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  onUpdateMenu: (updater: (prev: MenuData) => MenuData) => void;
  collapsedGroups: Record<string, boolean>;
  onToggleCollapse: (gid: string) => void;
  onConfirm: (box: {
    title: string;
    body: string;
    confirmText: string;
    mode?: 'confirm' | 'info';
    action?: () => void;
  }) => void;
}

/** TAB 3: LIBRARIES — reusable option libraries (sizes + add-ons) with
    customer prompts and single/multi choice modes. Moved out of Settings
    so store configuration stays separate from menu content. */
export const AdminLibrariesTab: React.FC<AdminLibrariesTabProps> = ({
  menu, lang, onUpdateMenu, collapsedGroups, onToggleCollapse, onConfirm,
}) => {
  return (
    <div className="space-y-6 stagger">
      <FeaturesSection
        menu={menu}
        collapsed={collapsedGroups}
        lang={lang}
        onToggleCollapse={onToggleCollapse}
        onConfirm={onConfirm}
        onDeleteFeatures={(defIds, groupId) =>
          onUpdateMenu((m) => {
            // Protected built-ins (spicy levels) survive any delete: group
            // wipes, "remove everywhere" confirms, or direct calls. The
            // locked spicy SECTION itself is likewise never removed.
            const gone = new Set(defIds.filter((id) => !isProtectedFeatureId(id)));
            const dropGroup = groupId && !isProtectedGroupId(groupId) ? groupId : null;
            const items = m.items.map((it) => {
              const hadSizes = Array.isArray(it.variants) && it.variants.length > 0;
              const variants = (it.variants || []).filter((v) => v && !gone.has(v.featureId));
              const removed = (it.variants || []).filter((v) => v && gone.has(v.featureId));
              const addons = (it.addons || []).filter((a) => a && !gone.has(a.featureId));
              let next = it;
              if (variants.length !== (it.variants || []).length) {
                if (hadSizes && variants.length === 0) {
                  // Lost its only size(s): fall back to a fixed base price
                  // taken from the removed sole size — same amount, no sizes.
                  const fallback = removed.length > 0 && typeof removed[0].price === 'number' ? removed[0].price : undefined;
                  next = {
                    ...next,
                    variants: undefined,
                    defaultVariant: undefined,
                    pricing: { ...it.pricing, ...(fallback !== undefined ? { price: fallback } : {}) },
                  };
                } else {
                  next = { ...next, variants };
                  if (typeof next.defaultVariant === 'string' && gone.has(next.defaultVariant)) {
                    next = { ...next, defaultVariant: variants.length > 0 ? variants[0].featureId : undefined };
                  }
                }
              }
              if (addons.length !== (it.addons || []).length) {
                next = { ...next, addons: addons.length > 0 ? addons : undefined };
              }
              return next;
            });
            return {
              ...m,
              items,
              settings: {
                ...m.settings,
                featureGroups: dropGroup
                  ? (m.settings.featureGroups || []).filter((g) => g.id !== dropGroup)
                  : m.settings.featureGroups,
                featureDefs: (m.settings.featureDefs || []).filter((d) => !gone.has(d.id)),
              },
            };
          })
        }
        onUpdate={(updater) =>
          onUpdateMenu((m) => {
            const next = updater({ featureGroups: m.settings.featureGroups, featureDefs: m.settings.featureDefs });
            return { ...m, settings: { ...m.settings, ...next } };
          })
        }
      />
    </div>
  );
};
