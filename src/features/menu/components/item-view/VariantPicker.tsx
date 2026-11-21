import React from 'react';
import { Check } from 'lucide-react';
import type { MenuData } from '@/src/types/menu';
import type { ItemVariant } from '@/src/types/menu';
import { featureName, formatPrice } from '@/src/utils/pricing';
import { UNIFIED_FEATURE_CHIP_ACTIVE, UNIFIED_FEATURE_CHIP_IDLE } from '@/src/utils/featureColors';

interface VariantPickerProps {
  variants: ItemVariant[];
  variantId: string | undefined;
  onSelect: (id: string) => void;
  menu: MenuData;
  lang: 'en' | 'ar';
  currency: string;
  darkMode: boolean;
  isAr: boolean;
  chipBase: string;
}

export const VariantPicker: React.FC<VariantPickerProps> = ({
  variants,
  variantId,
  onSelect,
  menu,
  lang,
  currency,
  darkMode,
  isAr,
  chipBase,
}) => {
  if (variants.length === 0) return null;
  return (
    <div>
      <p className={`text-xs font-extrabold mb-2 ${darkMode ? 'text-neutral-300' : 'text-neutral-700'}`}>
        {isAr ? 'اختر الحجم *' : 'Choose a size *'}
      </p>
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => {
          const active = variantId === v.featureId;
          return (
            <button
              key={v.featureId}
              type="button"
              onClick={() => onSelect(v.featureId)}
              aria-pressed={active}
              className={`${chipBase} ${
                active ? UNIFIED_FEATURE_CHIP_ACTIVE : UNIFIED_FEATURE_CHIP_IDLE
              }`}
            >
              {active && <Check size={13} strokeWidth={3} />}
              <span dir="auto">{featureName(menu, v.featureId, lang)}</span>
              {/* Zero-price variants show no price text (same rule as add-ons). */}
              {v.price !== 0 && (
                <span className="tabular-nums opacity-80"><bdi dir="ltr">+{formatPrice(v.price)}</bdi> <span dir="auto">{currency}</span></span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
