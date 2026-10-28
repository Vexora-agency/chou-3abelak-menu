import React from 'react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { featureName, formatPrice, priceLabel, unitLabel } from '@/src/utils/pricing';

interface ItemCalcPreviewProps {
  item: MenuItem;
  menu: MenuData;
  lang: 'en' | 'ar';
  calcQty: number;
  onCalcQtyChange: (n: number) => void;
}

/** Item preview (name, description, details, features) + mini calculator. */
export const ItemCalcPreview: React.FC<ItemCalcPreviewProps> = ({
  item,
  menu,
  lang,
  calcQty,
  onCalcQtyChange,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
      <p className="text-xs font-extrabold text-neutral-300">{isAr ? 'معاينة الصنف:' : 'Item preview:'}</p>
      {(() => {
        const cur = menu.settings.currency[lang] || menu.settings.currency.en;
        const pvSizes = item.variants || [];
        const pvAddons = item.addons || [];
        const pv = { ...item, variants: pvSizes.length ? pvSizes : undefined };
        let label = '—';
        try {
          label = priceLabel(pv, lang, cur);
        } catch {}
        const desc = (isAr ? item.description.ar : item.description.en).trim();
        const p = item.pricing;
        return (
          <div className="rounded-xl border border-neutral-700 bg-[#141414] p-3.5">
            <div className="flex justify-between items-start gap-3">
              <span className="font-bold text-sm text-white">
                {(isAr ? item.name.ar : item.name.en) || (isAr ? '(بدون اسم)' : '(no name)')}
              </span>
              <span className="shrink-0 px-3 py-1 rounded-full text-xs font-extrabold bg-[var(--primary)] text-[#0A0A0A] tabular-nums whitespace-nowrap">
                {label}
              </span>
            </div>
            {desc ? <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">{desc}</p> : null}
            <p className="text-[11px] text-neutral-500 mt-1.5 tabular-nums">
              {isAr ? 'الوحدة: ' : 'Unit: '}{unitLabel(p.unit, 1, lang)}
              {' · '}
              {isAr ? `الكمية: ${p.minQty}–${p.maxQty}` : `Qty: ${p.minQty}–${p.maxQty}`}
              {p.step !== 1 && (isAr ? ` بخطوة ${p.step}` : ` step ${p.step}`)}
            </p>
            {pvSizes.length > 0 && (
              <div className="mt-2 pt-2 border-t border-dashed border-neutral-800 space-y-2">
                {(menu.settings.featureGroups || [])
                  .map((g) => ({
                    group: g,
                    lines: pvSizes.filter((v) => {
                      const def = (menu.settings.featureDefs || []).find((d) => d.id === v.featureId);
                      return def?.groupId === g.id;
                    }),
                  }))
                  .filter((x) => x.lines.length > 0)
                  .map(({ group, lines }) => (
                    <div key={group.id}>
                      <p className="text-[10px] font-bold text-neutral-500 mb-1">
                        {isAr ? group.name.ar : group.name.en}
                      </p>
                      {lines.map((v, vi) => {
                        const isDef = ((item.defaultVariant && pvSizes.some((x) => x.featureId === item.defaultVariant)
                          ? item.defaultVariant
                          : pvSizes[0]?.featureId) === v.featureId);
                        return (
                          <div key={`${v.featureId || 'blank'}-${vi}`} className="flex justify-between text-[11px]">
                            <span className="text-neutral-300">
                              {featureName(menu, v.featureId, lang)}
                              {isDef && <span className="ms-1.5 text-[var(--primary)] font-bold">{isAr ? '(افتراضي)' : '(default)'}</span>}
                            </span>
                            <span className="text-neutral-400 tabular-nums" dir="ltr">{formatPrice(v.price, cur)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                {pvSizes
                  .filter((v) => {
                    const def = (menu.settings.featureDefs || []).find((d) => d.id === v.featureId);
                    return !def || !(menu.settings.featureGroups || []).some((g) => g.id === def.groupId);
                  })
                  .map((v, vi) => (
                    <div key={`orphan-${v.featureId || 'blank'}-${vi}`} className="flex justify-between text-[11px]">
                      <span className="text-neutral-300">
                        {featureName(menu, v.featureId, lang)}
                      </span>
                      <span className="text-neutral-400 tabular-nums" dir="ltr">{formatPrice(v.price, cur)}</span>
                    </div>
                  ))}
              </div>
            )}
            {pvAddons.length > 0 && (
              <div className="mt-2 pt-2 border-t border-dashed border-neutral-800 space-y-2">
                {(menu.settings.featureGroups || [])
                  .map((g) => ({
                    group: g,
                    lines: pvAddons.filter((a) => {
                      const def = (menu.settings.featureDefs || []).find((d) => d.id === a.featureId);
                      return def?.groupId === g.id;
                    }),
                  }))
                  .filter((x) => x.lines.length > 0)
                  .map(({ group, lines }) => (
                    <div key={group.id}>
                      <p className="text-[10px] font-bold text-neutral-500 mb-1">
                        {isAr ? group.name.ar : group.name.en}
                      </p>
                      {lines.map((a, ai) => (
                        <div key={`${a.featureId || 'blank'}-${ai}`} className="flex justify-between text-[11px]">
                          <span className="text-[var(--primary)]">+ {featureName(menu, a.featureId, lang)}</span>
                          <span className="text-neutral-400 tabular-nums" dir="ltr">
                            {a.price === 0 ? (isAr ? 'مجاناً' : 'Free') : `+${formatPrice(a.price, cur)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                {pvAddons
                  .filter((a) => {
                    const def = (menu.settings.featureDefs || []).find((d) => d.id === a.featureId);
                    return !def || !(menu.settings.featureGroups || []).some((g) => g.id === def.groupId);
                  })
                  .map((a, ai) => (
                    <div key={`orphan-${a.featureId || 'blank'}-${ai}`} className="flex justify-between text-[11px]">
                      <span className="text-[var(--primary)]">+ {featureName(menu, a.featureId, lang)}</span>
                      <span className="text-neutral-400 tabular-nums" dir="ltr">
                        {a.price === 0 ? (isAr ? 'مجاناً' : 'Free') : `+${formatPrice(a.price, cur)}`}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        );
      })()}
      <div className="flex items-center justify-between gap-3 text-xs">
        <label className="text-neutral-400">
          {isAr ? 'جرّب: اطلب' : 'Try: order'}
          <input
            type="number"
            step={1}
            value={calcQty}
            onChange={(e) => onCalcQtyChange(Number(e.target.value))}
            className="w-16 h-8 mx-1.5 px-2 rounded-lg bg-black border border-neutral-700 text-xs text-center"
          />
          {isAr ? '→ الإجمالي' : '→ total'}
        </label>
        <span className="font-extrabold text-white tabular-nums">
          {(() => {
            const vs = item.variants || [];
            const firstSize = (item.defaultVariant && vs.find((v) => v.featureId === item.defaultVariant)) || vs[0];
            const base = firstSize ? firstSize.price : item.pricing.price;
            if (!Number.isInteger(calcQty) || calcQty <= 0 || typeof base !== 'number' || !Number.isFinite(base)) return '—';
            return formatPrice((base) * calcQty, menu.settings.currency[lang] || menu.settings.currency.en);
          })()}
        </span>
      </div>
    </div>
  );
};
