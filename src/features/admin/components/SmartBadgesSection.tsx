import React from 'react';
import type { MenuSettings } from '@/src/types/menu';

interface SmartBadgesSectionProps {
  badges: MenuSettings['badges'];
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: MenuSettings['badges']) => MenuSettings['badges']) => void;
}

/** Smart Badges card of the admin Settings tab. */
export const SmartBadgesSection: React.FC<SmartBadgesSectionProps> = ({
  badges,
  lang,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div>
        <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
          {isAr ? 'الشارات الذكية' : 'Smart Badges'}
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {isAr
            ? 'NEW تلقائية بمؤقت، وTop من المبيعات باعتمادك'
            : 'Automatic time-based NEW, sales-driven Top on your approval'}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {([
          { k: 'newDays', label: isAr ? 'مدة NEW (يوم)' : 'NEW days', hint: isAr ? 'تتشال لوحدها بعدها' : 'auto-removed after' },
          { k: 'topDays', label: isAr ? 'نافذة المبيعات (يوم)' : 'Sales window (days)', hint: isAr ? 'آخر كام يوم' : 'last N days' },
          { k: 'topCount', label: isAr ? 'عدد الـ Top' : 'Top count', hint: isAr ? 'أول كام صنف' : 'top N items' },
        ] as const).map((f) => (
          <div key={f.k}>
            <label className="block text-xs text-neutral-400 mb-1">{f.label}</label>
            <input
              type="number"
              step={1}
              value={badges[f.k] ?? ''}
              onChange={(e) => onUpdate((prev) => ({ ...prev, [f.k]: Number(e.target.value) }))}
              className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
            />
            <p className="text-[10px] text-neutral-500 mt-0.5">{f.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
