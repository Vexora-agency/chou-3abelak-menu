import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Loader2, Moon, PauseCircle, Play, X } from 'lucide-react';

export type OrderingToggleState = 'open' | 'paused' | 'closed';

interface OrderingToggleProps {
  lang: 'en' | 'ar';
  state: OrderingToggleState;
  /** ISO instant when a timed pause resumes (null = until resumed). */
  resumesAt?: string | null;
  /** ISO instant when a closed schedule reopens (shown only when closed). */
  reopensAt?: string | null;
  timezone: string;
  /** Device clock correction from the server Date header, in ms. */
  clockOffsetMs?: number;
  /** UTC ms of when the current pause started (live elapsed timer). */
  pausedAtMs?: number | null;
  onPause: (minutes: number | null) => Promise<void>;
  onResume: () => Promise<void>;
}

const STR = {
  en: { accepting: 'Accepting orders', paused: 'Orders paused', closed: 'Closed by schedule', subOpen: 'Customers can place orders.', subPaused: 'Customers cannot send orders.', subClosed: (t: string) => `Customers cannot order until ${t}.`, subClosedNo: 'Customers cannot order right now.',
    pauseFor: 'Pause for how long?', m30: '30 min', h1: '1 hour', h2: '2 hours', until: 'Until I resume', cancel: 'Cancel', resume: 'Resume now', resumesIn: 'Resumes in', elapsed: 'Paused for', manual: 'Stays paused until you resume', segOn: 'Accepting', segOff: 'Paused', done: 'Updated' },
  ar: { accepting: 'نستقبل الطلبات', paused: 'الطلبات متوقفة', closed: 'مغلق حسب الجدول', subOpen: 'يمكن للعملاء إرسال الطلبات.', subPaused: 'لا يستطيع العملاء إرسال الطلبات.', subClosed: (t: string) => `لا يستطيع العملاء الطلب حتى ${t}.`, subClosedNo: 'لا يستطيع العملاء الطلب الآن.',
    pauseFor: 'لكم من الوقت تريد الإيقاف؟', m30: '30 دقيقة', h1: 'ساعة', h2: 'ساعتان', until: 'حتى أستأنف', cancel: 'إلغاء', resume: 'استئناف الآن', resumesIn: 'تستأنف بعد', elapsed: 'متوقف منذ', manual: 'تبقى متوقفة حتى تستأنفها', segOn: 'نستقبل', segOff: 'إيقاف', done: 'تم التحديث' },
} as const;

/** Local time formatted in the business timezone (device-clock independent via clockOffsetMs). */
function formatTime(ms: number, timezone: string, lang: 'en' | 'ar'): string {
  return new Date(ms).toLocaleTimeString(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { hour: '2-digit', minute: '2-digit', timeZone: timezone });
}

