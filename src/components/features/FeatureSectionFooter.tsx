import React from 'react';
import { Plus } from 'lucide-react';
import type { MenuSettings } from '@/src/types/menu';

type LibraryValues = Pick<MenuSettings, 'featureGroups' | 'featureDefs'>;

interface FeatureSectionFooterProps {
  isAr: boolean;
  onUpdate: (updater: (prev: LibraryValues) => LibraryValues) => void;
}

export const FeatureSectionFooter: React.FC<FeatureSectionFooterProps> = ({
  isAr,
  onUpdate,
}) => {
  return (
    <>
      <div>
        <button
          type="button"
          onClick={() =>
            onUpdate((prev) => ({
              ...prev,
              featureGroups: [
                ...(prev.featureGroups || []),
                {
                  id: `g_${Date.now().toString(36)}`,
                  name: { en: 'New section', ar: 'قسم جديد' },
                },
              ],
            }))
          }
          className="btn-tactile px-3.5 h-10 rounded-xl bg-[#FFC400] text-[#0A0A0A] text-xs font-bold flex items-center gap-1 shadow-md"
        >
          <Plus size={14} />
          <span>{isAr ? 'إضافة قسم' : 'Add section'}</span>
        </button>
      </div>
      <p className="text-[11px] text-neutral-500">
        {isAr
          ? 'السعر يتحدد لكل صنف على حدة (0 = مجاناً للإضافات).'
          : 'Prices are set per item (0 = free for add-ons).'}
      </p>
    </>
  );
};
