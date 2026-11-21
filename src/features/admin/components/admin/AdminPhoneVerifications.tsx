import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  BadgeCheck,
  Check,
  Clock,
  Loader2,
  Phone,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';
import { readJson, isRecord } from '@/src/utils/safeJson';
import { useNow } from '@/src/hooks/useNow';
import { formatMMSS } from '@/src/utils/countdown';

interface AdminPhoneVerificationsProps {
  lang: 'en' | 'ar';
  adminFetch: AdminFetch;
}

interface PendingRow {
  id: string;
  phone: string;
  reference: string;
  method: 'whatsapp' | 'sms';
  createdAt: string;
  expiresAt: string;
  memberName: string;
  memberEmail: string;
}

const STR = {
  en: {
    title: 'WhatsApp phone verification',
    subtitle: 'Automatic WhatsApp verification is on. Rows here need a manual fallback decision — match the sender number + Ref, then approve.',
    pending: 'pending',
    refLabel: 'Ref',
    smsBadge: 'SMS',
    smsHint: 'Auto — no action needed unless it stays pending.',
    empty: 'No pending verification requests.',
    emptyHint: 'New requests appear here instantly; the owner also gets a Telegram ping.',
    refresh: 'Refresh',
    approve: 'Approve',
    reject: 'Reject',
    expired: 'Expired',
    expiresIn: 'Expires in',
    requested: 'Requested',
    approveError: 'Could not approve this request.',
    rejectError: 'Could not reject this request.',
    gone: 'This request was already decided or expired. Refresh the list.',
    loading: 'Loading requests…',
    error: 'Could not load verification requests.',
    openWhatsApp: 'Open WhatsApp',
  },
  ar: {
    title: 'تأكيد أرقام واتساب',
    subtitle: 'التأكيد التلقائي عبر واتساب مفعّل. الطلبات الظاهرة هنا تحتاج قرارًا يدويًا احتياطيًا — طابق رقم المرسل والمرجع ثم اعتمد.',
    pending: 'بالانتظار',
    refLabel: 'المرجع',
    smsBadge: 'SMS',
    smsHint: 'تلقائي — لا يحتاج تدخلًا إلا إذا بقي معلقًا.',
    empty: 'لا توجد طلبات تأكيد بالانتظار.',
    emptyHint: 'تظهر الطلبات الجديدة هنا فورًا، ويصلك تنبيه تيليجرام أيضًا.',
    refresh: 'تحديث',
    approve: 'اعتماد',
    reject: 'رفض',
    expired: 'منتهي',
    expiresIn: 'ينتهي بعد',
    requested: 'طُلب',
    approveError: 'تعذّر اعتماد الطلب.',
    rejectError: 'تعذّر رفض الطلب.',
    gone: 'تم البت في هذا الطلب أو انتهت صلاحيته. حدّث القائمة.',
    loading: 'جارٍ تحميل الطلبات…',
    error: 'تعذّر تحميل طلبات التأكيد.',
    openWhatsApp: 'فتح واتساب',
  },
} as const;

