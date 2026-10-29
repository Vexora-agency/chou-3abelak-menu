import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { adminFetch } from '@/src/lib/api-client';
import { readJson } from '@/src/utils/safeJson';
import { LoginAtmosphere } from '@/src/features/admin/components/admin-login/loginAtmosphere';
import { LoginTopBar } from '@/src/features/admin/components/admin-login/loginTopBar';
import type { RiseFn } from '@/src/features/admin/components/admin-login/loginTopBar';
import { LoginSuccessPanel } from '@/src/features/admin/components/admin-login/loginSuccessPanel';
import type { LoginLang } from '@/src/features/admin/components/admin-login/loginStrings';
import { ISTR } from './inviteStrings';
import { InviteForm } from './InviteForm';

interface InvitePageProps {
  token: string;
}

type Phase = 'checking' | 'ready' | 'invalid' | 'redeeming' | 'success' | 'error';

/**
 * One-time invite landing (/invite/<token>), built from the login screen's
 * own pieces (atmosphere, top bar, card, success panel, field styles, rise +
 * shake language) — the two screens are intentionally indistinguishable
 * except for the password-setup form itself.
 *
 * Deep imports of admin-login LEAVES only (no cycle: admin never imports
 * invite; the isolation rules below don't list invite either way).
 */
export const InvitePage: React.FC<InvitePageProps> = ({ token }) => {
  const [lang, setLang] = useState<LoginLang>('en');
  const t = ISTR[lang];
  const isAr = lang === 'ar';
  // Owner decision: login animations always play for everyone.
  const reduce = false;
  const shake = useAnimationControls();

  const [phase, setPhase] = useState<Phase>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState<'locked' | 'network' | null>(null);
  const [retryMin, setRetryMin] = useState(0);

  const pwRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const rise: RiseFn = (delay: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  const fail = () => {
    if (!reduce) void shake.start({ x: [0, -10, 10, -8, 8, -4, 4, 0], transition: { duration: 0.5 } });
  };

  const check = async () => {
    setPhase('checking');
    setError(null);
    try {
      const res = await adminFetch(`/api/invite/validate?token=${encodeURIComponent(token)}`);
      const data = (await readJson(res)) as { ok?: boolean; username?: string };
      if (res.ok && data && data.ok && typeof data.username === 'string' && data.username) {
        setUsername(data.username);
        setPhase('ready');
      } else {
        setPhase('invalid');
      }
    } catch {
      setPhase('error');
    }
  };
  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const longEnough = password.length >= 12;
  const matches = confirm.length > 0 && password === confirm;
  const canSubmit = phase === 'ready' && longEnough && matches;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!canSubmit) return;
    // Browser autofill can fill the DOM without firing React's onChange —
    // read the live field as fallback so the press submits what is seen.
    const livePass = password || pwRef.current?.value || '';
    if (livePass !== password) setPassword(livePass);
    setError(null);
    setPhase('redeeming');
    try {
      const res = await adminFetch('/api/invite/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: livePass }),
      });
      const data = (await readJson(res)) as { ok?: boolean; retryMin?: number };
      setPassword('');
      setConfirm('');
      if (res.ok && data && data.ok) {
        setPhase('success');
        // The token must leave the address bar: a full navigation both
        // drops it from history-forward reach and boots a fresh session.
        timer.current = window.setTimeout(() => window.location.assign('/admin/dashboard'), 1500);
        return;
      }
      setPhase('ready');
      if (res.status === 429) {
        setRetryMin(typeof data?.retryMin === 'number' ? data.retryMin : 10);
        setError('locked');
      } else {
        // invalid / used / expired mid-way — one generic landing.
        setPhase('invalid');
        return;
      }
      fail();
    } catch {
      setPhase('ready');
      setError('network');
      fail();
    }
  };

  const errorText = error === 'locked' ? t.locked.replace('{n}', String(retryMin)) : error ? t.network : '';

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      lang={lang}
      className="relative isolate min-h-[100dvh] overflow-hidden bg-[#0A0A0A] text-white flex flex-col items-center justify-center px-5 py-24 sm:py-16"
    >
      <LoginAtmosphere reduce={reduce} />
      <LoginTopBar
        t={t}
        lang={lang}
        onBack={() => window.location.assign('/')}
        onToggleLang={() => setLang((l) => (l === 'en' ? 'ar' : 'en'))}
        rise={rise}
      />

      <main className="relative z-10 w-full max-w-[420px] flex flex-col items-center">
        <motion.img
          src="/assets/logo-final.png"
          srcSet="/assets/logo-final-480.webp 480w, /assets/logo-final-880.webp 880w"
          sizes="(max-width: 640px) 210px, 240px"
          alt="Chou 3abelak"
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
              ) : phase === 'checking' ? (
                <motion.div
                  key="checking"
                  exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
                  className="min-h-[480px] flex flex-col items-center justify-center gap-4"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 size={30} strokeWidth={2.4} className="animate-spin text-[var(--primary)]" aria-hidden="true" />
                  <p className="text-sm font-bold text-white/70">…</p>
                </motion.div>
              ) : phase === 'invalid' ? (
                <motion.div
                  key="dead"
                  exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
                  className="min-h-[480px] flex flex-col items-center justify-center text-center gap-4"
                  role="alert"
                >
                  <span className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-400/30 text-red-300 flex items-center justify-center">
                    <TriangleAlert size={26} aria-hidden="true" />
                  </span>
                  <h1 className="text-[22px] font-extrabold leading-tight px-2">{t.invalid}</h1>
                  <button
                    type="button"
                    onClick={() => window.location.assign('/')}
                    className="btn-tactile mt-2 h-12 px-8 rounded-2xl bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold hover:brightness-110"
                  >
                    {t.back}
                  </button>
                </motion.div>
              ) : phase === 'error' ? (
                <motion.div
                  key="neterr"
                  exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
                  className="min-h-[480px] flex flex-col items-center justify-center text-center gap-4"
                  role="alert"
                >
                  <h1 className="text-[22px] font-extrabold leading-tight px-2">{t.network}</h1>
                  <button
                    type="button"
                    onClick={() => void check()}
                    className="btn-tactile mt-2 h-12 px-8 rounded-2xl bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold hover:brightness-110"
                  >
                    {t.back}
                  </button>
                </motion.div>
              ) : (
                <InviteForm
                  t={t}
                  username={username}
                  password={password}
                  onPasswordChange={setPassword}
                  confirm={confirm}
                  onConfirmChange={setConfirm}
                  showPw={showPw}
                  onToggleShowPw={() => setShowPw((s) => !s)}
                  showConfirm={showConfirm}
                  onToggleShowConfirm={() => setShowConfirm((s) => !s)}
                  capsOn={capsOn}
                  onCapsKey={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                  onCapsBlur={() => setCapsOn(false)}
                  busy={phase === 'redeeming'}
                  passErr={!!error}
                  errorKey={error}
                  errorText={errorText}
                  hasError={!!error}
                  pwRef={pwRef}
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
