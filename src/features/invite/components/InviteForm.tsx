import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, KeyRound, Loader2, Lock } from 'lucide-react';
import { iconCls, inputCls, labelCls } from '@/src/features/admin/components/admin-login/loginStyles';
import type { RiseFn } from '@/src/features/admin/components/admin-login/loginTopBar';
import type { InviteStrings } from './inviteStrings';

interface InviteFormProps {
  t: InviteStrings;
  username: string;
  password: string;
  onPasswordChange: (v: string) => void;
  confirm: string;
  onConfirmChange: (v: string) => void;
  showPw: boolean;
  onToggleShowPw: () => void;
  showConfirm: boolean;
  onToggleShowConfirm: () => void;
  capsOn: boolean;
  onCapsKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onCapsBlur: () => void;
  busy: boolean;
  passErr: boolean;
  errorKey: string | null;
  errorText: string;
  hasError: boolean;
  pwRef: React.RefObject<HTMLInputElement | null>;
  submit: (ev: React.FormEvent) => Promise<void>;
  rise: RiseFn;
}

/**
 * Password-setup form mirroring LoginForm piece for piece (same shell,
 * fields, toggles, caps warning, error box, submit) — only the username row
 * is swapped for a confirm row plus a live policy checklist.
 */
export function InviteForm({
  t,
  username,
  password,
  onPasswordChange,
  confirm,
  onConfirmChange,
  showPw,
  onToggleShowPw,
  showConfirm,
  onToggleShowConfirm,
  capsOn,
  onCapsKey,
  onCapsBlur,
  busy,
  passErr,
  errorKey,
  errorText,
  hasError,
  pwRef,
  submit,
  rise,
}: InviteFormProps): React.JSX.Element {
  const longEnough = password.length >= 12;
  const matches = confirm.length > 0 && password === confirm;
  const strength =
    (password.length >= 12 ? 1 : 0) +
    (password.length >= 16 ? 1 : 0) +
    (/[a-z]/.test(password) && /[A-Z]/.test(password) ? 1 : 0) +
    (/\d/.test(password) && /[^a-zA-Z0-9]/.test(password) ? 1 : 0);

  const eyeButton = (visible: boolean, onToggle: () => void) => (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? t.hide : t.show}
      aria-pressed={visible}
      className="absolute end-1.5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-xl flex items-center justify-center text-white/55 hover:text-[var(--primary)] transition-colors"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={visible ? 'off' : 'on'}
          initial={{ opacity: 0, rotate: -40, scale: 0.7 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 40, scale: 0.7 }}
          transition={{ duration: 0.15 }}
          className="flex"
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );

  return (
    <motion.form
      key="form"
      noValidate
      onSubmit={(e) => void submit(e)}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
      className="min-h-[480px] flex flex-col justify-center gap-4"
    >
      <motion.div {...rise(0.6)} className="flex items-start gap-3.5">
        <span className="shrink-0 w-12 h-12 rounded-2xl bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center shadow-[0_10px_26px_-8px_color-mix(in_srgb,var(--primary)_60%,transparent)]">
          <KeyRound size={22} strokeWidth={2.4} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-2xl font-extrabold leading-tight">{t.title}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-white/60">{t.subtitle}</p>
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-[var(--primary)]/40 px-2.5 py-1 text-[11px] font-bold text-[var(--primary)]">
            {t.forAccount}: <b className="tabular-nums" dir="ltr">{username}</b>
          </p>
        </div>
      </motion.div>

      <motion.div {...rise(0.7)}>
        <div className="relative">
          <input
            ref={pwRef}
            id="invite-password"
            name="password"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value.slice(0, 128))}
            onKeyUp={onCapsKey}
            onKeyDown={onCapsKey}
            onBlur={onCapsBlur}
            placeholder=" "
            disabled={busy}
            aria-invalid={passErr}
            className={`${inputCls(passErr)} pe-14!`}
          />
          <label htmlFor="invite-password" className={labelCls}>{t.password}</label>
          <Lock size={18} className={iconCls} aria-hidden="true" />
          {eyeButton(showPw, onToggleShowPw)}
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

      <motion.div {...rise(0.78)}>
        <div className="relative">
          <input
            id="invite-confirm"
            name="confirm"
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => onConfirmChange(e.target.value.slice(0, 128))}
            onKeyUp={onCapsKey}
            onKeyDown={onCapsKey}
            onBlur={onCapsBlur}
            placeholder=" "
            disabled={busy}
            aria-invalid={passErr}
            className={`${inputCls(passErr)} pe-14!`}
          />
          <label htmlFor="invite-confirm" className={labelCls}>{t.confirm}</label>
          <Lock size={18} className={iconCls} aria-hidden="true" />
          {eyeButton(showConfirm, onToggleShowConfirm)}
        </div>
      </motion.div>

      <motion.div {...rise(0.84)}>
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                strength > i ? 'bg-[var(--primary)]' : 'bg-white/10'
              }`}
            />
          ))}
        </div>
        <ul className="mt-2 space-y-1 text-[12px]">
          <li className={`flex items-center gap-1.5 ${longEnough ? 'text-green-400' : 'text-white/45'}`}>
            <Check size={13} strokeWidth={3} aria-hidden="true" />
            {t.policy12}
          </li>
          <li className={`flex items-center gap-1.5 ${matches ? 'text-green-400' : 'text-white/45'}`}>
            <Check size={13} strokeWidth={3} aria-hidden="true" />
            {t.policyMatch}
          </li>
        </ul>
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