function timeLabel(iso: string, isAr: boolean): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleTimeString(isAr ? 'ar-EG-u-nu-latn' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminPhoneVerifications({ lang, adminFetch }: AdminPhoneVerificationsProps) {
  const t = STR[lang];
  const isAr = lang === 'ar';
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const aliveRef = useRef(true);
  const now = useNow(true, 15000);

  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) setLoading(true);
    try {
      const res = await adminFetch('/api/admin/phone-verifications?status=pending');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await readJson(res);
      if (!aliveRef.current) return;
      const list = isRecord(data) && Array.isArray(data.verifications) ? data.verifications : [];
      setRows(
        list
          .filter((row): row is Record<string, unknown> => isRecord(row))
          .map((row) => ({
            id: String(row.id || ''),
            phone: String(row.phone || ''),
            reference: String(row.reference || ''),
            method: row.method === 'sms' ? ('sms' as const) : ('whatsapp' as const),
            createdAt: String(row.createdAt || ''),
            expiresAt: String(row.expiresAt || ''),
            memberName: String(row.memberName || ''),
            memberEmail: String(row.memberEmail || ''),
          }))
          .filter((row) => row.id && row.phone && row.reference)
      );
      setError(false);
    } catch {
      if (!aliveRef.current) return;
      if (!quiet) setRows([]);
      setError(true);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    aliveRef.current = true;
    void load(false);
    const id = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void load(true);
      }
    }, 30000);
    return () => {
      aliveRef.current = false;
      window.clearInterval(id);
    };
  }, [load, version]);

  const decide = async (id: string, action: 'approve' | 'reject') => {
    if (busyId) return;
    setBusyId(id);
    setActionError('');
    try {
      const res = await adminFetch('/api/admin/phone-verifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        let code = '';
        try {
          const data: unknown = await readJson(res);
          if (isRecord(data) && typeof data.error === 'string') code = data.error;
        } catch {}
        setActionError(code === 'not_pending' ? t.gone : action === 'approve' ? t.approveError : t.rejectError);
        if (code === 'not_pending') setVersion((v) => v + 1);
        return;
      }
      setRows((prev) => prev.filter((row) => row.id !== id));
      setVersion((v) => v + 1);
    } catch {
      setActionError(action === 'approve' ? t.approveError : t.rejectError);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="overflow-hidden rounded-2xl border border-[var(--primary)]/30 bg-neutral-900"
      aria-labelledby="admin-phone-verify-title"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="flex items-start justify-between gap-3 border-b border-neutral-800 bg-[var(--primary)]/5 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[var(--primary)]">
            <ShieldCheck size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="admin-phone-verify-title" className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-white">
              {t.title}
              {rows.length > 0 && (
                <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-black">
                  {rows.length}
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-400">{t.subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          aria-label={t.refresh}
          title={t.refresh}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-700 text-neutral-300 transition-colors hover:border-[var(--primary)]/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>

      <div className="px-4 py-3 sm:px-5">
        {actionError && (
          <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-400">
            <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {actionError}
          </p>
        )}
        {error && rows.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-[11px] font-bold text-red-400">
            <AlertCircle size={14} aria-hidden="true" />
            {t.error}
          </p>
        ) : loading && rows.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-[11px] font-bold text-neutral-400">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {t.loading}
          </p>
        ) : rows.length === 0 ? (
          <div className="py-2">
            <p className="flex items-center gap-2 text-[11px] font-bold text-neutral-300">
              <BadgeCheck size={14} className="text-emerald-500" aria-hidden="true" />
              {t.empty}
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-neutral-500">{t.emptyHint}</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {rows.map((row) => {
              const expiresMs = Date.parse(row.expiresAt);
              const leftMs = Number.isFinite(expiresMs) ? Math.max(0, expiresMs - now) : 0;
              const busy = busyId === row.id;
              const waDigits = row.phone.replace(/[^0-9]/g, '');
              return (
                <li key={row.id} className="flex flex-col gap-3 py-3 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <b className="text-sm font-black tabular-nums text-white" dir="ltr">+{row.phone}</b>
                      <span className="rounded-md border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-[var(--primary)]" dir="ltr">
                        {t.refLabel} {row.reference}
                      </span>
                      {row.method === 'sms' && (
                        <span className="rounded-md border border-sky-400/40 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-sky-300">
                          {t.smsBadge}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] font-semibold text-neutral-300">
                      {row.memberName || row.memberEmail || '—'}
                    </p>
                    {row.method === 'sms' && (
                      <p className="mt-0.5 text-[10px] font-semibold text-sky-400/80">{t.smsHint}</p>
                    )}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-neutral-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} aria-hidden="true" />
                        {leftMs > 0 ? `${t.expiresIn} ${formatMMSS(leftMs)}` : t.expired}
                      </span>
                      <span>{t.requested} {timeLabel(row.createdAt, isAr)}</span>
                      {row.method !== 'sms' && waDigits && (
                        <a
                          href={`https://wa.me/${waDigits}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-neutral-400 underline underline-offset-2 hover:text-white"
                        >
                          <Phone size={11} aria-hidden="true" />
                          {t.openWhatsApp}
                        </a>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void decide(row.id, 'approve')}
                      disabled={busy}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-emerald-500 px-4 text-xs font-extrabold text-[#04240f] transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-60"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                      {t.approve}
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(row.id, 'reject')}
                      disabled={busy}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-neutral-700 px-3.5 text-xs font-bold text-neutral-300 transition-colors hover:border-red-500/50 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-60"
                    >
                      <X size={14} aria-hidden="true" />
                      {t.reject}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </motion.section>
  );
}
