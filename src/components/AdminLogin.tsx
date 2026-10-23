import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from 'lucide-react';

export type LoginResult =
  | { ok: true }
  | { ok: false; error: 'invalid' | 'locked' | 'network'; retryAfter?: number };

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

const STR = {
  en: {
    back: 'Back to menu',
    console: 'Admin console',
    title: 'Welcome back',
    subtitle: 'Sign in to manage your menu, prices and ordering settings.',
    username: 'Email or username',
    password: 'Password',
    remember: 'Keep me signed in',
    forgot: 'Forgot password?',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    welcome: 'Welcome back',
    opening: 'Opening your dashboard…',
    secure: 'Protected area. Authorized staff only.',
    caps: 'Caps Lock is on',
    show: 'Show password',
    hide: 'Hide password',
    required: 'Please enter your email and password.',
    invalid: 'Incorrect email or password. Please try again.',
    locked: 'Too many attempts. Try again in {n} min.',
    network: 'Connection problem. Check your internet and try again.',
    switchTo: 'Switch to English',
  },
  ar: {
    back: 'العودة إلى المنيو',
    console: 'لوحة التحكم',
    title: 'أهلاً بعودتك',
    subtitle: 'سجّل الدخول لإدارة المنيو والأسعار وإعدادات الطلب.',
    username: 'البريد الإلكتروني أو اسم المستخدم',
    password: 'كلمة المرور',
    remember: 'ابقني مسجّلاً',
    forgot: 'نسيت كلمة المرور؟',
    signIn: 'تسجيل الدخول',
    signingIn: 'جارٍ تسجيل الدخول…',
    welcome: 'أهلاً بعودتك',
    opening: 'جارٍ فتح لوحة التحكم…',
    secure: 'منطقة محمية. للموظفين المصرّح لهم فقط.',
    caps: 'زر Caps Lock مفعّل',
    show: 'إظهار كلمة المرور',
    hide: 'إخفاء كلمة المرور',
    required: 'يرجى إدخال البريد وكلمة المرور.',
    invalid: 'البريد أو كلمة المرور غير صحيحة. حاول مرة أخرى.',
    locked: 'محاولات كثيرة. حاول بعد {n} دقيقة.',
    network: 'مشكلة في الاتصال. تحقق من الإنترنت وحاول مجدداً.',
    switchTo: 'التبديل إلى العربية',
  },
} as const;

type ErrorKey = 'required' | 'invalid' | 'locked' | 'network';

// Slow rising embers, a nod to the sizzle in the logo animation
const EMBERS = [
  { left: '8%', size: 3, rise: 520, dur: 11, delay: 0, drift: 14 },
  { left: '19%', size: 4, rise: 640, dur: 13, delay: 3.2, drift: -12 },
  { left: '30%', size: 3, rise: 460, dur: 9, delay: 1.4, drift: 10 },
  { left: '42%', size: 5, rise: 700, dur: 14, delay: 5.5, drift: -16 },
  { left: '53%', size: 3, rise: 500, dur: 10, delay: 2.4, drift: 12 },
  { left: '64%', size: 4, rise: 600, dur: 12, delay: 6.8, drift: -10 },
  { left: '74%', size: 3, rise: 480, dur: 9.5, delay: 0.8, drift: 14 },
  { left: '85%', size: 4, rise: 660, dur: 13, delay: 4.1, drift: -14 },
  { left: '93%', size: 3, rise: 440, dur: 10.5, delay: 7.3, drift: 8 },
];

const inputCls = (hasError: boolean) =>
  `login-field peer w-full h-14 rounded-2xl bg-black/45 border ps-12 pe-4 pt-5 text-[15px] text-white placeholder:text-transparent outline-none transition-[border-color,box-shadow,background-color] duration-200 focus:border-[#FFC400] focus:bg-black/60 focus:ring-4 focus:ring-[#FFC400]/15 disabled:opacity-60 ${
    hasError ? 'border-red-400/70' : 'border-white/15'
  }`;

const labelCls =
  'pointer-events-none absolute start-12 top-1/2 -translate-y-1/2 text-[14px] text-white/55 transition-all duration-200 ' +
  'peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-[11px] peer-focus:text-[#FFC400] ' +
  'peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px]';

