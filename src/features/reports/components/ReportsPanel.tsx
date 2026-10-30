import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, CalendarClock, Check, Clock, Download, FileText, Loader2, Mail, Send, ShieldCheck, TriangleAlert } from 'lucide-react';

export interface ReportSettings {
  enabled: boolean;
  email: string;
  /** true once the owner clicked the confirmation link we emailed */
  verified: boolean;
  language: 'en' | 'ar';
}

export interface MonthlyReportRow {
  month: string; // 'YYYY-MM'
  orders: number;
  revenue: number;
  avg: number;
  emailedAt?: string | null;
  emailStatus?: string | null; // 'sent' | 'pending' | 'failed' — failed is surfaced in the list
  csvAvailable: boolean;
  inProgress?: boolean; // the current month (generated on demand)
}

interface ReportsPanelProps {
  lang: 'en' | 'ar';
  currency: string;
  settings: ReportSettings;
  reports: MonthlyReportRow[];
  retention: { piiDays: number; orderMonths: number; reportMonths: number };
  sendTime: string; // '08:00'
  timezone: string; // 'Asia/Beirut'
  onSaveSettings: (s: { enabled: boolean; email: string; language: 'en' | 'ar' }) => Promise<{ ok: boolean; verificationSent?: boolean; error?: string }>;
  onResendVerification: () => Promise<void>;
  onSendTest: () => Promise<{ ok: boolean; error?: string }>;
  onDownload: (month: string) => void;
}

const STR = {
  en: {
    emailTitle: 'Monthly report by email', enable: 'Send me a monthly report', email: 'Report email',
    emailHint: 'We send a confirmation link first. Reports go only to a confirmed address.',
    language: 'Email language', verified: 'Confirmed', pending: 'Waiting for confirmation', resend: 'Resend link', notSet: 'No email yet',
    save: 'Save', saving: 'Saving…', saved: 'Saved', test: 'Send test email', testing: 'Sending…', testSent: 'Test sent',
    testErrRate: 'Too many test emails — wait up to an hour and try again.',
    testErrNoEmail: 'Set a report email first.',
    testErrNotVerified: 'Confirm your email first (open the link we sent).',
    testErrMail: 'Email service failed — try again later.',
    testErrGeneric: 'Sending failed — try again.',
    next: (d: string, m: string) => `Next report: ${d} at the scheduled time, covering ${m}.`,
    invalid: 'Please enter a valid email address.',
    sentConfirm: (e: string) => `Confirmation link sent to ${e}. Open it to start receiving reports.`,
    reportsTitle: 'Reports', thisMonth: 'This month so far', inProgress: 'In progress', emailed: (d: string) => `Emailed ${d}`, notEmailed: 'Not emailed', failed: 'Failed — will retry',
    orders: 'orders', avg: 'avg', csv: 'CSV', showOlder: (n: number) => `Show older (${n})`, noReports: 'Your first report will appear on the 1st of next month.',
    retTitle: 'Data retention', retNote: 'Nothing is deleted before its monthly report exists. Reports never include customer names, phones or addresses.',
    ret1: 'Customer details', ret1d: (n: number) => `Removed after ${n} days`,
    ret2: 'Order records (anonymous)', ret2d: (n: number) => `Kept ${n} months`,
    ret3: 'Monthly reports', ret3d: (n: number) => `Kept ${Math.round(n / 12)} years`,
  },
  ar: {
    emailTitle: 'التقرير الشهري بالبريد', enable: 'أرسل لي تقريراً شهرياً', email: 'بريد التقرير',
    emailHint: 'نرسل رابط تأكيد أولاً. لا تصل التقارير إلا لعنوان مؤكد.',
    language: 'لغة الرسالة', verified: 'مؤكد', pending: 'بانتظار التأكيد', resend: 'إعادة إرسال الرابط', notSet: 'لا يوجد بريد بعد',
    save: 'حفظ', saving: 'جارٍ الحفظ…', saved: 'تم الحفظ', test: 'إرسال رسالة تجريبية', testing: 'جارٍ الإرسال…', testSent: 'تم الإرسال',
    testErrRate: 'رسائل تجريبية كثيرة — انتظر حتى ساعة وحاول مجدداً.',
    testErrNoEmail: 'ضع بريد التقرير أولاً.',
    testErrNotVerified: 'أكّد بريدك أولاً (افتح الرابط المرسل).',
    testErrMail: 'خدمة البريد فشلت — حاول لاحقاً.',
    testErrGeneric: 'فشل الإرسال — حاول مجدداً.',
    next: (d: string, m: string) => `التقرير القادم: ${d} في الوقت المحدد، ويغطي ${m}.`,
    invalid: 'أدخل بريداً إلكترونياً صحيحاً.',
    sentConfirm: (e: string) => `أرسلنا رابط التأكيد إلى ${e}. افتحه لتبدأ باستلام التقارير.`,
    reportsTitle: 'التقارير', thisMonth: 'هذا الشهر حتى الآن', inProgress: 'قيد التجميع', emailed: (d: string) => `أُرسل ${d}`, notEmailed: 'لم يُرسل', failed: 'فشل — سنعيد المحاولة',
    orders: 'طلب', avg: 'متوسط', csv: 'CSV', showOlder: (n: number) => `عرض الأقدم (${n})`, noReports: 'سيظهر أول تقرير في أول الشهر القادم.',
    retTitle: 'الاحتفاظ بالبيانات', retNote: 'لا يُحذف شيء قبل إنشاء تقريره الشهري. ولا تحتوي التقارير على أسماء العملاء أو هواتفهم أو عناوينهم.',
    ret1: 'بيانات العملاء', ret1d: (n: number) => `تُحذف بعد ${n} يوماً`,
    ret2: 'سجلات الطلبات (بدون هوية)', ret2d: (n: number) => `تُحفظ ${n} شهراً`,
    ret3: 'التقارير الشهرية', ret3d: (n: number) => `تُحفظ ${Math.round(n / 12)} سنوات`,
  },
} as const;

