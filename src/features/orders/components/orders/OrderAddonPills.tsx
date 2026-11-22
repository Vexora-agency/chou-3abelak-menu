import React from 'react';
import type { MenuData } from '@/src/types/menu';
import type { OrderItem } from './ordersDashTypes';
import { featureDef } from '@/src/utils/pricing';
import { featureColorDef } from '@/src/utils/featureColors';
import { isSpicyAddon } from '@/src/utils/menuHelpers';

interface OrderAddonPillsProps {
  it: OrderItem;
  menu: MenuData;
  lang: 'en' | 'ar';
}

/**
 * Admin order-line add-ons as compact pills with the option's library color.
 * Heat is excluded (rendered by HeatPill); admin colors stay in the admin —
 * the customer storefront never reads them.
 */
export const OrderAddonPills: React.FC<OrderAddonPillsProps> = ({
  it,
  menu,
  lang,
}) => {
  const names = it.addonNames;
  if (!Array.isArray(names) || names.length === 0) return null;

  const lineQty = Number.isFinite(it.qty) ? it.qty : 0;
  const hasQty = !!it.addonQty && typeof it.addonQty === 'object' && !Array.isArray(it.addonQty);
  const pills: { key: string; name: string; count: number | null; swatch: string; pill: string }[] = [];

  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (!n) continue;
    const fid = Array.isArray(it.addonIds) ? it.addonIds[i] : undefined;
    const name = (lang === 'ar' ? n.ar : n.en) || n.en || n.ar;
    if (!name) continue;
    // Heat has its own red pill; never duplicate it in the add-on row.
    if (isSpicyAddon(fid, n.ar) || isSpicyAddon(fid, n.en)) continue;

    let count = lineQty;
    if (hasQty && fid && Object.prototype.hasOwnProperty.call(it.addonQty, fid)) {
      const v = (it.addonQty as Record<string, unknown>)[fid];
      count = typeof v === 'number' && Number.isInteger(v) ? v : lineQty;
    }
    if (!(count > 0)) continue;

    const def = fid ? featureDef(menu, fid) : null;
    const color = featureColorDef(def?.color);
    pills.push({
      key: `${fid || name}-${i}`,
      name,
      count: count < lineQty ? count : null,
      swatch: color?.swatch ?? 'bg-neutral-500',
      pill: color?.adminPill ?? 'bg-neutral-800/80 text-neutral-200 border-neutral-700',
    });
  }

  if (pills.length === 0) return null;

  return (
    <>
      {pills.map((p) => (
        <span
          key={p.key}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${p.pill}`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${p.swatch}`}
          />
          <bdi dir="auto" className="whitespace-nowrap">
            {p.name}{p.count !== null ? ` ×${p.count}` : ''}
          </bdi>
        </span>
      ))}
    </>
  );
};
