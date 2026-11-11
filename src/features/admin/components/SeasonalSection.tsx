import React, { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { MenuSettings, SeasonalTheme } from '@/src/types/menu';
import { SEASONAL_REGISTRY } from '@/src/features/seasonal/themes';
import { celebrateSeasonOn, originOf } from '@/src/features/seasonal/confetti';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

type SeasonalValues = Pick<MenuSettings, 'seasonal'>;

interface SeasonalSectionProps extends SeasonalValues {
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: SeasonalValues) => SeasonalValues) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Seasonal storefront theme (first season: Christmas snow + greeting).
 *  Two-stage switch: this section only ARMS a season (theme on, live off) —
 *  nothing shows to customers yet. The dashboard card flips `live` to go
 *  live. Autosave persists both; the customer site picks them up on its
 *  next menu fetch. */
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

  const setTheme = (t: SeasonalTheme) =>
    // Arming only: turning a season on here never goes live by itself —
    // the dashboard card flips `live`. Turning off disarms completely.
    onUpdate(() => ({ seasonal: { theme: t, live: false } }));

  // Celebratory ON press: the toggle fires immediately (autosave persists it),
  // while the button plays a short snowy loading state (~800 ms, long enough
  // for the autosave to settle), then a success tick + a small confetti burst
  // anchored on the toggle itself. Purely cosmetic — saving never waits for it.
  const [fete, setFete] = useState<'idle' | 'saving' | 'done'>('idle');
  const groupRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    },
    [],
  );
  // If the theme flips back off mid-celebration, drop the success state.
  useEffect(() => {
    if (!active && fete === 'done') {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setFete('idle');
    }
  }, [active, fete]);

  const turnOn = () => {
    if (active || fete === 'saving') return;
    setTheme('christmas');
    setFete('saving');
    timers.current.push(
      window.setTimeout(() => {
        setFete('done');
        celebrateSeasonOn(groupRef.current ? originOf(groupRef.current) : undefined);
        timers.current.push(window.setTimeout(() => setFete('idle'), 2400));
      }, 800),
    );
  };

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
                ? (isAr ? 'مُجهّز — شغّله من زر الداشبورد ليظهر للزبائن' : 'Armed — turn it on from the dashboard card to go live')
                : (isAr ? 'متوقف — لن يرى الزبائن شيئًا' : 'Off — customers see nothing')}
            </span>
          </span>
          <div ref={groupRef} className="flex p-1 rounded-full bg-black border border-neutral-800" role="group" aria-label={title}>
            {([
              ['on', isAr ? 'تفعيل' : 'On'],
              ['off', isAr ? 'إطفاء' : 'Off'],
            ] as const).map(([k, label]) => {
              const pressed = (k === 'on') === active;
              const saving = k === 'on' && fete === 'saving';
              const done = k === 'on' && fete === 'done' && active;
              const busyLabel = isAr ? 'جاري التفعيل…' : 'Turning on…';
              const doneLabel = isAr ? 'تم التفعيل!' : 'Live now!';
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={pressed}
                  aria-busy={saving || undefined}
                  aria-label={saving ? busyLabel : done ? doneLabel : undefined}
                  disabled={fete === 'saving'}
                  onClick={() => (k === 'on' ? turnOn() : setTheme('off'))}
                  className={`relative px-5 h-11 min-h-[44px] inline-flex items-center rounded-full text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-wait ${pressed ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'} ${fete === 'saving' && !pressed ? 'opacity-60' : ''}`}
                >
                  {pressed && <span className="absolute inset-0 rounded-full bg-[var(--primary)]" aria-hidden="true" />}
                  <span className="relative z-10 inline-flex items-center gap-1.5">
                    {saving && (
                      <span aria-hidden="true" className="inline-block animate-spin">
                        ❄
                      </span>
                    )}
                    {done && <Check size={14} aria-hidden="true" strokeWidth={3} />}
                    {saving ? busyLabel : done ? doneLabel : label}
                  </span>
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