const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(r).padStart(2, '0')}`; };
const hhmmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; };

/** Admin pause control: segmented Accepting/Paused switch, duration picker,
 *  live countdown with progress, and resume — same design as the storefront motion. */
const OrderingToggle: React.FC<OrderingToggleProps> = ({ lang, state, resumesAt, reopensAt, timezone, clockOffsetMs = 0, pausedAtMs, onPause, onResume }) => {
  const t = STR[lang]; const isAr = lang === 'ar'; const reduce = useReducedMotion();
  const paused = state === 'paused';
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now() + clockOffsetMs);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  // Tick every second while paused (the countdown and elapsed timer need fresh `now`).
  useEffect(() => { if (!paused) return; const id = window.setInterval(() => setNow(Date.now() + clockOffsetMs), 1000); return () => window.clearInterval(id); }, [paused, clockOffsetMs]);
  // Reset the panel when pausing ends (render-phase adjustment: applies
  // before paint, so no extra render and no effect warning).
  const [wasPaused, setWasPaused] = useState(paused);
  if (wasPaused !== paused) {
    setWasPaused(paused);
    if (!paused) {
      setTotalMs(null);
      setChoosing(false);
    }
  }

  const until = resumesAt ? Date.parse(resumesAt) : null;
  const left = until !== null ? until - now : null;
  const pct = left !== null && totalMs ? Math.min(100, Math.max(0, (left / totalMs) * 100)) : null;
  const elapsed = paused && pausedAtMs ? now - pausedAtMs : null;
  const sub = paused ? t.subPaused : state === 'closed' ? (reopensAt ? t.subClosed(formatTime(Date.parse(reopensAt), timezone, lang)) : t.subClosedNo) : t.subOpen;
  const title = paused ? t.paused : state === 'closed' ? t.closed : t.accepting;

  const doPause = async (minutes: number | null) => { setBusy(true); setTotalMs(minutes ? minutes * 60000 : null); await onPause(minutes); setBusy(false); setChoosing(false); };
  const doResume = async () => { setBusy(true); await onResume(); setBusy(false); };
  const chips: [string, number | null][] = [[t.m30, 30], [t.h1, 60], [t.h2, 120], [t.until, null]];

  return (
    <div dir={isAr ? 'rtl' : 'ltr'} className={`rounded-2xl border p-4 transition-colors ${paused ? 'bg-amber-500/[0.07] border-amber-400/40' : 'bg-neutral-900 border-neutral-800'}`}>
      <div className="flex items-center gap-3.5 flex-wrap">
        <span className={`w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center ${paused ? 'bg-amber-400/15 text-amber-300' : state === 'closed' ? 'bg-neutral-800 text-neutral-300' : 'bg-green-500/15 text-green-400'}`}>
          {paused ? <PauseCircle size={22} /> : state === 'closed' ? <Moon size={21} /> : (
            <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60 animate-ping" /><span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" /></span>
          )}
        </span>
        <span className="min-w-0 flex-1 basis-48">
          <b className="block text-sm font-extrabold">{title}</b>
          <span className="block text-xs text-neutral-400 mt-0.5">{sub}</span>
        </span>
        <div className="flex p-1 rounded-full bg-black border border-neutral-800" role="group" aria-label={t.accepting}>
          {([['on', t.segOn], ['off', t.segOff]] as const).map(([k, label]) => {
            const active = (k === 'off') === paused;
            return (
              <button key={k} type="button" disabled={busy} aria-pressed={active}
                onClick={() => { if (k === 'off') { if (!paused) setChoosing((v) => !v); } else if (paused) void doResume(); }}
                className={`relative px-4 h-9 rounded-full text-xs font-bold transition-colors ${active ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}>
                {active && <motion.span layoutId="ordering-seg" className={`absolute inset-0 rounded-full ${paused ? 'bg-amber-300' : 'bg-[#FFC400]'}`} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {choosing && !paused && (
          <motion.div key="choose" initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden relative z-30">
            <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => setChoosing(false)} className="fixed inset-0 z-20 cursor-default bg-transparent" />
            {/* Panel sits above the click-catcher so duration chips stay tappable */}
            <div className="pt-4 relative z-30">
              <p className="text-xs font-semibold text-neutral-300 mb-2.5">{t.pauseFor}</p>
              <div className="flex flex-wrap gap-2">
                {chips.map(([label, m]) => (
                  <button key={label} type="button" disabled={busy} onClick={() => void doPause(m)} className="btn-tactile h-10 px-4 rounded-full border border-neutral-700 bg-black text-xs font-bold text-neutral-100 hover:border-[#FFC400] hover:text-[#FFC400] inline-flex items-center gap-1.5 disabled:opacity-50">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : null}{label}
                  </button>
                ))}
                <button type="button" onClick={() => setChoosing(false)} className="h-10 px-3 rounded-full text-xs font-bold text-neutral-500 inline-flex items-center gap-1"><X size={14} />{t.cancel}</button>
              </div>
            </div>
          </motion.div>
        )}
        {paused && (
          <motion.div key="paused" initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="pt-4 flex items-center gap-3 flex-wrap">
              <span className="flex-1 basis-48 min-w-0">
                <span className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-neutral-300">
                    {left !== null ? t.resumesIn : t.manual}
                    {elapsed !== null && <span className="ms-2 text-neutral-500 tabular-nums">· {t.elapsed} {hhmmss(elapsed)}</span>}
                  </span>
                  {left !== null && <b className="text-lg font-black tabular-nums text-amber-300" dir="ltr">{mmss(left)}</b>}
                </span>
                {pct !== null && <span className="mt-2 block h-1.5 rounded-full bg-black overflow-hidden"><motion.span className="block h-full rounded-full bg-amber-300" animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: 'linear' }} /></span>}
              </span>
              <button type="button" disabled={busy} onClick={() => void doResume()} className="btn-tactile h-10 px-4 rounded-full bg-[#FFC400] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} strokeWidth={3} />}{t.resume}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrderingToggle;
