import React from 'react';
import type { MenuItem } from '@/src/types/menu';
import { normalizePricing } from '@/src/utils/pricing';

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
      {/* Price (hidden when sizes exist — the Sizes section below owns pricing then) */}
      {!(item.variants && item.variants.length > 0) && (
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'السعر' : 'Price'}</label>
          <input
            type="number"
            step="any"
            min={0}
            value={item.pricing.price ?? ''}
            onChange={(e) =>
              onChange({
                ...item,
                pricing: { ...normalizePricing(item), price: e.target.value === '' ? undefined : Number(e.target.value) },
              })
            }
            placeholder={isAr ? 'فارغ = مجاناً (أو أضف مقاسات تحت)' : 'Empty = free (or add sizes below)'}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
          />
          {(item.pricing.price === undefined || item.pricing.price === 0) && (
            <p className="text-[11px] font-bold text-emerald-400 mt-1">
              ✓ {isAr ? 'سيظهر للزبون مجاناً' : 'Will show as FREE to customers'}
            </p>
          )}
        </div>
      )}

      {/* Min / Max (step is fixed at 1). The show-unit toggle lives under Unit above. */}
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
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
    </>
  );
};
