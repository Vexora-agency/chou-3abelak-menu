import type { ReactNode } from 'react';
import { themeConfig } from '@/src/config/theme.config';

/** Minimal accessible modal shell (new code). Existing modals stay untouched. */
export function Modal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div
        style={{ borderRadius: themeConfig.radius, background: themeConfig.colors.surface }}
        className="w-full max-w-md p-5 border border-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
