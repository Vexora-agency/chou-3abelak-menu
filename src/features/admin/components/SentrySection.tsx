import React, { useCallback, useEffect, useState } from 'react';
import { Activity, FlaskConical } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';
import { isRecord, readJson, str } from '@/src/utils/safeJson';
import { captureFrontendError } from '@/src/lib/sentry';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

interface SentrySectionProps {
  lang: 'en' | 'ar';
  adminFetch: AdminFetch;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface SentryStatus {
  configured: boolean;
  environment: string;
  release: string | null;
}

/**
 * Error-monitoring (Sentry) diagnostics — owner-only by construction.
 * The status/test endpoints 403 non-master sessions, and this section
 * hides itself on 403 (a client login never sees it), mirroring
 * AccessSection. No DSN or secret is ever rendered here.
 */
export const SentrySection: React.FC<SentrySectionProps> = ({ lang, adminFetch, collapsed = false, onToggleCollapse }) => {
  const isAr = lang === 'ar';
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<SentryStatus | null>(null);
  const [busy, setBusy] = useState<'front' | 'back' | null>(null);
  const [result, setResult] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/diagnostics/sentry-status');
      if (res.status === 403) {
        setAllowed(false);
        return;
      }
      const data: unknown = await readJson(res);
      if (res.ok && isRecord(data) && data.ok === true) {
        setAllowed(true);
        setStatus({
          configured: data.configured === true,
          environment: str(data.environment, 'production'),
          release: typeof data.release === 'string' ? data.release : null,
        });
      } else {
        setAllowed(false);
      }
    } catch {
      setAllowed(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Not the owner (or unreachable): this section does not exist here.
  if (allowed === null || allowed === false) return null;

  const frontendTest = () => {
    setBusy('front');
    setResult('');
    try {
      captureFrontendError(new Error('Sentry admin frontend test (deliberate, owner-triggered)'));
      setResult(isAr ? 'تم إرسال خطأ تجريبي من الواجهة — ابحث عنه في Sentry.' : 'Frontend test error sent — look for it in Sentry.');
    } catch {
      setResult(isAr ? 'تعذر الإرسال' : 'Could not send');
    } finally {
      setBusy(null);
    }
  };

  const backendTest = async () => {
    setBusy('back');
    setResult('');
    try {
      const res = await adminFetch('/api/admin/diagnostics/sentry-test', { method: 'POST' });
      const data: unknown = await readJson(res);
      if (res.ok && isRecord(data) && data.ok === true) {
        const reqId = str(data.reqId, '');
        setResult(
          isAr
            ? `تم إرسال خطأ تجريبي من الخادم${reqId ? ` (reqId: ${reqId})` : ''} — ابحث عنه في Sentry.`
            : `Backend test error sent${reqId ? ` (reqId: ${reqId})` : ''} — look for it in Sentry.`
        );
      } else {
        setResult(isAr ? 'تعذر الإرسال' : 'Could not send');
      }
    } catch {
      setResult(isAr ? 'تعذر الاتصال' : 'Connection problem');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'مراقبة الأخطاء' : 'Error Monitoring'}
        subtitle={
          isAr
            ? 'تشخيص Sentry — يظهر للمالك فقط، ودخول العملاء لا يراه أبدًا.'
            : 'Sentry diagnostics — owner only, client logins never see this.'
        }
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-bold">
            <Activity size={13} />
            {status?.environment || 'production'}
          </span>
          <span
            className={`rounded-full border px-2.5 py-1 font-bold ${
              status?.configured
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-amber-500/10 border-amber-400/30 text-amber-300'
            }`}
          >
            {status?.configured
              ? isAr
                ? 'الخادم: مهيأ'
                : 'Backend: configured'
              : isAr
                ? 'الخادم: غير مهيأ'
                : 'Backend: not configured'}
          </span>
          {status?.release ? (
            <span dir="ltr" className="rounded-full border border-neutral-700 px-2.5 py-1 font-bold text-neutral-400 tabular-nums">
              {status.release}
            </span>
          ) : null}
        </div>
        {!status?.configured ? (
          <p className="text-[11px] text-neutral-500">
            {isAr
              ? 'ضع SENTRY_DSN في متغيرات بيئة Cloudflare ثم أعد النشر — بدونها لا يُرسل شيء.'
              : 'Set SENTRY_DSN in the Cloudflare environment variables and redeploy — without it nothing is sent.'}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={frontendTest}
            className="h-11 min-h-[44px] px-5 rounded-full bg-black border border-neutral-700 text-xs font-extrabold hover:border-[var(--primary)]/50 flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <FlaskConical size={15} />
            {busy === 'front' ? '…' : isAr ? 'اختبار الواجهة' : 'Test frontend'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void backendTest()}
            className="h-11 min-h-[44px] px-5 rounded-full bg-black border border-neutral-700 text-xs font-extrabold hover:border-[var(--primary)]/50 flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <FlaskConical size={15} />
            {busy === 'back' ? '…' : isAr ? 'اختبار الخادم' : 'Test backend'}
          </button>
        </div>
        {result ? (
          <p className="text-xs text-neutral-300" role="status">
            {result}
          </p>
        ) : null}
      </SettingsGroupBody>
    </div>
  );
};
