import type { FC } from 'react';

/** Short bilingual labels for backend risk reason codes. Unknown codes render raw. */
const REASON_LABEL: Record<string, { ar: string; en: string }> = {
  test_name: { ar: 'اسم تجريبي', en: 'test-like name' },
  repeated_digits: { ar: 'رقم مكرر', en: 'repeated digits' },
  night_order: { ar: 'طلب ليلي', en: 'night order' },
  many_cancelled: { ar: 'إلغاءات سابقة', en: 'past cancellations' },
  frequent_phone: { ar: 'طلبات متكررة', en: 'frequent orders' },
};

interface OrderReviewBadgeProps {
  lang: 'en' | 'ar';
  /** Absent on older orders — treat undefined as not-review (back-compat). */
  needsReview?: boolean;
  riskReasons?: string[];
}

const labelFor = (code: string, lang: 'en' | 'ar'): string =>
  REASON_LABEL[code]?.[lang] ?? code;

/** Amber "needs review" pill for fake-order risk. Renders nothing unless flagged. */
export const OrderReviewBadge: FC<OrderReviewBadgeProps> = ({ lang, needsReview, riskReasons }) => {
  if (needsReview !== true) return null;
  const reasons = Array.isArray(riskReasons) ? riskReasons.filter((r) => typeof r === 'string') : [];
  const tip = reasons.map((r) => labelFor(r, lang)).join(lang === 'ar' ? '، ' : ', ');
  return (
    <span
      dir="auto"
      title={tip || undefined}
      className="shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-amber-400/40 bg-amber-400/10 text-amber-300"
    >
      {lang === 'ar' ? 'يحتاج مراجعة' : 'Needs review'}
    </span>
  );
};

/** Shared by tests/docs: map a raw reason code to its short bilingual label. */
export const riskReasonLabel = (code: string, lang: 'en' | 'ar'): string => labelFor(code, lang);
