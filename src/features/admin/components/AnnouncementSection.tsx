// TODO(maint): 418 lines — split into AnnouncementSection + AnnouncementTickerPreview
// (own file) + AnnouncementForm when next touched. Documented, not refactored (Fix 3C).
import React from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { toDatetimeLocalValue, parseDatetimeLocal, toDatetimeLocalDeviceValue, deviceWallPartsToUTC } from '@/src/utils/tz';
import { serverNow } from '@/src/utils/serverTime';
import { announcementStatus, annSpeed } from '@/src/utils/announcement';
import { useTickerLoop } from '@/src/hooks/useTickerLoop';

type Announcement = MenuSettings['announcement'];

interface AnnouncementSectionProps {
  announcement: Announcement;
  timezone: string;
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: Announcement) => Announcement) => void;
}

/** Storefront-faithful ticker preview: measures its own width so the reading
 *  speed (px/s) matches the live banner exactly — same track math
 *  (2 halves, loop 0 → -50%), same pxPerSec curve. */
function AnnouncementTickerPreview({ text, speed, isAr }: { text: string; speed: number; isAr: boolean }) {
  const { boxRef, half, duration } = useTickerLoop(true, text, speed);

  return (
    <div
      ref={boxRef}
      className="ann-mask overflow-hidden rounded-full bg-[var(--primary)] text-[#0A0A0A] py-2 [mask-image:linear-gradient(to_right,transparent,black_20px,black_calc(100%-20px),transparent)]"
    >
      <div
        aria-hidden="true"
        dir="ltr"
        className="ann-track"
        style={{ ['--ann-duration' as string]: `${Math.max(3, duration)}s` }}
      >
        {Array.from({ length: half * 2 }, (_, i) => (
          <span key={i} aria-hidden={i > 0 || undefined} className="ann-unit flex shrink-0 items-center">
            <span dir={isAr ? 'rtl' : 'ltr'} className="text-xs font-bold whitespace-nowrap">
              {text}
            </span>
            <span aria-hidden="true" className="mx-6 text-[10px] opacity-50 select-none">
              ✦
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Human relative time ("in 3 hours" / "منذ يومين") for schedule hints. */
function formatRelative(ms: number, isAr: boolean): string {
  const abs = Math.abs(ms);
  const future = ms > 0;
  const unit = (n: number, one: string, two: string, few: string, many: string): string =>
    isAr
      ? n === 1
        ? one
        : n === 2
          ? two
          : n <= 10
            ? `${n} ${few}`
            : `${n} ${many}`
      : `${n} ${n === 1 ? one : many}`;
  if (abs < 60000) return isAr ? 'الآن' : 'now';
  if (abs < 3600000) {
    const m = Math.max(1, Math.round(abs / 60000));
    const t = unit(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
    return future ? (isAr ? `بعد ${t}` : `in ${m} min`) : isAr ? `منذ ${t}` : `${m} min ago`;
  }
  if (abs < 86400000) {
    const h = Math.max(1, Math.round(abs / 3600000));
    const t = unit(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
    return future ? (isAr ? `بعد ${t}` : `in ${h}h`) : isAr ? `منذ ${t}` : `${h}h ago`;
  }
  const d = Math.max(1, Math.round(abs / 86400000));
  const t = unit(d, 'يوم', 'يومين', 'أيام', 'يوم');
  return future ? (isAr ? `بعد ${t}` : `in ${d}d`) : isAr ? `منذ ${t}` : `${d}d ago`;
}

interface SchedulePreset {
  key: string;
  label: string;
  deltaMs: number | null;
}

/** Pro schedule picker: dark-native datetime input + quick presets + human hint. */
function ScheduleField({
  label,
  iso,
  timezone,
  lang,
  kind,
  onPick,
}: {
  label: string;
  iso: string | null;
  timezone: string;
  lang: 'en' | 'ar';
  kind: 'start' | 'end';
  onPick: (iso: string | null) => void;
}) {
  const isAr = lang === 'ar';
  const presets: SchedulePreset[] =
    kind === 'start'
      ? [
          { key: 'now', label: isAr ? 'الآن' : 'Now', deltaMs: 0 },
          { key: 'clear', label: isAr ? 'مسح' : 'Clear', deltaMs: null },
        ]
      : [
          { key: 'h1', label: isAr ? '+ ساعة' : '+1h', deltaMs: 3600000 },
          { key: 'h6', label: isAr ? '+ 6 ساعات' : '+6h', deltaMs: 6 * 3600000 },
          { key: 'd1', label: isAr ? '+ يوم' : '+1d', deltaMs: 86400000 },
          { key: 'd7', label: isAr ? '+ أسبوع' : '+1w', deltaMs: 7 * 86400000 },
          { key: 'clear', label: isAr ? 'مسح' : 'Clear', deltaMs: null },
        ];
  const target = iso ? Date.parse(iso) : NaN;
  const hint = !iso
    ? kind === 'start'
      ? isAr
        ? 'فوري — يبدأ بمجرد التفعيل'
        : 'Immediate — starts once enabled'
      : isAr
        ? 'بدون نهاية — ظاهر دائمًا'
        : 'No end — always shown'
    : !Number.isFinite(target)
      ? ''
      : kind === 'start'
        ? Number.isFinite(target) && target > serverNow()
          ? isAr
            ? `يبدأ ${formatRelative(target - serverNow(), isAr)}`
            : `Starts ${formatRelative(target - serverNow(), isAr)}`
          : isAr
            ? `بدأ ${formatRelative(target - serverNow(), isAr)}`
            : `Started ${formatRelative(target - serverNow(), isAr)}`
        : Number.isFinite(target) && target > serverNow()
          ? isAr
            ? `ينتهي ${formatRelative(target - serverNow(), isAr)}`
            : `Ends ${formatRelative(target - serverNow(), isAr)}`
          : isAr
            ? `انتهى ${formatRelative(target - serverNow(), isAr)}`
            : `Ended ${formatRelative(target - serverNow(), isAr)}`;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs text-neutral-400">{label}</label>
      </div>
      <div className="relative">
        <input
          type="datetime-local"
          dir="ltr"
          value={toDatetimeLocalDeviceValue(iso || '')}
          onChange={(e) => {
            const p = parseDatetimeLocal(e.target.value);
            onPick(p ? deviceWallPartsToUTC(p) : null);
          }}
          className="w-full h-10 ps-3 pe-9 rounded-xl bg-black border border-neutral-700 text-sm tabular-nums text-neutral-100 focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/40 outline-none [color-scheme:dark] transition-colors"
        />
        {iso && (
          <button
            type="button"
            onClick={() => onPick(null)}
            aria-label={isAr ? 'مسح التاريخ' : 'Clear date'}
            title={isAr ? 'مسح التاريخ' : 'Clear date'}
            className="absolute end-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 text-xs leading-none transition-colors"
          >
            ×
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPick(p.deltaMs === null ? null : new Date(Date.now() + p.deltaMs).toISOString())}
            className="px-2.5 h-7 rounded-full bg-neutral-900 border border-neutral-700 text-[11px] font-bold text-neutral-300 hover:text-[var(--primary)] hover:border-[var(--primary)]/60 active:scale-95 transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>
      {hint && <p className="text-[11px] text-neutral-500 mt-1 tabular-nums">{hint}</p>}
      {iso && Number.isFinite(Date.parse(iso)) && (
        <p className="text-[11px] text-neutral-600 mt-0.5 tabular-nums" dir="ltr" style={{ textAlign: isAr ? 'right' : 'left' }}>
          {isAr
            ? `= ${toDatetimeLocalValue(timezone, iso).replace('T', ' ')} بتوقيت المطعم`
            : `= ${toDatetimeLocalValue(timezone, iso).replace('T', ' ')} business time`}
        </p>
      )}
    </div>
  );
}

/** Announcement banner card of the admin Settings tab: toggles, schedule,
 *  inline validation, countdown and a storefront-faithful live preview. */
export const AnnouncementSection: React.FC<AnnouncementSectionProps> = ({
  announcement,
  timezone,
  lang,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div>
        <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
          {isAr ? 'شريط الإعلان' : 'Announcement banner'}
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {isAr ? 'شريط أصفر متحرك أعلى الموقع (140 حرفاً كحد أقصى) — توقف عند مرور المؤشر' : 'A scrolling yellow ticker above the site (140 chars max) — pauses on hover'}
        </p>
      </div>
      <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
        <button
          type="button"
          role="switch"
          aria-checked={!!announcement.enabled}
          onClick={() => onUpdate((prev) => ({ ...prev, enabled: !prev.enabled }))}
          className="w-full flex items-center justify-between gap-3 text-start"
        >
          <span className="block text-xs font-bold">{isAr ? 'إظهار الشريط' : 'Show banner'}</span>
          <span className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${announcement.enabled ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${announcement.enabled ? (isAr ? 'left-0.5' : 'left-5') : (isAr ? 'left-5' : 'left-0.5')}`} />
          </span>
        </button>
        {/* Motion: scrolling ticker on/off */}
        <button
          type="button"
          role="switch"
          aria-checked={announcement.scroll !== false}
          onClick={() => onUpdate((prev) => ({ ...prev, scroll: prev.scroll === false }))}
          className="w-full flex items-center justify-between gap-3 text-start"
        >
          <span>
            <span className="block text-xs font-bold">{isAr ? 'شريط متحرك' : 'Scrolling ticker'}</span>
            <span className="block text-[11px] text-neutral-500 mt-0.5">
              {isAr ? 'إيقافه يعرض النص ثابتاً في المنتصف' : 'Off shows the text static and centered'}
            </span>
          </span>
          <span className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${announcement.scroll !== false ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${announcement.scroll !== false ? (isAr ? 'left-0.5' : 'left-5') : (isAr ? 'left-5' : 'left-0.5')}`} />
          </span>
        </button>
        {/* Speed: 1 (slow) .. 10 (fast) */}
        <div className={announcement.scroll === false ? 'opacity-40 pointer-events-none' : ''}>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-neutral-400">{isAr ? 'سرعة الحركة' : 'Ticker speed'}</label>
            <span className="text-[11px] font-bold text-[var(--primary)] tabular-nums">
              {(() => {
                const s = announcement.speed ?? 5;
                const tag = s <= 3 ? (isAr ? 'بطيئة' : 'Slow') : s <= 7 ? (isAr ? 'متوسطة' : 'Medium') : (isAr ? 'سريعة' : 'Fast');
                return `${s} · ${tag}`;
              })()}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={announcement.speed ?? 5}
            onChange={(e) => onUpdate((prev) => ({ ...prev, speed: Number(e.target.value) }))}
            aria-label={isAr ? 'سرعة الحركة' : 'Ticker speed'}
            className="w-full accent-[var(--primary)]"
          />
          <div className="flex justify-between text-[10px] text-neutral-500 mt-0.5">
            <span>{isAr ? 'بطيئة' : 'Slow'}</span>
            <span>{isAr ? 'سريعة' : 'Fast'}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-neutral-400">{isAr ? 'النص (EN)' : 'Text (EN)'}</label>
              <span className="text-[10px] text-neutral-500 tabular-nums">{(announcement.text.en || '').length}/140</span>
            </div>
            <input
              type="text"
              value={announcement.text.en}
              maxLength={140}
              onChange={(e) => onUpdate((prev) => ({ ...prev, text: { ...prev.text, en: e.target.value } }))}
              className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-neutral-400">{isAr ? 'النص (AR)' : 'Text (AR)'}</label>
              <span className="text-[10px] text-neutral-500 tabular-nums">{(announcement.text.ar || '').length}/140</span>
            </div>
            <input
              type="text"
              dir="rtl"
              value={announcement.text.ar}
              maxLength={140}
              onChange={(e) => onUpdate((prev) => ({ ...prev, text: { ...prev.text, ar: e.target.value } }))}
              className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ScheduleField
            label={isAr ? 'يبدأ (بتوقيت جهازك)' : 'Starts (your device time)'}
            iso={announcement.startsAt}
            timezone={timezone}
            lang={lang}
            kind="start"
            onPick={(iso) => onUpdate((prev) => ({ ...prev, startsAt: iso }))}
          />
          <ScheduleField
            label={isAr ? 'ينتهي (بتوقيت جهازك)' : 'Ends (your device time)'}
            iso={announcement.expiresAt}
            timezone={timezone}
            lang={lang}
            kind="end"
            onPick={(iso) => onUpdate((prev) => ({ ...prev, expiresAt: iso }))}
          />
        </div>
        {/* Schedule problems are shown inline (same rules as the server),
            so a bad range is caught before save instead of a raw 400. */}
        {(() => {
          const s = announcement.startsAt ? Date.parse(announcement.startsAt) : NaN;
          const e = announcement.expiresAt ? Date.parse(announcement.expiresAt) : NaN;
          const hints: string[] = [];
          if (announcement.enabled && !announcement.text.en.trim() && !announcement.text.ar.trim()) {
            hints.push(isAr ? 'الشريط مفعّل لكن بدون نص — لن يظهر حتى تكتب نصاً' : 'Banner is on but has no text — it will stay hidden until you write some');
          }
          if (Number.isFinite(s) && Number.isFinite(e) && (e) <= (s)) {
            hints.push(isAr ? 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء' : 'Ends must be after Starts');
          }
          if (Number.isFinite(e) && (e) > serverNow() + 365 * 86400000) {
            hints.push(isAr ? 'تاريخ الانتهاء يجب أن يكون خلال 365 يوماً' : 'Ends must be within 365 days');
          }
          if (!hints.length) return null;
          return (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-2.5 space-y-1">
              {hints.map((h, i) => (
                <p key={i} className="text-[11px] font-bold text-red-400">{h}</p>
              ))}
            </div>
          );
        })()}
        <p className="text-[11px] text-neutral-500">
          {isAr ? 'التواريخ الفارغة = ظاهر دائماً (بتوقيت جهازك)' : 'Empty dates = always shown (your device time)'}
          {announcement.expiresAt && (
            <>
              {' · '}
              {(() => {
                const ms = Date.parse(announcement.expiresAt) - serverNow();
                if (!Number.isFinite(ms) || ms <= 0) return isAr ? 'انتهى' : 'Ended';
                const days = Math.floor(ms / 86400000);
                return days >= 1
                  ? (isAr ? `ينتهي بعد ${days} ${days === 1 ? 'يوم' : 'أيام'}` : `Ends in ${days} day${days === 1 ? '' : 's'}`)
                  : (isAr ? 'ينتهي اليوم' : 'Ends today');
              })()}
              {' · '}
              <button
                type="button"
                onClick={() => onUpdate((prev) => ({ ...prev, startsAt: null, expiresAt: null }))}
                className="font-bold text-[var(--primary)] hover:underline"
              >
                {isAr ? 'مسح التواريخ' : 'Clear dates'}
              </button>
            </>
          )}
        </p>
        {(() => {
          // Same verdict function as the storefront, so the status pill can
          // never disagree with what customers actually see. The design
          // itself always previews when text exists (it's a preview).
          const { status } = announcementStatus(announcement, lang, serverNow());
          const previewText =
            (lang === 'ar' ? announcement.text.ar : announcement.text.en) ||
            (lang === 'ar' ? announcement.text.en : announcement.text.ar) ||
            '';
          const pill: Record<string, string> = {
            visible: isAr ? 'ظاهر الآن' : 'Live now',
            off: isAr ? 'مخفي — الشريط مطفأ' : 'Hidden — banner is off',
            empty: isAr ? 'مخفي — لا يوجد نص' : 'Hidden — no text',
            scheduled: isAr ? 'مجدول — لم يبدأ بعد' : 'Scheduled — not started yet',
            expired: isAr ? 'انتهى — لم يعد ظاهراً' : 'Ended — no longer shown',
          };
          return (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] text-neutral-500 font-bold">
                  {isAr ? 'معاينة حية' : 'Live preview'}
                </p>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    status === 'visible' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-neutral-700/40 text-neutral-400'
                  }`}
                >
                  {pill[status]}
                </span>
              </div>
              {previewText ? (
                announcement.scroll === false ? (
                  <div className="rounded-full bg-[var(--primary)] text-[#0A0A0A] px-4 py-2">
                    <p className="text-xs font-bold leading-snug line-clamp-2" dir={isAr ? 'rtl' : 'ltr'}>
                      {previewText}
                    </p>
                  </div>
                ) : (
                  <AnnouncementTickerPreview text={previewText} speed={annSpeed(announcement)} isAr={isAr} />
                )
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-700 px-4 py-3 text-center">
                  <p className="text-[11px] text-neutral-500">
                    {isAr ? 'اكتب نص الإعلان أعلاه لترى المعاينة هنا' : 'Write the announcement text above to preview it here'}
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
};
