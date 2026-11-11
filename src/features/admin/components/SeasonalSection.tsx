import React from 'react';
import type { MenuSettings, SeasonalTheme } from '@/src/types/menu';
import { SEASONAL_REGISTRY } from '@/src/features/seasonal/themes';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

type SeasonalValues = Pick<MenuSettings, 'seasonal'>;

interface SeasonalSectionProps extends SeasonalValues {
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: SeasonalValues) => SeasonalValues) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Seasonal storefront theme (first season: Christmas snow + greeting).
 *  Flips `settings.seasonal.theme`; autosave persists it and the customer
 *  site picks it up on its next menu fetch. */
export const SeasonalSection: React.FC<SeasonalSectionProps> = ({
  seasonal,
  lang,
  onUpdate,
  collapsed = false,
  onToggleCollapse,
}) => {
  const isAr = lang === 'ar';
  const theme: SeasonalTheme =
    (seasonal as { theme?: unknown } | undefined)?.theme === 'christmas' ? 'christmas' : 'off';
  const active = theme !== 'off';
  const def = SEASONAL_REGISTRY.christmas;
  const title = isAr ? 'الموسم (ثيم المناسبات)' : 'Season (festive theme)';
  const subtitle = isAr
    ? 'ثلج متساقط ورسالة ترحيب على موقع الزبائن — تُخفى تلقائيًا عن الزبائن عندما تكون متوقفة'
    : 'Falling snow + a greeting on the customer site — hidden from customers while off';

  const setTheme = (t: SeasonalTheme) => onUpdate(() => ({ seasonal: { theme: t } }));

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={title}
        subtitle={subtitle}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
        <div className="flex items-center gap-3 flex-wrap">
          <span aria-hidden="true" className="text-2xl leading-none">🎄</span>
          <span className="min-w-0 flex-1 basis-48">
            <b className="block text-sm font-extrabold">
              {isAr ? def.name.ar : def.name.en}
            </b>
            <span className="block text-xs text-neutral-400 mt-0.5">
              {active
                ? (isAr ? 'مفعّل الآن على موقع الزبائن' : 'Live on the customer site now')
                : (isAr ? 'متوقف — لن يرى الزبائن شيئًا' : 'Off — customers see nothing')}
            </span>
          </span>
          <div className="flex p-1 rounded-full bg-black border border-neutral-800" role="group" aria-label={title}>
            {([
              ['on', isAr ? 'تفعيل' : 'On'],
              ['off', isAr ? 'إطفاء' : 'Off'],
            ] as const).map(([k, label]) => {
              const pressed = (k === 'on') === active;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setTheme(k === 'on' ? 'christmas' : 'off')}
                  className={`relative px-5 h-11 min-h-[44px] inline-flex items-center rounded-full text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${pressed ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}
                >
                  {pressed && <span className="absolute inset-0 rounded-full bg-[var(--primary)]" aria-hidden="true" />}
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
        {/* Greeting preview — byte-identical copy to the customer card (from the registry). */}
        <div className="mt-3 rounded-xl border border-neutral-800 bg-black/60 px-4 py-3" aria-label={isAr ? 'معاينة الرسالة' : 'Message preview'}>
          <p className="text-[11px] font-bold text-neutral-500 mb-1">
            {isAr ? 'معاينة رسالة الزبائن:' : 'Customer message preview:'}
          </p>
          <p className="text-sm font-extrabold text-white">
            {isAr ? def.greeting.title.ar : def.greeting.title.en}
          </p>
          <p className="text-[11px] font-bold text-neutral-400">
            {isAr ? def.greeting.note.ar : def.greeting.note.en}
          </p>
        </div>
      </SettingsGroupBody>
    </div>
  );
};
