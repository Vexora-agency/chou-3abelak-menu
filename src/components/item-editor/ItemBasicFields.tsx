import React from 'react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { normalizePricing, unitLabel, UNITS } from '@/src/utils/pricing';

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
            value={(UNITS as readonly string[]).includes(item.pricing.unit) ? item.pricing.unit : '__custom'}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...item,
                pricing: {
                  ...normalizePricing(item),
                  unit: v === '__custom'
                    ? ((UNITS as readonly string[]).includes(item.pricing.unit) ? '' : item.pricing.unit)
                    : v,
                },
              });
            }}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
          >
            {/* Known units with localized names (no duplication), then a free-text custom option */}
            {UNITS.map((u) => {
              const label = isAr ? unitLabel(u, 1, 'ar') : unitLabel(u, 1, 'en');
              return (
                <option key={u} value={u}>
                  {label === u ? label : `${label} · ${u}`}
                </option>
              );
            })}
            <option value="__custom">{isAr ? '✎ وحدة مخصصة…' : '✎ Custom…'}</option>
          </select>
          {!(UNITS as readonly string[]).includes(item.pricing.unit) && (
            <input
              type="text"
              maxLength={24}
              value={item.pricing.unit}
              onChange={(e) =>
                onChange({
                  ...item,
                  pricing: { ...normalizePricing(item), unit: e.target.value },
                })
              }
              placeholder={isAr ? 'اكتب الوحدة (مثال: ربطة، كيس)' : 'Type the unit (e.g. pack, bag)'}
              className="w-full h-10 px-3 mt-1.5 rounded-lg bg-black border border-[var(--primary)]/60 text-sm"
            />
          )}
        </div>
      </div>

      {/* Show-unit toggle lives right under Unit (live example included) */}
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
          className="w-4 h-4 rounded text-[var(--primary)]"
        />
        <span className="font-bold">{isAr ? `إظهار الوحدة بجانب السعر (مثال: / ${unitLabel(normalizePricing(item).unit, 1, lang)})` : `Show unit next to price (e.g. / ${unitLabel(normalizePricing(item).unit, 1, lang)})`}</span>
      </label>
    </>
  );
};
