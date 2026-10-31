import React, { useState } from 'react';
import { Power } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';

interface OnlineOrderingSwitchProps {
  lang: 'en' | 'ar';
  enabled: boolean;
  whatsapp: string;
  adminFetch: AdminFetch;
  onMenuRefreshed: () => Promise<boolean>;
}

// Master online-ordering switch (instant save, not draft): the pause control
// cannot accept orders while this is off. Enabling requires a WhatsApp
// number; every failure mode reports its own message (session vs number
// format vs save) instead of one blind error.
export const OnlineOrderingSwitch: React.FC<OnlineOrderingSwitchProps> = ({
  lang,
  enabled,
  whatsapp,
  adminFetch,
  onMenuRefreshed,
}) => {
  const isAr = lang === 'ar';
  const hasWhatsapp = (whatsapp || '').replace(/\D/g, '').length >= 8;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleToggle = async () => {
    setErr(null);
    if (busy) return;
    if (!enabled && !hasWhatsapp) {
      setErr(isAr
        ? 'أضف رقم واتساب دولياً بدون صفر البداية (قسم الهوية، مثال: 96170123456) أولاً — لا يمكن التفعيل بدونه.'
        : 'Add an international WhatsApp number with no leading zero (Identity section, e.g. 96170123456) first — ordering cannot be enabled without it.');
      return;
    }
    setBusy(true);
    let kind = 'save';
    try {
      const r = await adminFetch('/api/admin/ordering/enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!r.ok) {
        let code = '';
        try {
          code = ((await r.json()) as { error?: string } | null)?.error || '';
        } catch {}
        if (r.status === 401 || r.status === 403) kind = 'session';
        else if (code === 'validation_error') kind = 'whatsapp';
        throw new Error(kind);
      }
      setErr(null);
      await onMenuRefreshed();
    } catch {
      setErr(
        kind === 'session'
          ? (isAr ? 'انتهت الجلسة. سجل الدخول مجدداً ثم حاول.' : 'Session expired. Log in again, then retry.')
          : kind === 'whatsapp'
          ? (isAr ? 'تعذر التفعيل — الرقم يجب أن يكون دولياً بدون صفر البداية (مثال: 96170123456).' : 'Could not enable — the number must be international with no leading zero (e.g. 96170123456).')
          : (isAr ? 'تعذر الحفظ. حاول مجدداً.' : 'Could not save. Please try again.')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border p-3.5 bg-black/40 border-neutral-800">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={busy}
        onClick={() => void handleToggle()}
        aria-label={isAr ? 'تشغيل أو إيقاف الطلب أونلاين' : 'Turn online ordering on or off'}
        className="w-full flex items-center gap-3 min-h-[44px] text-start rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-60"
      >
        <span className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${enabled ? 'bg-green-500/15 text-green-400' : 'bg-neutral-800 text-neutral-400'}`}>
          <Power size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-xs font-extrabold">{isAr ? 'الطلب أونلاين' : 'Online ordering'}</b>
          <span className="block text-[11px] text-neutral-500 mt-0.5">
            {enabled
              ? (isAr ? 'يستطيع العملاء إتمام الطلب.' : 'Customers can check out.')
              : (isAr ? 'المفتاح الرئيسي — لا يستطيع العملاء الطلب وهو متوقف.' : 'Master switch — customers cannot order while it is off.')}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${enabled ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${enabled ? (isAr ? 'left-0.5' : 'left-5') : (isAr ? 'left-5' : 'left-0.5')}`} />
        </span>
      </button>
      {!enabled && !hasWhatsapp && (
        <p className="mt-2.5 text-xs font-bold text-amber-300">
          {isAr ? 'أضف رقم واتساب دولياً بدون صفر البداية (الهوية، مثال: ' : 'Add an international WhatsApp number with no leading zero (Identity, e.g. '}<span dir="ltr" className="tabular-nums">96170123456</span>{isAr ? ') — بدونه لا يمكن التفعيل.' : ') — enabling requires it.'}
        </p>
      )}
      {err && (
        <p className="mt-2.5 text-xs font-bold text-red-400" role="alert">{err}</p>
      )}
    </div>
  );
};
