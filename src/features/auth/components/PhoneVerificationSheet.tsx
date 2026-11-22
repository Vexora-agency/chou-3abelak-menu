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
    const id = window.setTimeout(() => onCloseRef.current(), 2000);
    return () => window.clearTimeout(id);
  }, [open, verification.phase]);

  // A new code/number starts with the WhatsApp path; the fixed footer keeps
  // the SMS option visible without a timer.
  useEffect(() => {
    setSmsCode('');
  }, [active?.reference, phone, open]);

  const onCopy = () => {
    if (!code) return;
    void copyText(code).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  const retry = () => {
    // A status read is the only thing worth repeating while checking; every
    // other no-code state asks the server for a fresh code.
    if (verification.phase === 'checking') void verification.refresh();
    else void verification.request(lang);
  };

  const verified = verification.phase === 'verified';
  const phoneTaken = verification.error === 'phone_linked_other_account';
  const errorText = verification.error === 'rate_limited'
    ? t.errorRate
    : verification.error === 'cooldown'
      ? (active?.method === 'sms' ? t.smsCooldown : t.errorCooldown)
      : verification.error === 'phone_invalid'
        ? t.errorPhone
        : verification.error === 'phone_linked_other_account'
          ? t.errorPhoneLinked
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
        : verification.smsError === 'phone_changed'
          ? t.smsErrorPhoneChanged
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
  const footerPrimary =
    'btn-tactile inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-5 text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--primary)] disabled:opacity-55';
  const footerSecondary =
    'btn-tactile mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border px-4 text-[11.5px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-55';
  const secondaryTone = darkMode
    ? 'border-neutral-700 text-neutral-200 hover:border-[var(--primary)]/50 hover:bg-white/5'
    : 'border-neutral-300 text-neutral-700 hover:border-[#0A0A0A] hover:bg-black/5';
  const inputTone = darkMode
    ? 'bg-[#101010] border-neutral-700 text-white placeholder-neutral-500'
    : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-400';

  const smsPanel = active?.method === 'sms' ? (
    <div className={`rounded-2xl border p-4 ${subtleCard}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-[9px] font-extrabold uppercase tracking-[0.18em] ${muted}`}>
          {t.smsSent}
        </span>
        <b className="text-[12px] font-black tabular-nums" dir="ltr">+{active.phone}</b>
      </div>

      <label htmlFor="sms-code" className={`mt-3 block text-[10.5px] font-bold ${muted}`}>
        {t.smsCodeLabel}
      </label>
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
        aria-invalid={smsErrorMessage ? true : undefined}
        aria-describedby={smsErrorMessage ? 'sms-code-error' : undefined}
        className={`mt-1.5 h-12 w-full rounded-xl border text-center text-lg font-black tracking-[0.3em] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${inputTone}`}
      />

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold ${leftMs <= 0 ? 'text-red-500' : muted}`}>
          <Clock size={12} aria-hidden="true" />
          {leftMs <= 0 ? t.expired : `${t.smsExpires} ${formatMMSS(leftMs)}`}
        </span>
        <button
          type="button"
          onClick={() => void verification.request(lang, 'sms')}
          disabled={verification.requesting}
          className={`inline-flex min-h-[30px] items-center gap-1 text-[10.5px] font-extrabold underline underline-offset-2 disabled:opacity-60 ${
            darkMode ? 'text-neutral-300' : 'text-neutral-600'
          }`}
        >
          <RefreshCw size={11} className={verification.requesting ? 'animate-spin' : ''} aria-hidden="true" />
          {verification.requesting ? t.sendingSms : t.smsResend}
        </button>
      </div>

      {smsErrorMessage && (
        <p id="sms-code-error" role="alert" className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10.5px] font-bold text-red-500">
          {smsErrorMessage}
        </p>
      )}
    </div>
  ) : null;

  const stepLabels = active?.method === 'sms'
    ? [t.stepSendSms, t.stepSms, t.stepApprove]
    : [t.stepSend, t.stepWhatsApp, t.stepApprove];
  const stepStateFor = (index: number): 'done' | 'current' | 'pending' => {
    if (active) return index === 0 ? 'done' : index === 1 ? 'current' : 'pending';
    return index === 0 ? 'current' : 'pending';
  };

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
            aria-describedby={verified || phoneTaken ? undefined : 'phone-verify-subtitle'}
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 28 }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            className={`relative flex max-h-[92dvh] w-full max-w-[430px] flex-col overflow-hidden rounded-t-[28px] border border-t-[3px] border-t-[var(--primary)] shadow-2xl md:max-h-[min(88dvh,760px)] md:rounded-[28px] ${
              darkMode ? 'border-neutral-800 bg-[#101010] text-white' : 'border-neutral-200 bg-white text-[#0A0A0A]'
            }`}
            dir={isAr ? 'rtl' : 'ltr'}
          >
            <div className="flex shrink-0 justify-center pt-2.5 md:hidden" aria-hidden="true">
              <span className={`h-1.5 w-11 rounded-full ${darkMode ? 'bg-neutral-700' : 'bg-neutral-300'}`} />
            </div>

            <div className={`flex shrink-0 items-start justify-between gap-3 border-b px-5 pb-3 pt-2 md:pt-4 ${darkMode ? 'border-neutral-800' : 'border-neutral-200'}`}>
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)]/15 text-[var(--primary)]">
                  <ShieldCheck size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 id="phone-verify-title" className="text-[15px] font-extrabold leading-tight">
                    {t.title}
                  </h2>
                  {storeName ? (
                    <p className={`mt-0.5 truncate text-[10.5px] font-semibold ${muted}`}>{storeName}</p>
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

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-3.5">
              {verified ? (
                <div className="py-6 text-center" role="status" aria-live="polite">
                  <motion.span
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 20 }}
                    className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500"
                  >
                    <BadgeCheck size={34} aria-hidden="true" />
                  </motion.span>
                  <h3 className="mt-4 text-lg font-black">{t.verifiedTitle}</h3>
                  <p className={`mx-auto mt-1 max-w-[30ch] text-sm leading-relaxed ${muted}`}>{t.verifiedBody}</p>
                </div>
              ) : phoneTaken ? (
                <div className="space-y-4">
                  <div className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 ${subtleCard}`}>
                    <span className={`text-[10.5px] font-bold ${muted}`}>{t.numberLabel}</span>
                    <b className="text-[13px] font-black tabular-nums" dir="ltr">+{phone || '—'}</b>
                  </div>
                  <div className={`rounded-2xl border px-4 py-5 text-center ${subtleCard}`}>
                    <ShieldCheck size={24} className={`mx-auto ${muted}`} aria-hidden="true" />
                    <p role="alert" className={`mt-2 text-[11px] font-bold leading-relaxed ${muted}`}>
                      {t.errorPhoneLinked}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p id="phone-verify-subtitle" className={`text-[12.5px] leading-relaxed ${muted}`}>
                    {active?.method === 'sms' ? t.subtitleSms : t.subtitle}
                  </p>

                  <div className="space-y-2">
                    <div className="flex gap-1.5" aria-hidden="true">
                      {stepLabels.map((step, index) => {
                        const state = stepStateFor(index);
                        return (
                          <span
                            key={`bar-${step}`}
                            className={`h-1 flex-1 rounded-full ${
                              state === 'done'
                                ? 'bg-emerald-500'
                                : state === 'current'
                                  ? 'bg-[var(--primary)]'
                                  : darkMode ? 'bg-neutral-800' : 'bg-neutral-200'
                            }`}
                          />
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {stepLabels.map((step, index) => {
                        const state = stepStateFor(index);
                        const tone = state === 'done'
                          ? 'text-emerald-500'
                          : state === 'current'
                            ? 'text-[var(--primary)]'
                            : muted;
                        return (
                          <div
                            key={step}
                            aria-current={state === 'current' ? 'step' : undefined}
                            className="flex flex-col items-center gap-1 text-center"
                          >
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-black ${
                                state === 'done'
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                                  : state === 'current'
                                    ? 'border-[var(--primary)]/60 bg-[var(--primary)]/10 text-[var(--primary)]'
                                    : `${subtleCard} ${muted}`
                              }`}
                            >
                              {state === 'done' ? <Check size={10} strokeWidth={3} aria-hidden="true" /> : index + 1}
                            </span>
                            <span className={`text-[9px] font-bold leading-tight ${tone}`}>{step}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 ${subtleCard}`}>
                    <span className={`text-[10.5px] font-bold ${muted}`}>{t.numberLabel}</span>
                    <b className="text-[13px] font-black tabular-nums" dir="ltr">+{phone || '—'}</b>
                  </div>

                  {active?.method === 'sms' ? (
                    smsPanel
                  ) : code && active ? (
                    <>
                      <div className={`relative overflow-hidden rounded-2xl border p-3.5 text-center ${
                        darkMode
                          ? 'border-[var(--primary)]/35 bg-[var(--primary)]/[0.06]'
                          : 'border-[#c9a800]/45 bg-[#fffbea]'
                      }`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[9px] font-extrabold uppercase tracking-[0.22em] ${muted}`}>
                            {t.codeLabel}
                          </span>
                          <button
                            type="button"
                            onClick={onCopy}
                            className={`inline-flex min-h-[30px] items-center gap-1 rounded-full border px-2.5 text-[9.5px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                              copied
                                ? 'border-emerald-500/50 text-emerald-500'
                                : darkMode
                                  ? 'border-neutral-700 text-neutral-200 hover:bg-white/5'
                                  : 'border-neutral-300 text-neutral-700 hover:bg-black/5'
                            }`}
                          >
                            {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
                            {copied ? t.copied : t.copy}
                          </button>
                        </div>
                        <p
                          className="mt-1.5 select-all text-[2.35rem] font-black leading-none tracking-[0.28em] tabular-nums"
                          dir="ltr"
                          aria-label={code.split('').join(' ')}
                        >
                          {code}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                              leftMs <= 0 ? 'border-red-500/30 bg-red-500/10 text-red-500' : `${subtleCard} ${muted}`
                            }`}
                          >
                            <Clock size={11} aria-hidden="true" />
                            {leftMs <= 0 ? t.expired : `${t.expiresIn} ${formatMMSS(leftMs)}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => void verification.refresh()}
                            disabled={verification.requesting}
                            className={`inline-flex min-h-[30px] items-center gap-1 text-[10px] font-extrabold underline underline-offset-2 disabled:opacity-60 ${muted}`}
                          >
                            <RefreshCw size={11} aria-hidden="true" />
                            {t.checkAgain}
                          </button>
                        </div>
                      </div>

                      {verification.phase === 'pending' && (
                        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                          <p className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold ${muted}`} role="status">
                            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                            {t.waiting}
                          </p>
                          <button
                            type="button"
                            onClick={() => void verification.request(lang)}
                            disabled={verification.requesting}
                            className={`inline-flex min-h-[30px] items-center gap-1 text-[10.5px] font-extrabold underline underline-offset-2 disabled:opacity-60 ${muted}`}
                          >
                            <RefreshCw size={11} className={verification.requesting ? 'animate-spin' : ''} aria-hidden="true" />
                            {t.resend}
                          </button>
                        </div>
                      )}
                    </>
                  ) : verification.phase === 'checking' && !active ? (
                    <div className={`rounded-2xl border px-4 py-5 text-center ${subtleCard}`}>
                      <Loader2 size={24} className={`mx-auto animate-spin ${muted}`} aria-hidden="true" />
                      <p className={`mt-2 text-[11px] font-bold ${muted}`}>{t.checking}</p>
                      <p className={`mt-1 text-[10px] leading-relaxed ${muted}`}>{t.checkingHint}</p>
                    </div>
                  ) : active ? (
                    <div className={`rounded-2xl border px-4 py-4 text-center ${subtleCard}`}>
                      <Clock size={22} className={`mx-auto ${muted}`} aria-hidden="true" />
                      <p className={`mt-2 text-[11px] font-semibold leading-relaxed ${muted}`}>{t.waitingNoCode}</p>
                      <p className={`mt-1.5 text-[10px] font-bold ${muted}`}>
                        {leftMs > 0 ? `${t.expiresIn} ${formatMMSS(leftMs)}` : t.expired}
                      </p>
                    </div>
                  ) : (
                    <div className={`rounded-2xl border px-4 py-4 text-center ${subtleCard}`}>
                      <ShieldCheck size={22} className={`mx-auto ${muted}`} aria-hidden="true" />
                      <p className={`mt-2 text-[11px] font-semibold leading-relaxed ${muted}`}>{t.startHint}</p>
                    </div>
                  )}

                  {errorText && !phoneTaken && (
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold leading-relaxed text-red-500"
                    >
                      <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{errorText}</span>
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className={`relative z-10 shrink-0 border-t px-5 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))] ${darkMode ? 'border-neutral-800 bg-[#101010]' : 'border-neutral-200 bg-white'}`}>
              {verified ? (
                <button
                  type="button"
                  onClick={onClose}
                  className={`${footerPrimary} bg-[var(--primary)] text-black hover:brightness-95`}
                >
                  {t.done}
                </button>
              ) : phoneTaken ? (
                <button
                  type="button"
                  onClick={onClose}
                  className={`${footerPrimary} border ${secondaryTone}`}
                >
                  {t.close}
                </button>
              ) : active?.method === 'sms' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void verification.verifySms(smsCode)}
                    disabled={verification.verifying || smsCode.length < 4}
                    className={`${footerPrimary} bg-[var(--primary)] text-black hover:brightness-95`}
                  >
                    {verification.verifying ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Check size={16} aria-hidden="true" />
                    )}
                    {verification.verifying ? t.verifyingCode : t.verifyCode}
                  </button>
                  <p className={`mt-1.5 text-center text-[9.5px] leading-relaxed ${muted}`}>{t.smsHint}</p>
                </>
              ) : code && active ? (
                <>
                  {whatsappUrl ? (
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${footerPrimary} bg-[#25D366] text-[#04240f] hover:brightness-95 focus-visible:ring-[#25D366]`}
                    >
                      <MessageCircle size={19} aria-hidden="true" />
                      {t.sendWhatsApp}
                    </a>
                  ) : (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-[11px] font-bold text-amber-600 dark:text-amber-300">
                      {t.noWhatsApp}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void verification.request(lang, 'sms')}
                    disabled={verification.requesting}
                    className={`${footerSecondary} ${secondaryTone}`}
                  >
                    {verification.requesting ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <MessageSquare size={14} aria-hidden="true" />
                    )}
                    {verification.requesting ? t.sendingSms : t.noWhatsAppSms}
                  </button>
                  <p className={`mt-1.5 text-center text-[9.5px] leading-relaxed ${muted}`}>
                    {destinationNumber ? `${t.sendingTo} +${destinationNumber} · ${t.sendHint}` : t.sendHint}
                  </p>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={retry}
                    disabled={verification.requesting || !phone}
                    className={`${footerPrimary} bg-[var(--primary)] text-black hover:brightness-95`}
                  >
                    {verification.requesting ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw size={16} aria-hidden="true" />
                    )}
                    {verification.requesting
                      ? t.gettingCode
                      : active
                        ? t.resend
                        : verification.phase === 'checking'
                          ? t.checkAgain
                          : t.getCode}
                  </button>
                  <button
                    type="button"
                    onClick={() => void verification.request(lang, 'sms')}
                    disabled={verification.requesting}
                    className={`${footerSecondary} ${secondaryTone}`}
                  >
                    {verification.requesting ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <MessageSquare size={14} aria-hidden="true" />
                    )}
                    {verification.requesting ? t.sendingSms : t.noWhatsAppSms}
                  </button>
                  <p className={`mt-1.5 text-center text-[9.5px] leading-relaxed ${muted}`}>{t.smsHint}</p>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
