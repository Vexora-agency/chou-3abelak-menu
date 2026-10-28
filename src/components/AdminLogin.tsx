import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import { STR } from '@/src/components/admin-login/loginStrings';
import type { ErrorKey } from '@/src/components/admin-login/loginStrings';
import { LoginAtmosphere } from '@/src/components/admin-login/loginAtmosphere';
import { LoginTopBar } from '@/src/components/admin-login/loginTopBar';
import type { RiseFn } from '@/src/components/admin-login/loginTopBar';
import { LoginSuccessPanel } from '@/src/components/admin-login/loginSuccessPanel';
import { LoginForm } from '@/src/components/admin-login/loginForm';

export type LoginResult =
  | { ok: true }
  | { ok: false; error: 'invalid' | 'locked' | 'network' | 'unavailable'; retryAfter?: number };

interface AdminLoginProps {
  lang: 'en' | 'ar';
  onToggleLang: () => void;
  /** Verify the credentials on the server. Never trust the browser for this. */
  onSubmit: (values: { username: string; password: string; remember: boolean }) => Promise<LoginResult>;
  /** Called after the success animation finishes (open the admin panel here). */
  onSuccess: () => void;
  /** Return to the public menu. */
  onBack: () => void;
  /** Optional: when provided, a "Forgot password?" link is shown. */
  onForgot?: () => void;
  restaurantName?: string;
}

const AdminLogin: React.FC<AdminLoginProps> = ({
  lang,
  onToggleLang,
  onSubmit,
  onSuccess,
  onBack,
  onForgot,
  restaurantName = 'Chou 3abelak',
}) => {
  const isAr = lang === 'ar';
  const t = STR[lang];
  // Owner decision: login animations always play for everyone.
  const reduce = false;
  const shake = useAnimationControls();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'success'>('idle');
  const [error, setError] = useState<{ key: ErrorKey; n?: number } | null>(null);

  const pwRef = useRef<HTMLInputElement>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const rise: RiseFn = (delay: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  const fail = (e: { key: ErrorKey; n?: number }) => {
    setError(e);
      if (!reduce) void shake.start({ x: [0, -10, 10, -8, 8, -4, 4, 0], transition: { duration: 0.5 } });
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (phase !== 'idle') return;
    // Browser/password-manager autofill can fill the DOM without firing
    // React's onChange — read the live fields as fallback so the first
    // press submits what the user sees, then sync the state.
    const liveUser = username.trim() || userRef.current?.value.trim() || '';
    const livePass = password || pwRef.current?.value || '';
    if (liveUser !== username) setUsername(liveUser);
    if (livePass !== password) setPassword(livePass);
    if (!liveUser || !livePass) {
      fail({ key: 'required' });
      return;
    }
    setError(null);
    setPhase('loading');
    let res: LoginResult;
    try {
      res = await onSubmit({ username: liveUser, password: livePass, remember });
    } catch {
      res = { ok: false, error: 'network' };
    }
    if (res.ok) {
      setPhase('success');
      timer.current = window.setTimeout(onSuccess, 1500);
    } else {
      setPhase('idle');
      fail({ key: res.error, n: res.retryAfter });
      if (res.error === 'invalid') {
        setPassword('');
        window.setTimeout(() => pwRef.current?.focus(), 50);
      }
    }
  };

  const errorText = error ? (error.key === 'locked' ? t.locked.replace('{n}', String(error.n ?? 10)) : t[error.key]) : '';
  const busy = phase === 'loading';
  const userErr = error?.key === 'required' && !username.trim();
  const passErr = (error?.key === 'required' && !password) || error?.key === 'invalid';

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      lang={lang}
      className="relative isolate min-h-[100dvh] overflow-hidden bg-[#0A0A0A] text-white flex flex-col items-center justify-center px-5 py-24 sm:py-16"
    >
      <LoginAtmosphere reduce={reduce} />
      <LoginTopBar t={t} lang={lang} onBack={onBack} onToggleLang={onToggleLang} rise={rise} />

      <main className="relative z-10 w-full max-w-[420px] flex flex-col items-center">
        <motion.img
          src="/assets/logo-final.png"
          alt={restaurantName}
          width={1440}
          height={532}
          draggable={false}
          className="w-[210px] sm:w-[240px] h-auto select-none"
          initial={reduce ? false : { opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />

        <motion.div {...rise(0.35)} className="mt-3 flex items-center justify-center gap-3">
          <span className="h-px w-8 bg-gradient-to-r from-transparent to-[var(--primary)]/70" aria-hidden="true" />
          <span
            className={`font-semibold text-[var(--primary)] ${
              isAr ? 'text-[14px] tracking-normal' : 'text-[12px] tracking-[3px] uppercase'
            }`}
          >
            {t.console}
          </span>
          <span className="h-px w-8 bg-gradient-to-l from-transparent to-[var(--primary)]/70" aria-hidden="true" />
        </motion.div>

        <motion.div {...rise(0.5)} className="w-full mt-7">
          <motion.div
            animate={shake}
            className="glass-pill relative w-full overflow-hidden rounded-[28px] p-6 sm:p-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)]"
          >
            <div className="edge-line edge-line-t" aria-hidden="true" />

            <AnimatePresence mode="wait" initial={false}>
              {phase === 'success' ? (
                <LoginSuccessPanel t={t} reduce={reduce} />
              ) : (
                <LoginForm
                  t={t}
                  username={username}
                  onUsernameChange={setUsername}
                  password={password}
                  onPasswordChange={setPassword}
                  showPw={showPw}
                  onToggleShowPw={() => setShowPw((s) => !s)}
                  capsOn={capsOn}
                  onCapsKey={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                  onCapsBlur={() => setCapsOn(false)}
                  remember={remember}
                  onRememberChange={setRemember}
                  busy={busy}
                  userErr={userErr}
                  passErr={passErr}
                  errorKey={error ? error.key : null}
                  errorText={errorText}
                  hasError={!!error}
                  onForgot={onForgot}
                  pwRef={pwRef}
                  userRef={userRef}
                  submit={submit}
                  rise={rise}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>

        <motion.p {...rise(1.1)} className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-white/45">
          <ShieldCheck size={14} className="shrink-0 text-[var(--primary)]/70" aria-hidden="true" />
          {t.secure}
        </motion.p>
      </main>
    </div>
  );
};

export default AdminLogin;
