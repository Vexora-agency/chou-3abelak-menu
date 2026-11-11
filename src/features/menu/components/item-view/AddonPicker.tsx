import React from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import type { ItemAddon, MenuData, MenuItem } from '@/src/types/menu';
import { featureName, formatPrice } from '@/src/utils/pricing';
import { SPICY_GROUP_ID, isSpicyFeatureId } from '@/src/utils/menuHelpers';
import { addonBlocks } from '@/src/utils/splitPicks';
import { SpicySlider } from './SpicySlider';

interface AddonPickerProps {
  menu: MenuData;
  item: MenuItem;
  qty: number;
  addonIds: string[];
  addonCounts: Record<string, number>;
  onToggleMulti: (id: string) => void;
  onSelectRadio: (groupId: string, id: string) => void;
  onSetCount: (id: string, count: number) => void;
  onFillAll: (groupId: string, id: string) => void;
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
  onFillAll,
  lang,
  currency,
  darkMode,
  isAr,
  chipBase,
}) => {
  const blocks = addonBlocks(menu, item);
  if (blocks.length === 0) return null;
  // Badged-spicy items MUST pick a heat degree (the badge alone no longer
  // implies a default): the slider shows first, expanded by default, and
  // the pick can never be cleared. The prompt is reworded to mandatory —
  // the library prompt ("Want some heat?") reads optional.
  const badgedSpicy = (item.badges || []).includes('spicy');
  const ordered = [
    ...blocks.filter((b) => b.groupId === SPICY_GROUP_ID),
    ...blocks.filter((b) => b.groupId !== SPICY_GROUP_ID),
  ];
  if (ordered.length === 0) return null;
  return (
    <div className="space-y-4">
      {ordered.map((b) => {
        if (b.groupId === SPICY_GROUP_ID) {
          const selectedId = addonIds.find((id) => isSpicyFeatureId(id)) ?? null;
          const required = badgedSpicy;
          return (
            <SpicySlider
              key={b.key || 'spicy'}
              levels={b.addons.map((a) => ({
                featureId: a.featureId,
                price: a.price,
                nameEn: featureName(menu, a.featureId, 'en'),
                nameAr: featureName(menu, a.featureId, 'ar'),
              }))}
              selectedId={selectedId}
              onPick={(id) => onSelectRadio(b.groupId ?? '', id)}
              prompt={
                required
                  ? { en: 'Choose your heat level (required)', ar: 'اختر درجة الحار (مطلوب)' }
                  : b.prompt
              }
              required={required}
              lang={lang}
              isAr={isAr}
              darkMode={darkMode}
              currency={currency}
              chipBase={chipBase}
            />
          );
        }
        const prompt = b.prompt ? (isAr ? b.prompt.ar : b.prompt.en) : '';
        const required = (item.requiredGroups || []).includes(b.groupId ?? '');
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
              {required && (
                <span className="ms-1.5 inline-flex items-center rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-black text-[#0A0A0A]">
                  {isAr ? 'إجباري *' : 'Required *'}
                </span>
              )}
            </p>
            {required && (
              <p className={`-mt-1 mb-2 text-[11px] font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                {isAr ? 'اختر صنفًا واحدًا على الأقل لتفعيل زر الإضافة' : 'Pick at least one to enable the Add button'}
              </p>
            )}
            {split ? (
              // key remounts on radio↔split flips so the rise-in replays.
              <div key="split">
                <div className="space-y-1">
                  {b.addons.map((a: ItemAddon, i: number) => {
                    const count = countOf(addonCounts, addonIds, a.featureId, qty);
                    const free = a.price === 0;
                    const name = featureName(menu, a.featureId, lang);
                    return (
                      <div
                        key={a.featureId}
                        className="anim-split-in flex items-center justify-between gap-2"
                        style={{ animationDelay: `${Math.min(i, 5) * 40}ms` }}
                      >
                        <span dir="auto" className={`min-w-0 flex-1 text-xs font-bold break-words ${darkMode ? 'text-neutral-200' : 'text-neutral-800'}`}>
                          {name}
                          {/* Zero-price add-ons show no price text (same rule as chips). */}
                          {!free && (
                            <span className="tabular-nums opacity-80"><bdi dir="ltr">+{formatPrice(a.price)}</bdi> <span dir="auto">{currency}</span></span>
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
                          {/* One-tap "all units this option" — hidden once it
                              already holds the full qty. Fills this option and
                              zeroes its siblings in one go. */}
                          {count < qty && (
                            <button
                              type="button"
                              onClick={() => onFillAll(b.groupId ?? '', a.featureId)}
                              className={`h-9 px-2.5 rounded-full text-[11px] font-black border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                                darkMode
                                  ? 'border-neutral-700 text-[var(--primary)] hover:border-[var(--primary)]'
                                  : 'border-neutral-300 text-neutral-800 hover:border-[#0A0A0A] hover:bg-neutral-100'
                              }`}
                              aria-label={isAr ? `كل الكمية ${name}` : `All ${name}`}
                            >
                              {isAr ? 'الكل' : 'All'}
                            </button>
                          )}
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
                        <span className="tabular-nums opacity-80"><bdi dir="ltr">+{formatPrice(a.price)}</bdi> <span dir="auto">{currency}</span></span>
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
