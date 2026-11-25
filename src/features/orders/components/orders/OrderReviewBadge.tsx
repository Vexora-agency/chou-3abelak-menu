import { useEffect, useRef, useState, type FC } from 'react';
import { Info, ShieldCheck, Ban } from 'lucide-react';

/** Short bilingual labels for backend risk reason codes. Unknown codes render raw. */
const REASON_LABEL: Record<string, { ar: string; en: string }> = {
  test_name: { ar: 'اسم تجريبي', en: 'test-like name' },
  repeated_digits: { ar: 'رقم مكرر', en: 'repeated digits' },
  night_order: { ar: 'طلب ليلي', en: 'night order' },
  many_cancelled: { ar: 'إلغاءات سابقة', en: 'past cancellations' },
  frequent_phone: { ar: 'طلبات متكررة', en: 'frequent orders' },
};

const labelFor = (code: string, lang: 'en' | 'ar'): string =>
  REASON_LABEL[code]?.[lang] ?? code;

interface OrderReviewBadgeProps {
  lang: 'en' | 'ar';
  /** Absent on older orders — treat undefined as not-review (back-compat). */
  needsReview?: boolean;
  riskReasons?: string[];
  /** Customer phone (digits) — used for the block action. */
  phone?: string | null;
  orderNumber?: number;
  onTrust?: () => Promise<boolean>;
  onBlock?: () => void;
}

/**
 * Compact fraud-risk indicator: a small amber "i" dot. Tapping it opens a
 * popover with the human-readable reasons plus two professional actions —
 * mark trusted (clears the flag for this order) or block the number
 * (owner blocklist). Renders nothing unless flagged.
 */
export const OrderReviewBadge: FC<OrderReviewBadgeProps> = ({
  lang, needsReview, riskReasons, phone, orderNumber, onTrust, onBlock,
}) => {
  const [open, setOpen] = useState(false);
  const [trustBusy, setTrustBusy] = useState(false);
  const [trustFailed, setTrustFailed] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const isAr = lang === 'ar';
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  if (needsReview !== true) return null;
  const reasons = Array.isArray(riskReasons) ? riskReasons.filter((r) => typeof r === 'string') : [];
  const tip = reasons.map((r) => labelFor(r, lang)).join(isAr ? '، ' : ', ');
  const canBlock = typeof phone === 'string' && phone.replace(/[^0-9]/g, '').length >= 6;

  return (
    <span ref={wrapRef} className="shrink-0 inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={isAr ? 'تنبيه مراجعة: اضغط لعرض الأسباب' : 'Review alert: tap to see reasons'}
        aria-expanded={open}
        title={tip || undefined}
        className="w-6 h-6 min-w-[24px] min-h-[24px] rounded-full border border-amber-400/60 bg-amber-400/10 text-amber-300 flex items-center justify-center hover:bg-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <Info size={13} strokeWidth={2.5} aria-hidden="true" />
      </button>
      {open && (
        <span
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-black/60 anim-fade-in"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          />
          <span
            role="dialog"
            aria-label={isAr ? 'أسباب المراجعة' : 'Review reasons'}
            className="relative w-full max-w-[320px] rounded-2xl border border-amber-400/30 bg-[#171717] p-4 text-start shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
          <span className="block text-[11px] font-black text-amber-300">
            {isAr ? 'يحتاج مراجعة' : 'Needs review'}
            {typeof orderNumber === 'number' && (
              <span dir="ltr" className="tabular-nums"> #{orderNumber}</span>
            )}
          </span>
          {tip ? (
            <span className="mt-1 block text-[11px] leading-relaxed text-neutral-300" dir="auto">{tip}</span>
          ) : (
            <span className="mt-1 block text-[11px] leading-relaxed text-neutral-500">
              {isAr ? 'نمط طلب غير معتاد.' : 'Unusual order pattern.'}
            </span>
          )}
          <span className="mt-2.5 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={async () => {
                if (trustBusy) return;
                setTrustBusy(true);
                setTrustFailed(false);
                try {
                  const ok = onTrust ? await onTrust() : false;
                  if (ok) setOpen(false);
                  else setTrustFailed(true);
                } catch {
                  setTrustFailed(true);
                } finally {
                  setTrustBusy(false);
                }
              }}
              disabled={trustBusy}
              className="h-9 min-h-[36px] rounded-full bg-[var(--primary)] text-[#0A0A0A] text-[11px] font-extrabold inline-flex items-center justify-center gap-1.5 hover:brightness-110 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <ShieldCheck size={13} aria-hidden="true" />
              {trustBusy
                ? (isAr ? 'جارٍ الحفظ…' : 'Saving…')
                : (isAr ? 'طلب سليم — إزالة التنبيه' : 'Legit order — clear alert')}
            </button>
            {trustFailed && (
              <span role="alert" className="text-[11px] font-bold text-red-400">
                {isAr ? 'تعذر إزالة التنبيه — حاول مجددًا.' : 'Could not clear the alert — try again.'}
              </span>
            )}
            <button
              type="button"
              onClick={() => { setOpen(false); if (canBlock) onBlock?.(); }}
              disabled={!canBlock}
              title={!canBlock ? (isAr ? 'لا يوجد رقم صالح للحظر' : 'No valid number to block') : undefined}
              className="h-9 min-h-[36px] rounded-full border border-red-500/50 text-red-400 text-[11px] font-extrabold inline-flex items-center justify-center gap-1.5 hover:bg-red-500/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              <Ban size={13} aria-hidden="true" />
              {isAr ? 'حظر الرقم' : 'Block number'}
            </button>
          </span>
        </span>
        </span>
      )}
    </span>
  );
};

/** Shared by tests/docs: map a raw reason code to its short bilingual label. */
export const riskReasonLabel = (code: string, lang: 'en' | 'ar'): string =>
  labelFor(code, lang);
