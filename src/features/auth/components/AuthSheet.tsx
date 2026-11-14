import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, X } from 'lucide-react';
import { motion } from 'motion/react';
import { authClient } from '@/src/lib/auth-client';
import { useBodyScrollLock } from '@/src/hooks/useBodyScrollLock';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useAuthProviders } from '../hooks/useAuthProviders';
import { GoogleIcon } from './GoogleIcon';
import { AUTH_STR } from '../strings';

interface AuthSheetProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** Token from the password-reset email; opens the reset form directly. */
  resetToken?: string | null;
  onResetComplete?: () => void;
  /** Landing tab when the sheet opens (checkout CTA asks for signup). */
  initialMode?: 'signin' | 'signup';
  /** Google OAuth return URL (checkout keeps the cart flow). */
  googleCallback?: string;
}

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { status?: unknown; statusCode?: unknown }).status
    ?? (error as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' ? value : null;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function AuthSheet({ open, onClose, onSuccess, lang, darkMode, resetToken, onResetComplete, initialMode = 'signin', googleCallback = '/?account=1' }: AuthSheetProps) {
  const t = AUTH_STR[lang];
  const isAr = lang === 'ar';
  const sheetRef = useRef<HTMLDivElement>(null);
  const providers = useAuthProviders(open);

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useBodyScrollLock(open, 'auth-sheet');
  useFocusTrap(open, sheetRef, onClose);

  useEffect(() => {
    if (!open) return;
    setMode(resetToken ? 'reset' : initialMode);
    setName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setLoading(false);
    setGoogleLoading(false);
    setResendLoading(false);
    setNeedsVerification(false);
    setError('');
    setSuccess('');
  }, [open, initialMode]);

  // A reset link can open the sheet directly, or arrive while it is already
  // open. It must not re-run when the token is cleared after a successful
  // reset (that would wipe the success message).
  useEffect(() => {
    if (!open || !resetToken) return;
    setMode('reset');
    setError('');
    setSuccess('');
  }, [open, resetToken]);

  if (!open) return null;

  const checks = {
    length: password.length >= 10,
    letter: /\p{L}/u.test(password),
    number: /\p{Nd}/u.test(password),
  };
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const passwordOk = checks.length && checks.letter && checks.number;
  const canSubmit = mode === 'signin'
    ? emailOk && password.length > 0
    : mode === 'signup'
      ? name.trim().length >= 1 && emailOk && passwordOk
      : mode === 'forgot'
        ? emailOk
        : passwordOk && confirmPassword === password;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setSuccess('');
    setNeedsVerification(false);
    setPassword('');
    setConfirmPassword('');
  };

  const mapError = (err: unknown) => {
    const status = errorStatus(err);
    const code = errorCode(err);
    if (status === 429) return t.errorRate;
    if (mode === 'signin' && (status === 401 || status === 403)) return t.errorGeneric;
    if (code.includes('password')) return t.errorPassword;
    if (code.includes('name')) return t.errorName;
    if (mode === 'signup') return t.errorSignup;
    return t.errorGeneric;
  };

  const googleSignIn = async () => {
    setError('');
    setSuccess('');
    setGoogleLoading(true);
    try {
      const { error: socialError } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: googleCallback,
      });
      if (socialError) {
        const code = errorCode(socialError);
        setError(
          code.includes('account_not_linked') || code.includes('email_not_verified')
            ? t.googleLinkError
            : t.googleError
        );
        setGoogleLoading(false);
      }
      // On success the browser navigates to Google; keep the spinner until then.
    } catch {
      setError(t.googleError);
      setGoogleLoading(false);
    }
  };

  const resendVerification = async () => {
    setResendLoading(true);
    setError('');
    setSuccess('');
    try {
      const { error: resendError } = await authClient.sendVerificationEmail({
        email: email.trim().toLowerCase(),
        callbackURL: '/',
      });
      if (resendError) setError(t.errorNetwork);
      else setSuccess(t.verificationSent);
    } catch {
      setError(t.errorNetwork);
    } finally {
      setResendLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setNeedsVerification(false);

    if (mode !== 'reset' && !emailOk) {
      setError(t.errorEmail);
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      setError(t.errorName);
      return;
    }
    if ((mode === 'signup' || mode === 'reset') && !passwordOk) {
      setError(t.errorPassword);
      return;
    }
    if (mode === 'reset' && password !== confirmPassword) {
      setError(t.passwordsMismatch);
      return;
    }
    if (mode === 'signin' && !password) {
      setError(t.errorPassword);
      return;
    }

    setLoading(true);
    try {
      if (mode === 'forgot') {
        const { error: resetError } = await authClient.requestPasswordReset({
          email: email.trim().toLowerCase(),
          redirectTo: `${window.location.origin}/?reset=1`,
        });
        if (resetError) {
          setError(errorStatus(resetError) === 429 ? t.errorRate : t.resetLinkError);
          return;
        }
        // Always the same answer: never reveal whether the email exists.
        setSuccess(t.resetSent);
        return;
      }

      if (mode === 'reset') {
        if (!resetToken) {
          setError(t.resetTokenError);
          return;
        }
        const { error: resetError } = await authClient.resetPassword({
          newPassword: password,
          token: resetToken,
        });
        if (resetError) {
          setError(errorStatus(resetError) === 429 ? t.errorRate : t.resetTokenError);
          return;
        }
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        setSuccess(t.resetSuccess);
        onResetComplete?.();
        return;
      }

      if (mode === 'signup') {
        const { error: signUpError } = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        });
        if (signUpError) {
          setError(mapError(signUpError));
          return;
        }
        // autoSignIn is false server-side: the account exists, now sign in.
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        setSuccess(providers.requireEmailVerification ? t.signupVerifySuccess : t.signupSuccess);
        return;
      }

      const { error: signInError } = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) {
        const code = errorCode(signInError);
        if (errorStatus(signInError) === 403 && (code.includes('verif') || code.includes('email'))) {
          setNeedsVerification(true);
          setError(t.verifyRequired);
          return;
        }
        setError(mapError(signInError));
        return;
      }
      onSuccess();
    } catch {
      setError(t.errorNetwork);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = `w-full h-12 px-3.5 rounded-xl border text-base focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
    darkMode
      ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-400'
      : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-500'
  }`;
  const labelClass = `block text-xs font-bold mb-1 ${darkMode ? 'text-neutral-200' : 'text-neutral-800'}`;
  const mutedClass = darkMode ? 'text-neutral-400' : 'text-neutral-500';
  const title = mode === 'signin'
    ? t.signInTitle
    : mode === 'signup'
      ? t.signUpTitle
      : mode === 'forgot'
        ? t.forgotTitle
        : t.resetTitle;
  const subtitle = mode === 'signin'
    ? t.signInSubtitle
    : mode === 'signup'
      ? t.signUpSubtitle
      : mode === 'forgot'
        ? t.forgotSubtitle
        : t.resetSubtitle;
  const submitLabel = loading
    ? (mode === 'signin' ? t.signingIn : mode === 'signup' ? t.creating : mode === 'forgot' ? t.sendingReset : t.saving)
    : (mode === 'signin' ? t.signIn : mode === 'signup' ? t.createAccount : mode === 'forgot' ? t.sendResetLink : t.resetPasswordCta);

  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[80] flex items-end md:items-center justify-center p-0 md:p-6">
      <div onClick={onClose} className="fixed inset-0 bg-black/60 anim-fade-in" aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        dir={isAr ? 'rtl' : 'ltr'}
        className={`anim-drawer-in relative z-10 w-full max-w-[440px] max-h-[92dvh] flex flex-col rounded-t-[28px] md:rounded-[28px] border-t-[5px] border-t-[var(--primary)] md:border-2 md:border-[var(--primary)] shadow-2xl overflow-hidden transition-colors duration-200 ${
          darkMode ? 'bg-[#141414] text-white' : 'bg-white text-[#0A0A0A]'
        }`}
      >
        <div className="overflow-y-auto overscroll-contain no-scrollbar flex-1 min-h-0 px-6 sm:px-7 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className={`w-11 h-1.5 rounded-full mx-auto mt-3 mb-2 md:hidden ${darkMode ? 'bg-neutral-600' : 'bg-neutral-300'}`} />
          <div className="flex items-start justify-between gap-3 pt-2">
            <div className="min-w-0">
              <h2 className="text-xl font-black leading-tight">{title}</h2>
              <p className={`mt-1 text-xs leading-relaxed ${mutedClass}`}>{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.close}
              className={`shrink-0 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                darkMode ? 'text-neutral-400 hover:text-white hover:bg-white/10' : 'text-neutral-500 hover:text-black hover:bg-black/5'
              }`}
            >
              <X size={20} />
            </button>
          </div>

          {(mode === 'signin' || mode === 'signup') && (
            <>
          <div className={`mt-4 grid grid-cols-2 gap-1 p-1 rounded-full border ${darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-neutral-100 border-neutral-200'}`} role="tablist">
            {(['signin', 'signup'] as const).map((value) => {
              const active = mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchMode(value)}
                  className={`relative min-h-[44px] rounded-full text-xs font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                    active ? 'text-[#0A0A0A]' : darkMode ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-black'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="auth-mode-pill"
                      className="absolute inset-0 rounded-full bg-[var(--primary)]"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{value === 'signin' ? t.signInTab : t.signUpTab}</span>
                </button>
              );
            })}
          </div>

          {providers.google && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void googleSignIn()}
                disabled={googleLoading || loading}
                className={`btn-tactile w-full h-12 min-h-[48px] rounded-full border text-sm font-extrabold inline-flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                  darkMode
                    ? 'bg-white text-[#0A0A0A] border-white hover:bg-neutral-100'
                    : 'bg-white text-[#0A0A0A] border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                {googleLoading ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon size={18} />}
                {t.continueGoogle}
              </button>
              <div className={`mt-3 flex items-center gap-3 ${mutedClass}`} aria-hidden="true">
                <span className={`h-px flex-1 ${darkMode ? 'bg-neutral-800' : 'bg-neutral-200'}`} />
                <span className="text-[11px] font-bold">{t.or}</span>
                <span className={`h-px flex-1 ${darkMode ? 'bg-neutral-800' : 'bg-neutral-200'}`} />
              </div>
            </div>
          )}
            </>
          )}

          <form onSubmit={(e) => void submit(e)} noValidate className={`${providers.google && (mode === 'signin' || mode === 'signup') ? 'mt-3' : 'mt-4'} space-y-3`}>
            {mode === 'signup' && (
              <div>
                <label className={labelClass} htmlFor="auth-name">{t.nameLabel}</label>
                <input
                  id="auth-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  autoComplete="name"
                  maxLength={80}
                  enterKeyHint="next"
                  data-autofocus=""
                  className={inputClass}
                />
              </div>
            )}

            {mode !== 'reset' && (
              <div>
                <label className={labelClass} htmlFor="auth-email">{t.emailLabel}</label>
                <input
                  id="auth-email"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  autoComplete="email"
                  dir="ltr"
                  maxLength={254}
                  enterKeyHint="next"
                  data-autofocus={mode === 'signin' || mode === 'forgot' ? '' : undefined}
                  className={`${inputClass} ${isAr ? 'text-end' : 'text-start'}`}
                />
              </div>
            )}

            {mode !== 'forgot' && (
              <div>
                <label className={labelClass} htmlFor="auth-password">
                  {mode === 'reset' ? t.newPassword : t.passwordLabel}
                </label>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.passwordPlaceholder}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    dir="ltr"
                    maxLength={128}
                    enterKeyHint={mode === 'reset' ? 'next' : 'done'}
                    aria-describedby={mode === 'signup' || mode === 'reset' ? 'auth-password-rules' : undefined}
                    data-autofocus={mode === 'reset' ? '' : undefined}
                    className={`${inputClass} ${isAr ? 'pl-12 text-end' : 'pr-12 text-start'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                    aria-pressed={showPassword}
                    className={`absolute ${isAr ? 'left-1' : 'right-1'} top-1/2 -translate-y-1/2 w-10 h-10 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                      darkMode ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-black'
                    }`}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {mode === 'signin' && (
                  <div className="mt-1.5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-[11px] font-bold text-[var(--primary)] hover:underline underline-offset-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    >
                      {t.forgotPassword}
                    </button>
                  </div>
                )}
              </div>
            )}

            {mode === 'reset' && (
              <div>
                <label className={labelClass} htmlFor="auth-confirm">{t.confirmPassword}</label>
                <input
                  id="auth-confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t.confirmPassword}
                  autoComplete="new-password"
                  dir="ltr"
                  maxLength={128}
                  enterKeyHint="done"
                  className={`${inputClass} ${isAr ? 'text-end' : 'text-start'}`}
                />
              </div>
            )}

            {(mode === 'signup' || mode === 'reset') && (
              <div id="auth-password-rules" className="space-y-1.5">
                <p className={`text-[11px] ${mutedClass}`}>{t.passwordHint}</p>
                <div className="grid grid-cols-1 min-[380px]:grid-cols-3 gap-1.5">
                  {[
                    [checks.length, t.passwordRuleLength],
                    [checks.letter, t.passwordRuleLetter],
                    [checks.number, t.passwordRuleNumber],
                  ].map(([ok, label]) => (
                    <span
                      key={String(label)}
                      className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg border ${
                        ok
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : darkMode
                            ? 'border-neutral-800 bg-neutral-900 text-neutral-500'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-500'
                      }`}
                    >
                      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p role="alert" aria-live="assertive" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs font-bold text-red-600 dark:text-red-300">
                {error}
              </p>
            )}
            {needsVerification && (
              <button
                type="button"
                onClick={() => void resendVerification()}
                disabled={resendLoading}
                className="w-full h-11 min-h-[44px] rounded-full border border-[var(--primary)]/50 text-[var(--primary)] text-xs font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                {resendLoading && <Loader2 size={15} className="animate-spin" />}
                {t.resendVerification}
              </button>
            )}
            {success && (
              <p role="status" aria-live="polite" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="btn-tactile w-full h-12 min-h-[48px] rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            >
              {loading && <Loader2 size={17} className="animate-spin" />}
              {submitLabel}
            </button>
          </form>

          {(mode === 'signin' || mode === 'signup') ? (
            <div className={`mt-3 flex items-center justify-center gap-1.5 text-xs ${mutedClass}`}>
              <span>{mode === 'signin' ? t.newHere : t.haveAccount}</span>
              <button
                type="button"
                onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                className="font-extrabold text-[var(--primary)] hover:underline underline-offset-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                {mode === 'signin' ? t.switchToSignUp : t.switchToSignIn}
              </button>
            </div>
          ) : (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-xs font-extrabold text-[var(--primary)] hover:underline underline-offset-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] min-h-[44px] px-3"
              >
                {t.backToSignIn}
              </button>
            </div>
          )}

          <p className={`mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed ${mutedClass}`}>
            <LockKeyhole size={12} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
            <span>{t.secureNote}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
