import React from 'react';
import type { MenuItem } from '@/src/types/menu';
import { normalizePricing, unitLabel } from '@/src/utils/pricing';

interface ItemPricingFieldsProps {
  item: MenuItem;
  lang: 'en' | 'ar';
  onChange: (item: MenuItem) => void;
}

/** Price (hidden when sizes exist) + min/max qty + show-unit toggle. */
export const ItemPricingFields: React.FC<ItemPricingFieldsProps> = ({
  item,
  lang,
  onChange,
}) => {
  const isAr = lang === 'ar';
  return (
    <>
      {/* Price (hidden when sizes exist — the size price rules) */}
      {!(item.variants && item.variants.length > 0) ? (
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'السعر' : 'Price'}</label>
          <input
            type="number"
            step="any"
            value={item.pricing.price ?? ''}
            onChange={(e) =>
              onChange({
                ...item,
                pricing: { ...normalizePricing(item), price: e.target.value === '' ? undefined : Number(e.target.value) },
              })
            }
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
          />
        </div>
      ) : (
        <p className="text-[11px] text-neutral-500">
          {isAr ? 'السعر يأتي من الأحجام أدناه (النجمة ★ هي الافتراضي).' : 'Price comes from the sizes below (the ★ is the default).'}
        </p>
      )}

      {/* Min / Max + show unit (step is fixed at 1) */}
      <div className="grid grid-cols-2 gap-3">
        {([
          { k: 'minQty', label: isAr ? 'أقل كمية' : 'Min qty' },
          { k: 'maxQty', label: isAr ? 'أقصى كمية' : 'Max qty' },
        ] as const).map((f) => (
          <div key={f.k}>
            <label className="block text-xs text-neutral-400 mb-1">{f.label}</label>
            <input
              type="number"
              step={1}
              value={item.pricing[f.k] ?? ''}
              onChange={(e) =>
                onChange({
                  ...item,
                  pricing: { ...normalizePricing(item), [f.k]: e.target.value === '' ? undefined : Number(e.target.value) },
                })
              }
              className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
            />
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={!!item.pricing.showUnit}
          onChange={(e) =>
            onChange({
              ...item,
              pricing: { ...normalizePricing(item), showUnit: e.target.checked },
            })
          }
          className="w-4 h-4 rounded text-[#FFC400]"
        />
        <span className="font-bold">{isAr ? `إظهار الوحدة بجانب السعر (مثال: / ${unitLabel(normalizePricing(item).unit, 1, lang)})` : `Show unit next to price (e.g. / ${unitLabel(normalizePricing(item).unit, 1, lang)})`}</span>
      </label>
    </>
  );
};
