import React, { useState } from 'react';
import { CheckCircle2, Loader2, PackageCheck } from 'lucide-react';
import { publicPostRaw } from '@/src/lib/api-client';

interface ReceivedButtonProps {
  number: number;
  token: string;
  lang: 'en' | 'ar';
  darkMode?: boolean;
  compact?: boolean;
/**
 * Gated by confirmation: true while the order is still `new` (the owner
 * hasn't tapped "بدء التحضير" yet). The button renders disabled with a
 * waiting hint instead of completing — backend enforces the same rule.
 */
  disabled?: boolean;
  /**
   * Overrides the hint under the disabled button (e.g. the delivery-lock
   * countdown the track page passes while `receivableAt` is still in the
   * future). Undefined = today's confirmation copy (bell + new-order paths
   * render exactly as before). A provided hint carries `role="timer"` since
   * it always wraps a live countdown.
   */
  waitingHint?: React.ReactNode;
  onConfirmed?: () => void;
}

/**
 * "Did you receive your order? [Yes ✅]" — shared by the floating bell
 * and the tracking page. POSTs to the token-gated /api/track/received
 * (the token IS the capability). Success marks the order completed
 * server-side and pings the owner on Telegram.
 */
export const ReceivedButton: React.FC<ReceivedButtonProps> = ({
  number, token, lang, darkMode = true, compact = false, disabled = false, waitingHint, onConfirmed,
}) => {
  const isAr = lang === 'ar';
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  if (done) {
    return (
      <div className={`rounded-2xl border p-4 text-center ${darkMode ? 'border-green-800/60 bg-green-950/40' : 'border-green-300 bg-green-50'}`}>
        <CheckCircle2 size={30} strokeWidth={2.5} className={`mx-auto ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
        <p className={`mt-1.5 text-sm font-black ${darkMode ? 'text-green-300' : 'text-green-800'}`}>
          {isAr ? 'تم تأكيد الاستلام — بالعافية!' : 'Receipt confirmed — enjoy!'}
        </p>
        <p className={`mt-0.5 text-[11px] ${darkMode ? 'text-green-500' : 'text-green-700'}`}>
          {isAr ? 'تم إرسال تأكيد الاستلام بنجاح' : 'Receipt confirmation sent'}
        </p>
      </div>
    );
  }

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await publicPostRaw('/api/track/received', { number, t: token }, 8000);
      if (!res) {
        setFailed(true);
        return;
      }
      let ok = false;
      try {
        const data = (await res.json()) as { ok?: boolean };
        ok = res.ok && data?.ok === true;
      } catch {
        ok = res.ok;
      }
      if (ok) {
        setDone(true);
        onConfirmed?.();
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? '' : 'rounded-xl border border-neutral-800 bg-black/40 p-3 text-center'}>
      {!compact && (
        <p className={`text-xs font-black mb-2.5 ${darkMode ? 'text-neutral-200' : 'text-neutral-800'}`}>
          {isAr ? 'هل استلمت طلبك؟' : 'Did you receive your order?'}
        </p>
      )}
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={busy || disabled}
        title={disabled ? (isAr ? 'بانتظار التأكيد' : 'Waiting for confirmation') : undefined}
        className={`btn-tactile inline-flex items-center gap-1.5 rounded-full font-extrabold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${
          compact ? 'h-11 min-h-[44px] px-5 text-xs' : 'h-12 min-h-[48px] px-6 text-sm'
        } ${disabled ? 'bg-neutral-700 text-neutral-400 cursor-not-allowed' : 'bg-[var(--primary)] text-[#0A0A0A]'}`}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <PackageCheck size={15} />}
        {isAr ? 'نعم، استلمت' : 'Yes, received'}
      </button>
      {disabled && (
        waitingHint !== undefined ? (
          <p role="timer" className={`mt-1.5 text-[11px] font-bold tabular-nums ${darkMode ? 'text-amber-400/90' : 'text-amber-700'}`}>
            {waitingHint}
          </p>
        ) : (
          <p className={`mt-1.5 text-[11px] font-bold ${darkMode ? 'text-amber-400/90' : 'text-amber-700'}`}>
            {isAr ? 'بانتظار التأكيد — الزر هيتفعل أول ما طلبك يبدأ يتجهز.' : 'Waiting for confirmation — this unlocks once your order starts being prepared.'}
          </p>
        )
      )}
      {failed && (
        <p className={`mt-1.5 text-[11px] font-bold ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
          {isAr ? 'تعذر التأكيد — حاول مجددًا.' : 'Could not confirm — try again.'}
        </p>
      )}
    </div>
  );
};