const card = 'p-4 sm:p-5 rounded-2xl bg-neutral-900 border border-neutral-800';
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtCompact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : fmt(n));
const loc = (l: 'en' | 'ar') => (l === 'ar' ? 'ar-u-nu-latn' : 'en-US');
const monthName = (ym: string, l: 'en' | 'ar') => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(loc(l), { month: 'long', year: 'numeric' }); };
const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

const ReportsPanel: React.FC<ReportsPanelProps> = ({ lang, currency, settings, reports, retention, sendTime, timezone, onSaveSettings, onResendVerification, onSendTest, onDownload }) => {
  const t = STR[lang];
  const isAr = lang === 'ar';
  // Owner decision: animations always run (never honor reduced-motion).
  const reduce = false;
  const [enabled, setEnabled] = useState(settings.enabled);
  const [email, setEmail] = useState(settings.email);
  const [mailLang, setMailLang] = useState<'en' | 'ar'>(settings.language);
  const [busy, setBusy] = useState<'save' | 'test' | 'resend' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [limit, setLimit] = useState(6);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const dirty = enabled !== settings.enabled || email.trim() !== settings.email || mailLang !== settings.language;
  const emailOk = validEmail(email);
  const showErr = email.trim().length > 0 && !emailOk;

  const flash = (m: { kind: 'ok' | 'err'; text: string }) => { setMsg(m); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(null), 5200); };

  const nextInfo = useMemo(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prev = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return t.next(`${first.toLocaleDateString(loc(lang), { day: 'numeric', month: 'long' })}, ${sendTime} (${timezone})`, monthName(prev, lang));
  }, [lang, sendTime, timezone, t]);

  const rise = (delay: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  const save = async () => {
    if (enabled && !emailOk) { flash({ kind: 'err', text: t.invalid }); return; }
    setBusy('save');
    const r = await onSaveSettings({ enabled, email: email.trim(), language: mailLang });
    setBusy(null);
    if (!r.ok) flash({ kind: 'err', text: r.error ?? 'Error' });
    else flash({ kind: 'ok', text: r.verificationSent ? t.sentConfirm(email.trim()) : t.saved });
  };

  const resend = async () => {
    setBusy('resend');
    await onResendVerification();
    setBusy(null);
    flash({ kind: 'ok', text: t.sentConfirm(settings.email) });
  };

  const sendTest = async () => {
    setBusy('test');
    const r = await onSendTest();
    setBusy(null);
    if (r.ok) {
      flash({ kind: 'ok', text: t.testSent });
      return;
    }
    const text = r.error === 'rate_limited' ? t.testErrRate
      : r.error === 'no_email' ? t.testErrNoEmail
      : r.error === 'not_verified' ? t.testErrNotVerified
      : r.error === 'mail_unconfigured' || r.error === 'mail_failed' ? t.testErrMail
      : t.testErrGeneric;
    flash({ kind: 'err', text });
  };

  const status = !settings.email ? 'none' : settings.verified ? 'verified' : 'pending';
  const shown = reports.slice(0, limit);

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Email settings */}
      <motion.div {...rise(0)} className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 className={`text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`}>{t.emailTitle}</h2>
          <button type="button" role="switch" aria-checked={enabled} aria-label={t.enable} onClick={() => setEnabled((v) => !v)}
            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${enabled ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}>
            <motion.span layout={!reduce} transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow ${enabled ? 'end-1' : 'start-1'}`} />
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-400">{t.enable}</p>

        <div className={`mt-4 space-y-4 transition-opacity ${enabled ? 'opacity-100' : 'opacity-50'}`}>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label htmlFor="report-email" className="text-xs font-semibold text-neutral-400">{t.email}</label>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                status === 'verified' ? 'bg-green-500/15 text-green-400 border-green-500/30' : status === 'pending' ? 'bg-amber-500/10 text-amber-300 border-amber-400/30' : 'bg-neutral-800 text-neutral-400 border-neutral-700'}`}>
                {status === 'verified' && <ShieldCheck size={11} />}{status === 'pending' && <Clock size={11} />}
                {status === 'verified' ? t.verified : status === 'pending' ? t.pending : t.notSet}
              </span>
            </div>
            <div className="relative">
              <Mail size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden="true" />
              <input id="report-email" type="email" inputMode="email" autoComplete="email" dir="ltr" value={email} disabled={!enabled}
                onChange={(e) => setEmail(e.target.value)} placeholder="owner@yourrestaurant.com" aria-invalid={showErr}
                className={`w-full h-12 rounded-xl bg-black border ps-10 pe-3 text-sm text-white placeholder:text-neutral-600 outline-none transition-[border-color,box-shadow] focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/15 text-left ${showErr ? 'border-red-400/70' : 'border-neutral-700'}`} />
            </div>
            {showErr ? <p className="mt-1.5 text-xs text-red-400">{t.invalid}</p> : <p className="mt-1.5 text-[11px] text-neutral-500">{t.emailHint}</p>}
            {status === 'pending' && !dirty && (
              <button type="button" disabled={busy === 'resend'} onClick={() => void resend()}
                className="mt-2 text-xs font-bold text-[var(--primary)] hover:underline underline-offset-4">{t.resend}</button>
            )}
          </div>

          <div>
            <span className="block text-xs font-semibold text-neutral-400 mb-1.5">{t.language}</span>
            <div className="inline-flex p-1 rounded-full bg-black border border-neutral-800">
              {(['en', 'ar'] as const).map((c) => (
                <button key={c} type="button" onClick={() => setMailLang(c)} aria-pressed={mailLang === c} disabled={!enabled}
                  className={`relative px-4 h-8 rounded-full text-xs font-bold transition-colors ${mailLang === c ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}>
                  {mailLang === c && <motion.span layoutId="rep-lang" className="absolute inset-0 rounded-full bg-[var(--primary)]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span className="relative z-10">{c === 'en' ? 'English' : 'العربية'}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="flex items-start gap-2 text-xs text-neutral-400"><CalendarClock size={15} className="mt-px shrink-0 text-[var(--primary)]" />{nextInfo}</p>

          <div className="flex flex-wrap gap-2.5">
            <button type="button" onClick={() => void save()} disabled={!dirty || busy === 'save'}
              className="btn-tactile h-11 px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
              {busy === 'save' ? <><Loader2 size={16} className="animate-spin" />{t.saving}</> : <><Check size={16} strokeWidth={3} />{t.save}</>}
            </button>
            <button type="button" disabled={status !== 'verified' || dirty || busy === 'test'}
              onClick={() => void sendTest()}
              className="btn-tactile h-11 px-5 rounded-full border border-neutral-700 text-neutral-200 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
              {busy === 'test' ? <><Loader2 size={16} className="animate-spin" />{t.testing}</> : <><Send size={15} className="text-[var(--primary)]" />{t.test}</>}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {msg && (
              <motion.div role="status" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-xs leading-relaxed ${msg.kind === 'ok' ? 'border-green-500/30 bg-green-500/10 text-green-300' : 'border-red-400/30 bg-red-500/10 text-red-200'}`}>
                  {msg.kind === 'ok' ? <Check size={15} className="mt-px shrink-0" /> : <TriangleAlert size={15} className="mt-px shrink-0" />}<span>{msg.text}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Reports list */}
      <motion.div {...rise(0.08)} className={card}>
        <h2 className={`text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`}>{t.reportsTitle}</h2>
        <div className="mt-3 space-y-2">
          {reports.length === 0 && <p className="text-xs text-neutral-500 py-4">{t.noReports}</p>}
          {shown.map((r, i) => (
            <motion.div key={r.month} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.04, duration: 0.4 }}
              className={`rounded-xl border p-3 flex items-center gap-3 ${r.inProgress ? 'border-[var(--primary)]/40 bg-[var(--primary)]/[0.05]' : 'border-neutral-800 bg-black/40'}`}>
              <span className="shrink-0 w-10 h-10 rounded-xl bg-black border border-neutral-800 text-[var(--primary)] flex items-center justify-center"><FileText size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 flex-wrap">
                  <b className="text-sm">{r.inProgress ? t.thisMonth : monthName(r.month, lang)}</b>
                  {r.inProgress ? <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[var(--primary)] text-[#0A0A0A]">{t.inProgress}</span>
                    : r.emailedAt ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-400"><Check size={11} strokeWidth={3} />{t.emailed(new Date(r.emailedAt).toLocaleDateString(loc(lang), { day: 'numeric', month: 'short' }))}</span>
                    : r.emailStatus === 'failed' ? <span className="text-[10px] font-bold text-red-400">{t.failed}</span>
                    : <span className="text-[10px] font-bold text-neutral-500">{t.notEmailed}</span>}
                </span>
                <span className="block text-[11px] text-neutral-400 mt-0.5 tabular-nums" dir={isAr ? 'rtl' : 'ltr'}>
                  {fmt(r.orders)} {t.orders} · {fmtCompact(r.revenue)} {currency} · {t.avg} {fmtCompact(r.avg)}
                </span>
              </span>
              <button type="button" disabled={!r.csvAvailable} onClick={() => onDownload(r.month)} aria-label={`${t.csv} ${monthName(r.month, lang)}`}
                className="btn-tactile shrink-0 h-10 px-3.5 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold inline-flex items-center gap-1.5 hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-40">
                <Download size={14} />{t.csv}
              </button>
            </motion.div>
          ))}
        </div>
        {reports.length > limit && (
          <button type="button" onClick={() => setLimit((l) => l + 6)} className="btn-tactile mt-3 w-full h-10 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold hover:bg-white/5">{t.showOlder(reports.length - limit)}</button>
        )}
      </motion.div>

      {/* Retention */}
      <motion.div {...rise(0.16)} className={card}>
        <h2 className={`text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`}>{t.retTitle}</h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: Clock, a: t.ret1, b: t.ret1d(retention.piiDays) },
            { icon: Archive, a: t.ret2, b: t.ret2d(retention.orderMonths) },
            { icon: FileText, a: t.ret3, b: t.ret3d(retention.reportMonths) },
          ].map((s, i) => (
            <div key={i} className="flex sm:flex-col items-center sm:items-start gap-3 rounded-xl bg-black/40 border border-neutral-800 p-3">
              <span className="w-9 h-9 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0"><s.icon size={17} /></span>
              <span><span className="block text-[13px] font-bold">{s.a}</span><span className="block text-xs text-neutral-400 mt-0.5">{s.b}</span></span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">{t.retNote}</p>
      </motion.div>
    </div>
  );
};

export default ReportsPanel;
