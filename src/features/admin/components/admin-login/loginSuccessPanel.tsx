import { motion } from 'motion/react';
import type { LoginStrings } from './loginStrings';

interface LoginSuccessPanelProps {
  t: LoginStrings;
  reduce: boolean;
}

export function LoginSuccessPanel({ t, reduce }: LoginSuccessPanelProps): React.JSX.Element {
  return (
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
            className="absolute inset-0 rounded-full bg-[var(--primary)]/30"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 2.2, opacity: 0 }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="relative w-20 h-20 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center shadow-[0_0_60px_color-mix(in_srgb,var(--primary)_45%,transparent)]"
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
          className="h-full rounded-full bg-[var(--primary)]"
          initial={{ width: reduce ? '100%' : '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 1.3, ease: 'easeInOut' }}
        />
      </div>
    </motion.div>
  );
}
