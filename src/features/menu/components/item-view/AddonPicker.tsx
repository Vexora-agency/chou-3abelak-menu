import React from 'react';
import { Check } from 'lucide-react';
import type { ItemAddon, MenuData } from '@/src/types/menu';
import { featureName, formatPrice } from '@/src/utils/pricing';

interface AddonPickerProps {
  addons: ItemAddon[];
  addonIds: string[];
  onToggle: (id: string) => void;
  menu: MenuData;
  lang: 'en' | 'ar';
  currency: string;
  darkMode: boolean;
  isAr: boolean;
  chipBase: string;
}

export const AddonPicker: React.FC<AddonPickerProps> = ({
  addons,
  addonIds,
  onToggle,
  menu,
  lang,
  currency,
  darkMode,
  isAr,
  chipBase,
}) => {
  if (addons.length === 0) return null;
  return (
    <div>
      <p className={`text-xs font-extrabold mb-2 ${darkMode ? 'text-neutral-300' : 'text-neutral-700'}`}>
        {isAr ? 'إضافات (اختياري)' : 'Add-ons (optional)'}
      </p>
      <div className="flex flex-wrap gap-2">
        {addons.map((a) => {
          const active = addonIds.includes(a.featureId);
          const free = a.price === 0;
          return (
            <button
              key={a.featureId}
              type="button"
              onClick={() => onToggle(a.featureId)}
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
              <span dir="auto">{featureName(menu, a.featureId, lang)}</span>
              <span className="tabular-nums opacity-80" dir="ltr">
                {free ? (isAr ? 'مجاناً' : 'Free') : `+${formatPrice(a.price, currency)}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
