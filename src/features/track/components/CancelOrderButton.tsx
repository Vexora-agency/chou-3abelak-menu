import React, { useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';

export const CUSTOMER_CANCEL_WINDOW_MS = 5 * 60 * 1000;

interface CancelOrderButtonProps {
  number: number;
  token: string;
  /** Order creation time (server clock from /api/track, or shelf time). */
  createdAt: string | null;
  status: string;
  lang: 'en' | 'ar';
  darkMode?: boolean;
  onCancelled?: () => void;
}

function remainingMs(createdAt: string | null, nowMs: number): number {
  if (!createdAt) return CUSTOMER_CANCEL_WINDOW_MS;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return CUSTOMER_CANCEL_WINDOW_MS;
  return t + CUSTOMER_CANCEL_WINDOW_MS - nowMs;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Customer self-cancel: a red countdown button, visible ONLY inside the
 * 5-minute window while the order is still `new`. The server re-checks
 * both conditions atomically (a confirmed order or an expired window
 * answers 409 `too_late`), so the client countdown is UX, not security.
 * The same 5 minutes double as the preparation grace period: the order stays
 * hidden from the admin dashboard + Telegram until the window lapses.
 */
export const CancelOrderButton: React.FC<CancelOrderButtonProps> = ({
  number, token, createdAt, status, lang, darkMode = true, onCancelled,
}) => {
  const isAr = lang === 'ar';
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    // 250ms tick: the seconds readout stays stable (ceil) while the
    // progress bar underneath drains smoothly — a live, professional feel.
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  if (done || status !== 'new') return null;
  const left = remainingMs(createdAt, nowMs);
  if (left <= 0) return null;
  const progress = Math.max(0, Math.min(1, left / CUSTOMER_CANCEL_WINDOW_MS));
  const urgent = left <= 30 * 1000;

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    setDenied(false);
    try {
      const res = await fetch('/api/track/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, t: token }),
      });
      let data: { ok?: boolean; error?: string } | null = null;
      try {
        data = (await res.json()) as { ok?: boolean; error?: string };
      } catch {
        data = null;
      }
      if (res.ok && data?.ok) {
        setDone(true);
        onCancelled?.();
      } else if (res.status === 409 || data?.error === 'too_late') {
        // The place already confirmed (or window lapsed on the server clock):
        // cancelling is closed — call us instead.
        setDenied(true);
      }
    } catch {
      // Network failure: stay put so the customer can retry while time lasts.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => void cancel()}
        disabled={busy}
        aria-label={isAr ? 'إلغاء الطلب' : 'Cancel order'}
        className={`btn-tactile relative overflow-hidden w-full h-12 min-h-[48px] px-5 rounded-full text-white text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-md hover:brightness-110 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 ${
          urgent && !busy ? 'bg-red-700 animate-pulse' : 'bg-red-600'
        }`}
      >
        {/* Time-remaining bar: drains inline-start to inline-end as the window lapses. */}
        <span
          aria-hidden="true"
          className="absolute bottom-0 start-0 top-0 bg-white/15 transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
        {busy ? (
          <Loader2 size={16} className="relative animate-spin" />
        ) : (
          <span className="relative inline-flex items-center gap-2">
            <XCircle size={16} />
            <span>{isAr ? 'إلغاء الطلب' : 'Cancel order'}</span>
            <span dir="ltr" role="timer" className="tabular-nums rounded-md bg-black/25 px-1.5 py-0.5 text-[13px] font-black">
              {fmtCountdown(left)}
            </span>
          </span>
        )}
      </button>
      {denied && (
        <p className={`mt-1.5 text-[11px] font-bold ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
            {isAr ? 'بدأ التجهيز أو انتهت المهلة — اتصل بنا للإلغاء.' : 'Preparation started or time ran out — call us to cancel.'}
        </p>
      )}
    </div>
  );
};
