import React, { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Eye, EyeOff, KeyRound, ShieldCheck, CircleCheck, TriangleAlert } from 'lucide-react';
import { clientConfig } from '@/src/config/client.config';
import { adminFetch } from '@/src/lib/api-client';
import { readJson } from '@/src/utils/safeJson';

interface InvitePageProps {
  token: string;
}

type Phase = 'checking' | 'ready' | 'invalid' | 'redeeming' | 'success' | 'error';

/**
 * One-time invite landing (/invite/<token>): the client sets their own
 * password and is logged straight into their admin. Same luxury-dark theme
 * as the login screen; GSAP entrance + success choreography (no third-party
 * resources anywhere on this page — nothing may leak the token via Referer).
 */
export const InvitePage: React.FC<InvitePageProps> = ({ token }) => {
  const [phase, setPhase] = useState<Phase>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [note, setNote] = useState('');
  const [retryMin, setRetryMin] = useState(0);
  const scope = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  useLayoutEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // GSAP entrance: scoped context, fully reverted on unmount.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('[data-anim="logo"]', { opacity: 0, scale: 0.92, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 0.7 })
        .fromTo('[data-anim="rule"]', { scaleX: 0 }, { scaleX: 1, duration: 0.8 }, '-=0.35')
        .fromTo('[data-anim="rise"]', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.65, stagger: 0.09 }, '-=0.55')
        .fromTo('[data-anim="card"]', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.7 }, '-=0.5');
      // Ambient: the pan watermark breathes slowly behind the card.
      gsap.to('[data-anim="mark"]', {
        rotate: 8,
        y: -10,
        duration: 5,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
    }, scope);
    return () => ctx.revert();
  }, []);

  const check = async () => {
    setPhase('checking');
    setNote('');
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
  useLayoutEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const longEnough = password.length >= 12;
  const matches = confirm.length > 0 && password === confirm;
  const canSubmit = phase === 'ready' && longEnough && matches;
  const strength =
    (password.length >= 12 ? 1 : 0) +
    (password.length >= 16 ? 1 : 0) +
    (/[a-z]/.test(password) && /[A-Z]/.test(password) ? 1 : 0) +
    (/\d/.test(password) && /[^a-zA-Z0-9]/.test(password) ? 1 : 0);

  const celebrate = () => {
    if (!scope.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '[data-anim="seal"]',
        { scale: 0.4, opacity: 0, rotate: -18 },
        { scale: 1, opacity: 1, rotate: 0, duration: 0.7, ease: 'back.out(1.6)' }
      );
      gsap.fromTo(
        '[data-anim="shine"]',
        { x: '-130%' },
        { x: '230%', duration: 1.1, ease: 'power2.inOut', delay: 0.25 }
      );
    }, scope);
    timers.current.push(window.setTimeout(() => ctx.revert(), 4000));
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!canSubmit) return;
    setPhase('redeeming');
    setNote('');
    try {
      const res = await adminFetch('/api/invite/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = (await readJson(res)) as { ok?: boolean; retryMin?: number };
      setPassword('');
      setConfirm('');
      if (res.ok && data && data.ok) {
        setPhase('success');
        celebrate();
        // The token must leave the address bar: a full navigation both
        // drops it from history-forward reach and boots a fresh session.
        timers.current.push(window.setTimeout(() => window.location.assign('/admin/dashboard'), 1700));
        return;
      }
      if (res.status === 429) {
        setRetryMin(typeof data?.retryMin === 'number' ? data.retryMin : 15);
        setNote('locked');
        setPhase('ready');
        return;
      }
      // invalid / used / expired — one generic landing, never the reason.
      setPhase('invalid');
    } catch {
      setNote('network');
      setPhase('ready');
    }
  };

  return (
    <div
      ref={scope}
      className="relative isolate min-h-[100dvh] overflow-hidden bg-[#0A0A0A] text-white flex flex-col items-center justify-center px-5 py-24 sm:py-16"
    >
      <div className="header-grain" aria-hidden="true" />
      <img
        src="/assets/pan-icon-yellow-192.webp"
        alt=""
        aria-hidden="true"
        draggable={false}
        data-anim="mark"
        className="pointer-events-none select-none absolute -top-10 -end-10 w-64 opacity-[0.10] -rotate-12"
      />
      <main className="relative z-10 w-full max-w-[420px] flex flex-col items-center">
        <img
          src={clientConfig.logo}
          alt={clientConfig.companyNameEn}
          data-anim="logo"
          className="w-[190px] sm:w-[220px] h-auto select-none"
          draggable={false}
        />
        <div data-anim="rule" className="mt-3 flex items-center justify-center gap-3 origin-center">
          <span className="h-px w-8 bg-gradient-to-r from-transparent to-[var(--primary)]/70" aria-hidden="true" />
          <span className="font-semibold text-[var(--primary)] text-sm tracking-wide">
            Private invite · دعوة خاصة
          </span>
          <span className="h-px w-8 bg-gradient-to-l from-transparent to-[var(--primary)]/70" aria-hidden="true" />
        </div>

        <div
          data-anim="card"
          className="glass-pill relative w-full overflow-hidden rounded-[28px] p-6 sm:p-8 mt-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)]"
        >
          <div
            data-anim="shine"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent"
          />
          {phase === 'checking' && (
            <div className="flex flex-col items-center py-8" role="status" aria-live="polite">
              <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin mb-4 border-[var(--primary)]" />
              <p className="text-sm text-neutral-300 font-bold">Checking your invite…</p>
              <p className="text-[11px] text-neutral-500 mt-1">جارٍ التحقق من الدعوة…</p>
            </div>
          )}

          {(phase === 'invalid') && (
            <div className="flex flex-col items-center py-6 text-center">
              <span data-anim="rise" className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mb-4">
                <TriangleAlert size={26} />
              </span>
              <h1 data-anim="rise" className="text-lg font-extrabold">This link is invalid or expired</h1>
              <p data-anim="rise" className="text-xs text-neutral-400 mt-2 leading-relaxed">
                Invite links are single-use and expire after 72 hours.
                <br />
                هذا الرابط غير صالح أو انتهت صلاحيته — اطلب رابطًا جديدًا من المطعم.
              </p>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center py-6 text-center">
              <h1 className="text-lg font-extrabold">Connection problem</h1>
              <p className="text-xs text-neutral-400 mt-2">تعذر الاتصال — تحقق من الإنترنت وحاول مجددًا.</p>
              <button
                type="button"
                onClick={() => void check()}
                className="btn-tactile mt-5 h-11 px-8 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold hover:brightness-110"
              >
                Try again · حاول مجددًا
              </button>
            </div>
          )}

          {phase === 'success' && (
            <div className="flex flex-col items-center py-6 text-center">
              <span data-anim="seal" className="w-16 h-16 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center mb-4 shadow-lg">
                <CircleCheck size={34} />
              </span>
              <h1 className="text-lg font-extrabold">Welcome aboard, {username}</h1>
              <p className="text-xs text-neutral-400 mt-2">Taking you to your dashboard… · جارٍ الدخول إلى لوحتك…</p>
            </div>
          )}

          {(phase === 'ready' || phase === 'redeeming') && (
            <form onSubmit={(e) => void submit(e)}>
              <div data-anim="rise" className="flex items-center gap-2.5 text-[var(--primary)] mb-1">
                <KeyRound size={18} />
                <h1 className="text-base font-extrabold">Set your password</h1>
              </div>
              <p data-anim="rise" className="text-[11px] text-neutral-500 mb-5">
                For <b className="text-neutral-200 tabular-nums" dir="ltr">{username}</b> · لهذا الحساب — تُستخدم لمرة واحدة
              </p>

              {(['password', 'confirm'] as const).map((field) => {
                const isPw = field === 'password';
                const value = isPw ? password : confirm;
                const setValue = isPw ? setPassword : setConfirm;
                const visible = isPw ? showPw : showConfirm;
                const setVisible = isPw ? setShowPw : setShowConfirm;
                return (
                  <div key={field} data-anim="rise" className="mb-3.5">
                    <label className="block text-xs text-neutral-400 mb-1.5" htmlFor={`invite-${field}`}>
                      {isPw ? 'New password · كلمة السر' : 'Confirm password · التأكيد'}
                    </label>
                    <div className="relative">
                      <input
                        id={`invite-${field}`}
                        type={visible ? 'text' : 'password'}
                        autoComplete="new-password"
                        dir="ltr"
                        value={value}
                        disabled={phase === 'redeeming'}
                        onChange={(e) => setValue(e.target.value.slice(0, 128))}
                        onKeyUp={(e) => {
                          try {
                            setCapsOn((e.nativeEvent as KeyboardEvent).getModifierState?.('CapsLock') || false);
                          } catch {
                            setCapsOn(false);
                          }
                        }}
                        className="w-full h-12 ps-4 pe-12 rounded-2xl bg-black border border-neutral-700 text-sm tabular-nums focus:border-[var(--primary)] outline-none disabled:opacity-60"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setVisible(!visible)}
                        aria-label={visible ? 'Hide password' : 'Show password'}
                        className="absolute end-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-[var(--primary)] transition-colors"
                      >
                        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                );
              })}

              {capsOn && (
                <p className="text-[11px] text-amber-400 mb-2" role="status">Caps Lock is on · زر الحروف الكبيرة مفعّل</p>
              )}

              {/* Live policy checklist + strength */}
              <div data-anim="rise" className="mb-4">
                <div className="flex gap-1.5 mb-2" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                        strength > i ? 'bg-[var(--primary)]' : 'bg-neutral-800'
                      }`}
                    />
                  ))}
                </div>
                <ul className="text-[11px] space-y-1">
                  <li className={longEnough ? 'text-green-400' : 'text-neutral-500'}>
                    {longEnough ? '✓' : '○'} At least 12 characters · ١٢ حرفًا على الأقل
                  </li>
                  <li className={matches ? 'text-green-400' : 'text-neutral-500'}>
                    {matches ? '✓' : '○'} Passwords match · التطابق
                  </li>
                </ul>
              </div>

              {(note === 'locked' || note === 'network') && (
                <p className="text-[11px] text-amber-400 mb-3" role="alert">
                  {note === 'locked'
                    ? `Too many attempts — try again in ~${retryMin} min. · محاولات كثيرة، حاول بعد ~${retryMin} دقيقة.`
                    : 'Connection problem — nothing was changed, try again. · تعذر الاتصال، حاول مجددًا.'}
                </p>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="btn-tactile w-full h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 transition flex items-center justify-center gap-2"
              >
                {phase === 'redeeming' ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin border-[#0A0A0A]" />
                    Creating your login…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={17} />
                    Create my login · إنشاء الدخول
                  </>
                )}
              </button>
              <p className="text-[10px] text-neutral-600 text-center mt-3 leading-relaxed">
                This link dies the moment you use it — never share it.
                <br />
                الرابط يُستخدم مرة واحدة فقط — لا تشاركه أبدًا.
              </p>
            </form>
          )}
        </div>

        <p data-anim="rise" className="mt-5 text-[10px] text-neutral-600 flex items-center gap-1.5">
          <ShieldCheck size={11} />
          Protected invite · {clientConfig.companyNameEn}
        </p>
      </main>
    </div>
  );
};