const iconCls =
  'pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-white/45 transition-colors duration-200 peer-focus:text-[#FFC400]';

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
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const rise = (delay: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  const fail = (e: { key: ErrorKey; n?: number }) => {
    setError(e);
    if (!reduce) shake.start({ x: [0, -10, 10, -8, 8, -4, 4, 0], transition: { duration: 0.5 } });
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (phase !== 'idle') return;
    if (!username.trim() || !password) {
      fail({ key: 'required' });
      return;
    }
    setError(null);
    setPhase('loading');
    let res: LoginResult;
    try {
      res = await onSubmit({ username: username.trim(), password, remember });
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
      {/* Atmosphere: warm spotlight, grain, floating brand mark, embers */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4 }}
      >
        <div className="header-spot" />
      </motion.div>
      <div className="header-grain" aria-hidden="true" />
      <motion.img
        src="/assets/pan-icon-yellow.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute -bottom-12 -end-20 w-[340px] sm:w-[440px] opacity-[0.06] pointer-events-none select-none"
        initial={{ rotate: -14 }}
        animate={reduce ? { rotate: -14 } : { y: [0, -16, 0], rotate: [-14, -10, -14] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      {!reduce &&
        EMBERS.map((e, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="absolute bottom-0 rounded-full bg-[#FFC400] pointer-events-none"
            style={{ left: e.left, width: e.size, height: e.size }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: -e.rise, opacity: [0, 0.6, 0], x: [0, e.drift, 0] }}
            transition={{ duration: e.dur, delay: e.delay, repeat: Infinity, ease: 'linear' }}
          />
        ))}

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 sm:px-8 pt-4 sm:pt-6">
        <motion.button
          {...rise(0.1)}
          type="button"
          onClick={onBack}
          className="glass-pill btn-tactile h-11 ps-3.5 pe-4 rounded-full inline-flex items-center gap-2 text-sm font-semibold text-white/85 hover:text-white"
        >
          <ArrowLeft size={17} className="rtl:rotate-180" aria-hidden="true" />
          <span>{t.back}</span>
        </motion.button>

        <motion.div {...rise(0.15)} className="glass-pill flex p-1 rounded-full">
          {(['en', 'ar'] as const).map((code) => {
            const active = lang === code;
            return (
              <button
                key={code}
                type="button"
                onClick={active ? undefined : onToggleLang}
                className={`relative min-w-[48px] h-9 px-3 rounded-full text-xs font-bold transition-colors ${
                  active ? 'text-[#0A0A0A]' : 'text-white/75 hover:text-white'
                }`}
                aria-label={code === 'en' ? STR.en.switchTo : STR.ar.switchTo}
                aria-pressed={active}
              >
                {active && (
                  <motion.span
                    layoutId="login-lang-pill"
                    className="absolute inset-0 rounded-full bg-[#FFC400] shadow-[0_4px_14px_-2px_rgba(255,196,0,0.6)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative z-10">{code === 'en' ? 'EN' : 'عربي'}</span>
              </button>
            );
          })}
        </motion.div>
      </div>

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
          <span className="h-px w-8 bg-gradient-to-r from-transparent to-[#FFC400]/70" aria-hidden="true" />
          <span
            className={`font-semibold text-[#FFC400] ${
              isAr ? 'text-[14px] tracking-normal' : 'text-[12px] tracking-[3px] uppercase'
            }`}
          >
            {t.console}
          </span>
          <span className="h-px w-8 bg-gradient-to-l from-transparent to-[#FFC400]/70" aria-hidden="true" />
        </motion.div>

        <motion.div {...rise(0.5)} className="w-full mt-7">
          <motion.div
            animate={shake}
            className="glass-pill relative w-full overflow-hidden rounded-[28px] p-6 sm:p-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)]"
          >
            <div className="edge-line edge-line-t" aria-hidden="true" />

            <AnimatePresence mode="wait" initial={false}>
              {phase === 'success' ? (
                <motion.div
                  key="ok"
                  role="status"
                  aria-live="polite"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className="min-h-[400px] flex flex-col items-center justify-center text-center gap-4"
                >
                  <div className="relative">
                    {!reduce && (
                      <motion.span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full bg-[#FFC400]/30"
                        initial={{ scale: 1, opacity: 0.7 }}
                        animate={{ scale: 2.2, opacity: 0 }}
                        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
                      />
                    )}
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                      className="relative w-20 h-20 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center shadow-[0_0_60px_rgba(255,196,0,0.45)]"
                    >
                      <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <motion.path
                          d="M5 12.5l4.5 4.5L19 7.5"
                          initial={{ pathLength: reduce ? 1 : 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ delay: 0.2, duration: 0.45, ease: 'easeOut' }}
                        />
                      </svg>
                    </motion.div>
                  </div>
                  <h2 className="text-2xl font-extrabold">{t.welcome}</h2>
                  <p className="text-sm text-white/60">{t.opening}</p>
                  <div className="w-40 h-1 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
                    <motion.div
                      className="h-full rounded-full bg-[#FFC400]"
                      initial={{ width: reduce ? '100%' : '0%' }}
                      animate={{ width: '100%' }}
                      transition={{ duration: 1.3, ease: 'easeInOut' }}
                    />
                  </div>
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  noValidate
                  onSubmit={submit}
                  exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
                  className="min-h-[400px] flex flex-col justify-center gap-4"
                >
                  <motion.div {...rise(0.6)} className="flex items-start gap-3.5">
                    <span className="shrink-0 w-12 h-12 rounded-2xl bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center shadow-[0_10px_26px_-8px_rgba(255,196,0,0.6)]">
                      <Lock size={22} strokeWidth={2.4} aria-hidden="true" />
                    </span>
                    <div>
                      <h1 className="text-[22px] sm:text-2xl font-extrabold leading-tight">{t.title}</h1>
                      <p className="mt-1 text-[13px] leading-relaxed text-white/60">{t.subtitle}</p>
                    </div>
                  </motion.div>

                  <motion.div {...rise(0.7)} className="relative mt-1">
                    <input
                      id="admin-username"
                      name="username"
                      type="text"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder=" "
                      disabled={busy}
                      aria-invalid={userErr}
                      className={inputCls(userErr)}
                    />
                    <label htmlFor="admin-username" className={labelCls}>{t.username}</label>
                    <User size={18} className={iconCls} aria-hidden="true" />
                  </motion.div>

                  <motion.div {...rise(0.78)}>
                    <div className="relative">
                      <input
                        ref={pwRef}
                        id="admin-password"
                        name="password"
                        type={showPw ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyUp={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                        onKeyDown={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                        onBlur={() => setCapsOn(false)}
                        placeholder=" "
                        disabled={busy}
                        aria-invalid={passErr}
                        className={`${inputCls(passErr)} pe-14!`}
                      />
                      <label htmlFor="admin-password" className={labelCls}>{t.password}</label>
                      <Lock size={18} className={iconCls} aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => setShowPw((s) => !s)}
                        aria-label={showPw ? t.hide : t.show}
                        aria-pressed={showPw}
                        className="absolute end-1.5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-xl flex items-center justify-center text-white/55 hover:text-[#FFC400] transition-colors"
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={showPw ? 'off' : 'on'}
                            initial={{ opacity: 0, rotate: -40, scale: 0.7 }}
                            animate={{ opacity: 1, rotate: 0, scale: 1 }}
                            exit={{ opacity: 0, rotate: 40, scale: 0.7 }}
                            transition={{ duration: 0.15 }}
                            className="flex"
                          >
                            {showPw ? <EyeOff size={19} /> : <Eye size={19} />}
                          </motion.span>
                        </AnimatePresence>
                      </button>
                    </div>
                    <AnimatePresence initial={false}>
                      {capsOn && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden flex items-center gap-1.5 text-[12px] text-amber-300 pt-2"
                        >
                          <AlertCircle size={14} aria-hidden="true" />
                          {t.caps}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  <motion.div {...rise(0.86)} className="flex items-center justify-between gap-3 flex-wrap">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none text-[13px] text-white/75 min-h-[44px]">
                      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="peer sr-only" />
                      <span className="w-5 h-5 rounded-md border border-white/30 flex items-center justify-center text-[#0A0A0A] transition-colors peer-checked:bg-[#FFC400] peer-checked:border-[#FFC400] peer-focus-visible:ring-4 peer-focus-visible:ring-[#FFC400]/25">
                        <Check size={14} strokeWidth={3.5} className={`transition-transform duration-200 ${remember ? 'scale-100' : 'scale-0'}`} />
                      </span>
                      {t.remember}
                    </label>
                    {onForgot && (
                      <button type="button" onClick={onForgot} className="text-[13px] font-semibold text-[#FFC400] hover:underline underline-offset-4 min-h-[44px]">
                        {t.forgot}
                      </button>
                    )}
                  </motion.div>

                  <AnimatePresence initial={false}>
                    {error && (
                      <motion.div
                        key={error.key}
                        role="alert"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-3 text-[13px] leading-relaxed text-red-200">
                          <AlertCircle size={17} className="mt-px shrink-0 text-red-300" aria-hidden="true" />
                          <span>{errorText}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.div {...rise(0.94)}>
                    <button
                      type="submit"
                      disabled={busy}
                      className="btn-tactile btn-primary-shine group w-full h-14 rounded-2xl text-[15px] font-extrabold flex items-center justify-center gap-2 disabled:cursor-wait"
                    >
                      {busy ? (
                        <>
                          <Loader2 size={19} strokeWidth={2.6} className="animate-spin" aria-hidden="true" />
                          <span>{t.signingIn}</span>
                        </>
                      ) : (
                        <>
                          <span>{t.signIn}</span>
                          <ArrowRight size={18} strokeWidth={2.6} className="rtl:rotate-180 transition-transform duration-200 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
                        </>
                      )}
                    </button>
                  </motion.div>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>

        <motion.p {...rise(1.1)} className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-white/45">
          <ShieldCheck size={14} className="shrink-0 text-[#FFC400]/70" aria-hidden="true" />
          {t.secure}
        </motion.p>
      </main>
    </div>
  );
};

export default AdminLogin;
