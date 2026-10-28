import React from 'react';
import { Check } from 'lucide-react';
import type { MenuData } from '@/src/types/menu';
import type { ItemVariant } from '@/src/types/menu';
import { featureName, formatPrice } from '@/src/utils/pricing';

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
                active
                  ? 'bg-[var(--primary)] text-[#0A0A0A] border-[var(--primary)]'
                  : darkMode
                  ? 'border-neutral-700 text-neutral-200 hover:border-[var(--primary)]'
                  : 'border-neutral-300 text-neutral-800 hover:border-[#0A0A0A]'
              }`}
            >
              {active && <Check size={13} strokeWidth={3} />}
              <span>{featureName(menu, v.featureId, lang)}</span>
              <span className="tabular-nums opacity-80">+{formatPrice(v.price, currency)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
