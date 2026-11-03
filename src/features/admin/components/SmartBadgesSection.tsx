import React from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

interface SmartBadgesSectionProps {
  badges: MenuSettings['badges'];
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: MenuSettings['badges']) => MenuSettings['badges']) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Smart Badges card of the admin Settings tab. */
export const SmartBadgesSection: React.FC<SmartBadgesSectionProps> = ({
  badges,
  lang,
  onUpdate,
  collapsed = false,
  onToggleCollapse,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'الشارات الذكية' : 'Smart Badges'}
        subtitle={isAr ? 'NEW تلقائية بمؤقت، وTop من المبيعات باعتمادك' : 'Automatic time-based NEW, sales-driven Top on your approval'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
      {/* One row per number (label left, fixed-width input right): labels wrap
          to different line counts per language, so side-by-side columns can
          never stay aligned — rows always do, at any width. */}
      <div className="space-y-2.5">
        {([
          { k: 'newDays', label: isAr ? 'مدة NEW (يوم)' : 'NEW days', hint: isAr ? 'تُزال تلقائيًا بعدها' : 'auto-removed after' },
          // topDays is intentionally hidden: it stays fixed at the 30-day
          // default (every reader falls back to 30 when absent), so the
          // owner is never asked about a tuning knob they don't need.
          { k: 'topCount', label: isAr ? 'عدد الـ Top' : 'Top count', hint: isAr ? 'الأصناف الأعلى مبيعًا' : 'top N items' },
        ] as const).map((f) => (
          <div key={f.k} className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <label className="block text-xs text-neutral-400">{f.label}</label>
              <p className="text-[10px] text-neutral-500 mt-0.5">{f.hint}</p>
            </div>
          <input
            type="number"
            step={1}
            value={badges[f.k] ?? ''}
            onChange={(e) => onUpdate((prev) => ({ ...prev, [f.k]: Number(e.target.value) }))}
            aria-label={f.label}
            className="w-20 shrink-0 h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm text-center tabular-nums"
          />
        </div>
        ))}
      </div>
      </SettingsGroupBody>
    </div>
  );
};
