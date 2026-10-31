import React from 'react';
import type { MenuSettings } from '@/src/types/menu';

type WorkingHoursValues = Pick<MenuSettings, 'statusMode' | 'openTime' | 'closeTime' | 'workingDays'>;

interface WorkingHoursSectionProps extends WorkingHoursValues {
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: WorkingHoursValues) => WorkingHoursValues) => void;
}

// "13:05" (24h) -> "1:05 PM" / "1:05 مساءً", so AM/PM is never ambiguous
function formatTime12h(t: string, isAr: boolean): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((t || '').trim());
  if (!m) return t || '--:--';
  const h = parseInt(m[1], 10) % 24;
  const suffix = h < 12 ? (isAr ? 'صباحاً' : 'AM') : (isAr ? 'مساءً' : 'PM');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

const ALL_DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

/** Working Hours & Status card of the admin Settings tab. */
export const WorkingHoursSection: React.FC<WorkingHoursSectionProps> = ({
  statusMode,
  openTime,
  closeTime,
  workingDays,
  lang,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <h2 className={`text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`}>
        {isAr ? 'مواعيد العمل والحالة' : 'Working Hours & Status'}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'وضع الحالة' : 'Status Mode'}</label>
          <select
            value={statusMode}
            onChange={(e) => onUpdate((prev) => ({ ...prev, statusMode: e.target.value as 'auto' | 'open' | 'closed' }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          >
            <option value="auto">{isAr ? 'تلقائي (حسب المواعيد)' : 'Auto (from hours)'}</option>
            <option value="open">{isAr ? 'مفتوح دائماً' : 'Always Open'}</option>
            <option value="closed">{isAr ? 'مغلق دائماً' : 'Always Closed'}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'وقت الفتح (ساعة:دقيقة)' : 'Open Time (HH:MM)'}</label>
          <input
            type="time"
            value={openTime}
            onChange={(e) => onUpdate((prev) => ({ ...prev, openTime: e.target.value }))}
            className="w-full min-w-0 max-w-[280px] h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)] [color-scheme:dark]"
          />
        </div>

        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'وقت الإغلاق (ساعة:دقيقة)' : 'Close Time (HH:MM)'}</label>
          <input
            type="time"
            value={closeTime}
            onChange={(e) => onUpdate((prev) => ({ ...prev, closeTime: e.target.value }))}
            className="w-full min-w-0 max-w-[280px] h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)] [color-scheme:dark]"
          />
        </div>
      </div>

      {/* Live AM/PM preview so open/close are never ambiguous */}
      <p className="text-xs font-bold text-[var(--primary)]">
        {isAr
          ? `يفتح ${formatTime12h(openTime, true)} – يغلق ${formatTime12h(closeTime, true)}`
          : `Opens ${formatTime12h(openTime, false)} – Closes ${formatTime12h(closeTime, false)}`}
      </p>

      {/* Working days: tap to include/exclude a day */}
      <div>
        <span className="block text-xs text-neutral-400 mb-2">
          {isAr ? 'أيام العمل (اضغط لتفعيل/إيقاف اليوم)' : 'Working days (tap to toggle)'}
        </span>
        <div className="flex flex-wrap gap-2">
          {([
            { id: 'sat', en: 'Sat', ar: 'السبت' },
            { id: 'sun', en: 'Sun', ar: 'الأحد' },
            { id: 'mon', en: 'Mon', ar: 'الاثنين' },
            { id: 'tue', en: 'Tue', ar: 'الثلاثاء' },
            { id: 'wed', en: 'Wed', ar: 'الأربعاء' },
            { id: 'thu', en: 'Thu', ar: 'الخميس' },
            { id: 'fri', en: 'Fri', ar: 'الجمعة' },
          ] as const).map((d) => {
            const days = workingDays && workingDays.length ? workingDays : ALL_DAYS;
            const on = days.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  const current = workingDays && workingDays.length ? workingDays : ALL_DAYS;
                  const next = current.includes(d.id)
                    ? current.filter((x) => x !== d.id)
                    : [...current, d.id];
                  onUpdate((prev) => ({ ...prev, workingDays: next.length ? next : [...current] }));
                }}
                aria-pressed={on}
                title={isAr ? d.ar : d.en}
                className={`h-11 min-h-[44px] min-w-[52px] px-4 rounded-full text-xs font-bold border-[1.5px] transition-all btn-tactile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                  on
                    ? 'bg-[var(--primary)] text-[#0A0A0A] border-[var(--primary)]'
                    : 'bg-transparent text-neutral-400 border-neutral-700 hover:border-neutral-500'
                }`}
              >
                {isAr ? d.ar : d.en}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
