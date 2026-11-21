import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  BadgeCheck,
  Check,
  Clock,
  Copy,
  Loader2,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useBodyScrollLock } from '@/src/hooks/useBodyScrollLock';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useNow } from '@/src/hooks/useNow';
import { formatMMSS } from '@/src/utils/countdown';
import {
  buildPhoneVerificationMessage,
  buildPhoneVerificationWhatsAppUrl,
} from '@/src/utils/phoneVerification';
import { PHONE_VERIFY_STR } from '../strings';
import type { PhoneVerificationState } from '../hooks/usePhoneVerification';

interface PhoneVerificationSheetProps {
  open: boolean;
  onClose: () => void;
  /** Normalized international digits (no plus) — the number being verified. */
  phone: string | null;
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** State from usePhoneVerification(phone, open && …). */
  verification: PhoneVerificationState;
  /** Restaurant WhatsApp number from menu settings. */
  whatsappNumber?: string;
  /** Restaurant display name (unused in the message, kept for the header). */
  storeName?: string;
  /** Called once when the number becomes verified (before the sheet closes). */
  onVerified?: () => void;
}

function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

export function PhoneVerificationSheet({
  open,
  onClose,
  phone,
  lang,
  darkMode,
  verification,
  whatsappNumber,
  storeName,
  onVerified,
}: PhoneVerificationSheetProps) {
  const t = PHONE_VERIFY_STR[lang];
  const isAr = lang === 'ar';
  const [copied, setCopied] = useState(false);
  const [showSmsPanel, setShowSmsPanel] = useState(false);
  const [smsCode, setSmsCode] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef<string | null>(null);
  const onVerifiedRef = useRef(onVerified);
  const onCloseRef = useRef(onClose);
  onVerifiedRef.current = onVerified;
  onCloseRef.current = onClose;

  useBodyScrollLock(open, 'phone-verification');
  useFocusTrap(open, panelRef, onClose);
  const now = useNow(open && verification.phase === 'pending', 1000);

  const active = verification.active;
  const code = active && typeof active.code === 'string' && /^[0-9]{6}$/.test(active.code)
    ? active.code
    : null;
  const expiresMs = active ? Date.parse(active.expiresAt) : NaN;
  const leftMs = Number.isFinite(expiresMs) ? Math.max(0, expiresMs - now) : 0;
  const message = code && active
    ? active.message || buildPhoneVerificationMessage({ code, reference: active.reference, lang })
    : '';
  const whatsappUrl = message
    ? active?.whatsappUrl || buildPhoneVerificationWhatsAppUrl(whatsappNumber, message)
    : null;
  const destinationNumber = whatsappUrl
    ? (whatsappUrl.match(/wa\.me\/(\d+)/) || [])[1] || null
    : null;

  // One automatic request per open + number. A phase that falls back to
  // 'unverified' after a 10-minute expiry must NOT mint codes in a loop.
  useEffect(() => {
    if (!open) {
      autoRef.current = null;
      return;
    }
    if (!phone) return;
    if (autoRef.current === phone) return;
    if (verification.phase !== 'unverified') return;
    autoRef.current = phone;
    void verification.request(lang);
  }, [open, phone, verification, lang]);

  // Success: notify the caller once, then close after a beat.
  useEffect(() => {
    if (!open || verification.phase !== 'verified') return;
    onVerifiedRef.current?.();
    const id = window.setTimeout(() => onCloseRef.current(), 1500);
    return () => window.clearTimeout(id);
  }, [open, verification.phase]);

  // A new code/number starts with the WhatsApp path; the SMS fallback is
  // revealed manually (Need help?) or after 60 seconds without completing.
  useEffect(() => {
    setShowSmsPanel(false);
    setSmsCode('');
  }, [active?.reference, phone, open]);

  useEffect(() => {
    if (!open || verification.phase !== 'pending' || active?.method === 'sms') return;
    const id = window.setTimeout(() => setShowSmsPanel(true), 60_000);
    return () => window.clearTimeout(id);
  }, [open, verification.phase, active?.reference, active?.method]);

  const onCopy = () => {
    if (!code) return;
    void copyText(code).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  const retry = () => {
    if (verification.phase === 'unverified') void verification.request(lang);
    else void verification.refresh();
  };

  const verified = verification.phase === 'verified';
  const errorText = verification.error === 'rate_limited'
    ? t.errorRate
    : verification.error === 'cooldown'
      ? (active?.method === 'sms' ? t.smsCooldown : t.errorCooldown)
      : verification.error === 'phone_invalid'
        ? t.errorPhone
        : verification.error === 'sms_failed'
          ? t.smsErrorFailed
          : verification.error === 'sms_unavailable'
            ? t.smsErrorUnavailable
            : verification.error === 'sms_rate_limited'
              ? t.smsErrorTooMany
              : verification.error
                ? t.errorUnavailable
                : '';
  const smsErrorMessage = verification.smsError === 'code_invalid'
    ? t.smsErrorInvalid
    : verification.smsError === 'too_many_attempts'
      ? t.smsErrorTooMany
      : verification.smsError === 'no_pending' || verification.smsError === 'expired'
        ? t.smsErrorExpired
        : verification.smsError === 'sms_unavailable'
          ? t.smsErrorUnavailable
          : verification.smsError === 'sms_verify_failed'
            ? t.smsErrorFailed
            : '';

  const panelClass = darkMode
    ? 'bg-[#101010] border-neutral-800 text-white'
    : 'bg-white border-neutral-200 text-[#0A0A0A]';
  const muted = darkMode ? 'text-neutral-400' : 'text-neutral-500';
  const subtleCard = darkMode
    ? 'bg-[#181818] border-neutral-800'
    : 'bg-neutral-50 border-neutral-200';
  const primaryBtn =
    'btn-tactile inline-flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl px-5 text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--primary)]';

  const smsFallback = active?.method === 'sms' ? null : (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setShowSmsPanel((visible) => !visible)}
        className={`mx-auto flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[10.5px] font-extrabold underline underline-offset-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
          darkMode ? 'text-neutral-400 hover:text-neutral-200' : 'text-neutral-500 hover:text-neutral-800'
        }`}
      >
        <MessageSquare size={12} aria-hidden="true" />
        {t.needHelp}
      </button>
      {showSmsPanel && (
        <div className={`rounded-2xl border p-4 ${subtleCard}`}>
          <p className="text-[11px] font-extrabold">{t.smsTitle}</p>
          <p className={`mt-1 text-[10.5px] leading-relaxed ${muted}`}>{t.smsBody}</p>
          <button
            type="button"
            onClick={() => void verification.request(lang, 'sms')}
            disabled={verification.requesting}
            className={`${primaryBtn} mt-3 bg-[var(--primary)] text-black hover:brightness-95 disabled:opacity-60`}
          >
            {verification.requesting ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <MessageSquare size={16} aria-hidden="true" />
            )}
            {verification.requesting ? t.sendingSms : t.sendSms}
          </button>
          <p className={`mt-2 text-center text-[9.5px] leading-relaxed ${muted}`}>{t.smsHint}</p>
        </div>
      )}
    </div>
  );

  const smsActivePanel = active?.method === 'sms' ? (
    <div className={`rounded-2xl border p-4 ${subtleCard}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-[10px] font-extrabold uppercase tracking-[0.15em] ${muted}`}>
          {t.smsSent}
        </span>
        <b className="text-sm font-black tabular-nums" dir="ltr">+{active.phone}</b>
      </div>

      <label htmlFor="sms-code" className={`mt-3 block text-[10.5px] font-bold ${muted}`}>
        {t.smsCodeLabel}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="sms-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={smsCode}
          onChange={(event) => setSmsCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
          dir="ltr"
          placeholder="••••••"
          className={`min-w-0 flex-1 h-12 rounded-xl border text-center text-lg font-black tracking-[0.28em] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${
            darkMode
              ? 'bg-[#101010] border-neutral-700 text-white placeholder-neutral-500'
              : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400'
          }`}
        />
        <button
          type="button"
          onClick={() => void verification.verifySms(smsCode)}
          disabled={verification.verifying || smsCode.length < 4}
          className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 text-[11px] font-extrabold text-black transition-opacity hover:brightness-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          {verification.verifying ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
          {verification.verifying ? t.verifyingCode : t.verifyCode}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold ${leftMs <= 0 ? 'text-red-500' : muted}`}>
          <Clock size={12} aria-hidden="true" />
          {leftMs <= 0 ? t.expired : `${t.smsExpires} ${formatMMSS(leftMs)}`}
        </span>
        <button
          type="button"
          onClick={() => void verification.request(lang, 'sms')}
          disabled={verification.requesting}
          className={`inline-flex min-h-[32px] items-center gap-1 text-[10.5px] font-extrabold underline underline-offset-2 disabled:opacity-60 ${
            darkMode ? 'text-neutral-300' : 'text-neutral-600'
          }`}
        >
          <RefreshCw size={11} className={verification.requesting ? 'animate-spin' : ''} aria-hidden="true" />
          {verification.requesting ? t.sendingSms : t.smsResend}
        </button>
      </div>

      {smsErrorMessage && (
        <p role="alert" className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10.5px] font-bold text-red-500">
          {smsErrorMessage}
        </p>
      )}
      <p className={`mt-2 text-center text-[9.5px] leading-relaxed ${muted}`}>{t.smsHint}</p>
    </div>
  ) : null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center md:items-center md:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            aria-hidden="true"
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="phone-verify-title"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 28 }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            className={`relative w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl border md:rounded-3xl shadow-2xl ${panelClass}`}
            dir={isAr ? 'rtl' : 'ltr'}
          >
            <div className={`sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-5 py-4 backdrop-blur-md ${darkMode ? 'border-neutral-800 bg-[#101010]/95' : 'border-neutral-200 bg-white/95'}`}>
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[var(--primary)]">
                  <ShieldCheck size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 id="phone-verify-title" className="text-base font-extrabold leading-tight">
                    {t.title}
                  </h2>
                  {storeName ? (
                    <p className={`mt-0.5 truncate text-[11px] font-semibold ${muted}`}>{storeName}</p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t.close}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                  darkMode ? 'text-neutral-300 hover:bg-white/10' : 'text-neutral-600 hover:bg-black/5'
                }`}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              {verified ? (
                <div className="py-4 text-center" role="status" aria-live="polite">
                  <motion.span
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 20 }}
                    className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500"
                  >
                    <BadgeCheck size={34} aria-hidden="true" />
                  </motion.span>
                  <h3 className="mt-4 text-lg font-black">{t.verifiedTitle}</h3>
                  <p className={`mt-1 text-sm ${muted}`}>{t.verifiedBody}</p>
                  <button
                    type="button"
                    onClick={onClose}
                    className={`${primaryBtn} mt-5 bg-[var(--primary)] text-black hover:brightness-95`}
                  >
                    {t.done}
                  </button>
                </div>
              ) : (
                <>
                  <p className={`text-sm leading-relaxed ${muted}`}>{t.subtitle}</p>

                  <div className="grid grid-cols-3 gap-2">
                    {[t.stepSend, t.stepWhatsApp, t.stepApprove].map((step, index) => (
                      <div
                        key={step}
                        className={`rounded-xl border px-2 py-2 text-center text-[9.5px] font-bold leading-snug ${subtleCard} ${
                          index === 1 && code ? 'border-[#25D366]/50 text-[#1f9e51]' : muted
                        }`}
                      >
                        {step}
                      </div>
                    ))}
                  </div>

                  <div className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${subtleCard}`}>
                    <span className={`text-[11px] font-bold ${muted}`}>{t.numberLabel}</span>
                    <b className="text-sm font-black tabular-nums" dir="ltr">
                      +{phone || '—'}
                    </b>
                  </div>

                  {destinationNumber && (
                    <p className={`text-center text-[10.5px] font-bold ${muted}`}>
                      {t.sendingTo}{' '}
                      <b className="tabular-nums" dir="ltr">+{destinationNumber}</b>
                    </p>
                  )}

                  {active?.method === 'sms' ? (
                    smsActivePanel
                  ) : code && active ? (
                    <>
                      <div className={`rounded-2xl border-2 border-dashed p-4 text-center ${
                        darkMode ? 'border-[var(--primary)]/40 bg-[var(--primary)]/5' : 'border-[#c9a800]/50 bg-[#fffbea]'
                      }`}>
                        <p className={`text-[10px] font-extrabold uppercase tracking-[0.2em] ${muted}`}>
                          {t.codeLabel}
                        </p>
                        <p
                          className="mt-2 select-all text-[2.35rem] font-black leading-none tracking-[0.28em] tabular-nums"
                          dir="ltr"
                          aria-label={code.split('').join(' ')}
                        >
                          {code}
                        </p>
                        <button
                          type="button"
                          onClick={onCopy}
                          className={`mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-[11px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                            copied
                              ? 'border-emerald-500/50 text-emerald-500'
                              : darkMode
                                ? 'border-neutral-700 text-neutral-200 hover:bg-white/5'
                                : 'border-neutral-300 text-neutral-700 hover:bg-black/5'
                          }`}
                        >
                          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                          {copied ? t.copied : t.copy}
                        </button>
                      </div>

                      <div className={`flex items-center justify-center gap-1.5 text-[11px] font-bold ${leftMs <= 0 ? 'text-red-500' : muted}`}>
                        <Clock size={13} aria-hidden="true" />
                        <span>{leftMs <= 0 ? t.expired : `${t.expiresIn} ${formatMMSS(leftMs)}`}</span>
                      </div>

                      {whatsappUrl ? (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${primaryBtn} bg-[#25D366] text-[#04240f] hover:brightness-95 focus-visible:ring-[#25D366]`}
                        >
                          <MessageCircle size={19} aria-hidden="true" />
                          {t.sendWhatsApp}
                        </a>
                      ) : (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-[11px] font-bold text-amber-600 dark:text-amber-300">
                          {t.noWhatsApp}
                        </div>
                      )}
                      <p className={`text-center text-[10.5px] leading-relaxed ${muted}`}>{t.sendHint}</p>

                      {smsFallback}

                      {verification.phase === 'pending' && (
                        <div className="space-y-2">
                          <p className={`flex items-center justify-center gap-2 text-[11px] font-bold ${muted}`} role="status">
                            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                            {t.waiting}
                          </p>
                          <button
                            type="button"
                            onClick={() => void verification.request(lang)}
                            disabled={verification.requesting}
                            className={`mx-auto flex min-h-[38px] items-center gap-1.5 rounded-full px-3 text-[11px] font-extrabold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-60 ${
                              darkMode ? 'text-neutral-300' : 'text-neutral-600'
                            }`}
                          >
                            <RefreshCw size={12} className={verification.requesting ? 'animate-spin' : ''} aria-hidden="true" />
                            {t.resend}
                          </button>
                        </div>
                      )}
                    </>
                  ) : verification.phase === 'checking' && !active ? (
                    <div className={`rounded-2xl border px-4 py-6 text-center ${subtleCard}`}>
                      <Loader2 size={24} className={`mx-auto animate-spin ${muted}`} aria-hidden="true" />
                      <p className={`mt-2 text-[11px] font-bold ${muted}`}>{t.checking}</p>
                      {smsFallback}
                    </div>
                  ) : (
                    <div className={`rounded-2xl border px-4 py-5 text-center ${subtleCard}`}>
                      {active ? (
                        <>
                          <Clock size={22} className={`mx-auto ${muted}`} aria-hidden="true" />
                          <p className={`mt-2 text-[11px] font-semibold leading-relaxed ${muted}`}>
                            {t.waitingNoCode}
                          </p>
                          <p className={`mt-2 text-[10px] font-bold ${muted}`}>
                            {leftMs > 0 ? `${t.expiresIn} ${formatMMSS(leftMs)}` : t.expired}
                          </p>
                        </>
                      ) : (
                        <ShieldCheck size={24} className={`mx-auto ${muted}`} aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        onClick={() => void verification.request(lang)}
                        disabled={verification.requesting || !phone}
                        className={`${primaryBtn} mt-3 bg-[var(--primary)] text-black hover:brightness-95 disabled:opacity-60`}
                      >
                        {verification.requesting ? (
                          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <MessageCircle size={16} aria-hidden="true" />
                        )}
                        {verification.requesting ? t.gettingCode : active ? t.resend : t.getCode}
                      </button>
                      {smsFallback}
                    </div>
                  )}

                  {errorText && (
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold leading-relaxed text-red-500"
                    >
                      <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{errorText}</span>
                    </p>
                  )}

                  {verification.phase === 'error' && !active && (
                    <button
                      type="button"
                      onClick={retry}
                      className={`${primaryBtn} border ${darkMode ? 'border-neutral-700 text-neutral-200 hover:bg-white/5' : 'border-neutral-300 text-neutral-700 hover:bg-black/5'}`}
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                      {t.getCode}
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
