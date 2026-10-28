import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Loader2, Lock, User } from 'lucide-react';
import { iconCls, inputCls, labelCls } from '@/src/components/admin-login/loginStyles';
import type { LoginStrings } from '@/src/components/admin-login/loginStrings';
import type { RiseFn } from '@/src/components/admin-login/loginTopBar';

interface LoginFormProps {
  t: LoginStrings;
  username: string;
  onUsernameChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  showPw: boolean;
  onToggleShowPw: () => void;
  capsOn: boolean;
  onCapsKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onCapsBlur: () => void;
  remember: boolean;
  onRememberChange: (v: boolean) => void;
  busy: boolean;
  userErr: boolean;
  passErr: boolean;
  errorKey: string | null;
  errorText: string;
  hasError: boolean;
  onForgot?: () => void;
  pwRef: React.RefObject<HTMLInputElement | null>;
  userRef: React.RefObject<HTMLInputElement | null>;
  submit: (ev: React.FormEvent) => Promise<void>;
  rise: RiseFn;
}

export function LoginForm({
  t,
  username,
  onUsernameChange,
  password,
  onPasswordChange,
  showPw,
  onToggleShowPw,
  capsOn,
  onCapsKey,
  onCapsBlur,
  remember,
  onRememberChange,
  busy,
  userErr,
  passErr,
  errorKey,
  errorText,
  hasError,
  onForgot,
  pwRef,
  userRef,
  submit,
  rise,
}: LoginFormProps): React.JSX.Element {
  return (
    <motion.form
      key="form"
      noValidate
      onSubmit={(e) => void submit(e)}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
      className="min-h-[400px] flex flex-col justify-center gap-4"
    >
      <motion.div {...rise(0.6)} className="flex items-start gap-3.5">
        <span className="shrink-0 w-12 h-12 rounded-2xl bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center shadow-[0_10px_26px_-8px_color-mix(in_srgb,var(--primary)_60%,transparent)]">
          <Lock size={22} strokeWidth={2.4} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-[22px] sm:text-2xl font-extrabold leading-tight">{t.title}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-white/60">{t.subtitle}</p>
        </div>
      </motion.div>

      <motion.div {...rise(0.7)} className="relative mt-1">
        <input
          ref={userRef}
          id="admin-username"
          name="username"
          type="text"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
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
            onChange={(e) => onPasswordChange(e.target.value)}
            onKeyUp={onCapsKey}
            onKeyDown={onCapsKey}
            onBlur={onCapsBlur}
            placeholder=" "
            disabled={busy}
            aria-invalid={passErr}
            className={`${inputCls(passErr)} pe-14!`}
          />
          <label htmlFor="admin-password" className={labelCls}>{t.password}</label>
          <Lock size={18} className={iconCls} aria-hidden="true" />
          <button
            type="button"
            onClick={onToggleShowPw}
            aria-label={showPw ? t.hide : t.show}
            aria-pressed={showPw}
            className="absolute end-1.5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-xl flex items-center justify-center text-white/55 hover:text-[var(--primary)] transition-colors"
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
          <input type="checkbox" checked={remember} onChange={(e) => onRememberChange(e.target.checked)} className="peer sr-only" />
          <span className="w-5 h-5 rounded-md border border-white/30 flex items-center justify-center text-[#0A0A0A] transition-colors peer-checked:bg-[var(--primary)] peer-checked:border-[var(--primary)] peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--primary)]/25">
            <Check size={14} strokeWidth={3.5} className={`transition-transform duration-200 ${remember ? 'scale-100' : 'scale-0'}`} />
          </span>
          {t.remember}
        </label>
        {onForgot && (
          <button type="button" onClick={onForgot} className="text-[13px] font-semibold text-[var(--primary)] hover:underline underline-offset-4 min-h-[44px]">
            {t.forgot}
          </button>
        )}
      </motion.div>

      <AnimatePresence initial={false}>
        {hasError && errorKey && (
          <motion.div
            key={errorKey}
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
  );
}
