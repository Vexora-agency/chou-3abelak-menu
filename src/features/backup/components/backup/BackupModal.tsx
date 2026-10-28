import React, { useEffect } from 'react';
import { motion } from 'motion/react';

export const BackupModal: React.FC<{ onClose: () => void; children: React.ReactNode; label: string }> = ({ onClose, children, label }) => {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div role="dialog" aria-modal="true" aria-label={label} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-neutral-900 border border-neutral-700 border-t-[var(--primary)] p-5">
        {children}
      </motion.div>
    </div>
  );
};
