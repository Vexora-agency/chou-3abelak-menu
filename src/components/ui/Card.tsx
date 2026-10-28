import type { ReactNode } from 'react';
import { themeConfig } from '@/src/config/theme.config';

/** Design-system card shell. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      style={{ borderRadius: themeConfig.radius, background: themeConfig.colors.surface, borderColor: themeConfig.colors.border }}
      className={`rounded-xl border p-4 ${className}`}
    >
      {children}
    </div>
  );
}
