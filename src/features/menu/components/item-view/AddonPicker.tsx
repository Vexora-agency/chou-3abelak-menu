import React from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import type { ItemAddon, MenuData, MenuItem } from '@/src/types/menu';
import { featureName, formatPrice } from '@/src/utils/pricing';
import { addonBlocks } from '@/src/utils/splitPicks';

interface AddonPickerProps {
  menu: MenuData;
  item: MenuItem;
  qty: number;
  addonIds: string[];
  addonCounts: Record<string, number>;
  onToggleMulti: (id: string) => void;
  onSelectRadio: (groupId: string, id: string) => void;
  onSetCount: (id: string, count: number) => void;
  lang: 'en' | 'ar';
  currency: string;
  darkMode: boolean;
  isAr: boolean;
  chipBase: string;
}

const countOf = (
  addonCounts: Record<string, number>,
  addonIds: string[],
  id: string,
  qty: number,
): number =>
  typeof addonCounts[id] === 'number' && Number.isInteger(addonCounts[id])
    ? (addonCounts[id])
    : addonIds.includes(id)
      ? qty
      : 0;

export const AddonPicker: React.FC<AddonPickerProps> = ({
  menu,
  item,
  qty,
  addonIds,
  addonCounts,
  onToggleMulti,
  onSelectRadio,
  onSetCount,
  lang,
  currency,
  darkMode,
  isAr,
  chipBase,
}) => {
  const blocks = addonBlocks(menu, item);
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-4">
      {blocks.map((b) => {
        const prompt = b.prompt ? (isAr ? b.prompt.ar : b.prompt.en) : '';
        const title =
          prompt && prompt.trim()
            ? prompt
            : blocks.length > 1
              ? isAr
                ? b.name.ar
                : b.name.en
              : isAr
                ? 'إضافات (اختياري)'
                : 'Add-ons (optional)';
        // 'single' with qty 1 behaves as radio; with qty > 1 every option
        // gets a mini stepper capped so the group sum never exceeds qty.
        const split = b.selection === 'single' && qty > 1;
        const groupSum = split
          ? b.addons.reduce((s, a) => s + countOf(addonCounts, addonIds, a.featureId, qty), 0)
          : 0;
        const remaining = qty - groupSum;
        return (
          <div key={b.key || 'orphan'}>
            <p className={`text-xs font-extrabold mb-2 ${darkMode ? 'text-neutral-300' : 'text-neutral-700'}`}>
              <span dir="auto">{title}</span>
            </p>
            {split ? (
              <div>
                <div className="space-y-1">
                  {b.addons.map((a: ItemAddon) => {
                    const count = countOf(addonCounts, addonIds, a.featureId, qty);
                    const free = a.price === 0;
                    const name = featureName(menu, a.featureId, lang);
                    return (
                      <div key={a.featureId} className="flex items-center justify-between gap-2">
                        <span dir="auto" className={`min-w-0 flex-1 text-xs font-bold break-words ${darkMode ? 'text-neutral-200' : 'text-neutral-800'}`}>
                          {name}
                          {/* Zero-price add-ons show no price text (same rule as chips). */}
                          {!free && (
                            <span className="tabular-nums opacity-80" dir="ltr"> +{formatPrice(a.price, currency)}</span>
                          )}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => onSetCount(a.featureId, count - 1)}
                            disabled={count <= 0}
                            className={`w-9 h-9 min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-30 ${
                              darkMode
                                ? 'border-neutral-700 text-neutral-200 hover:border-[var(--primary)]'
                                : 'border-neutral-300 text-neutral-800 hover:border-[#0A0A0A]'
                            }`}
                            aria-label={isAr ? `إنقاص ${name}` : `Decrease ${name}`}
                          >
                            <Minus size={14} strokeWidth={3} />
                          </button>
                          <span className="tabular-nums text-xs font-black w-6 text-center" dir="ltr">
                            {count}
                          </span>
                          <button
                            type="button"
                            onClick={() => onSetCount(a.featureId, count + 1)}
                            disabled={groupSum >= qty}
                            className={`w-9 h-9 min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-30 ${
                              darkMode
                                ? 'border-neutral-700 text-neutral-200 hover:border-[var(--primary)]'
                                : 'border-neutral-300 text-neutral-800 hover:border-[#0A0A0A]'
                            }`}
                            aria-label={isAr ? `زيادة ${name}` : `Increase ${name}`}
                          >
                            <Plus size={14} strokeWidth={3} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className={`mt-1 text-[11px] font-bold tabular-nums ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                  {isAr ? `المتبقي: ${remaining}` : `Remaining: ${remaining}`}
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {b.addons.map((a: ItemAddon) => {
                  const active = addonIds.includes(a.featureId);
                  const free = a.price === 0;
                  const radio = b.selection === 'single';
                  return (
                    <button
                      key={a.featureId}
                      type="button"
                      onClick={() => (radio ? onSelectRadio(b.groupId ?? '', a.featureId) : onToggleMulti(a.featureId))}
                      {...(radio ? { role: 'radio' as const, 'aria-checked': active } : { 'aria-pressed': active })}
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
                      {/* Zero-price add-ons (e.g. spicy) show no price text at all —
                          neither "Free" nor "+0": the name alone is the honest label. */}
                      {!free && (
                        <span className="tabular-nums opacity-80" dir="ltr">+{formatPrice(a.price, currency)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
