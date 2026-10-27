import React from 'react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { normalizePricing, unitLabel } from '@/src/utils/pricing';

interface ItemBasicFieldsProps {
  item: MenuItem;
  menu: MenuData;
  lang: 'en' | 'ar';
  onChange: (item: MenuItem) => void;
}

/** Name (EN/AR), description (EN/AR), category + unit selects. */
export const ItemBasicFields: React.FC<ItemBasicFieldsProps> = ({
  item,
  menu,
  lang,
  onChange,
}) => {
  const isAr = lang === 'ar';
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">Name (EN) *</label>
          <input
            type="text"
            value={item.name.en}
            onChange={(e) =>
              onChange({
                ...item,
                name: { ...item.name, en: e.target.value },
              })
            }
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">الاسم (AR) *</label>
          <input
            type="text"
            dir="rtl"
            value={item.name.ar}
            onChange={(e) =>
              onChange({
                ...item,
                name: { ...item.name, ar: e.target.value },
              })
            }
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">Description (EN)</label>
        <textarea
          rows={2}
          value={item.description.en}
          onChange={(e) =>
            onChange({
              ...item,
              description: { ...item.description, en: e.target.value },
            })
          }
          className="w-full p-2.5 rounded-lg bg-black border border-neutral-700 text-xs"
        />
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">الوصف (AR)</label>
        <textarea
          rows={2}
          dir="rtl"
          value={item.description.ar}
          onChange={(e) =>
            onChange({
              ...item,
              description: { ...item.description, ar: e.target.value },
            })
          }
          className="w-full p-2.5 rounded-lg bg-black border border-neutral-700 text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'القسم' : 'Category'}</label>
          <select
            value={item.categoryId}
            onChange={(e) =>
              onChange({
                ...item,
                categoryId: e.target.value,
              })
            }
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
          >
            {menu.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name.en}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'الوحدة' : 'Unit'}</label>
          <select
            value={item.pricing.unit || 'pc'}
            onChange={(e) =>
              onChange({
                ...item,
                pricing: { ...normalizePricing(item), unit: e.target.value as MenuItem['pricing']['unit'] },
              })
            }
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
          >
            {/* All units, most common first, with localized names */}
            {(['pc', 'dozen', 'portion', 'box', 'bottle', 'glass', 'kg'] as const).map((u) => (
              <option key={u} value={u}>
                {isAr ? unitLabel(u, 1, 'ar') : unitLabel(u, 1, 'en')} · {u}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
};
