import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { themeConfig } from '@/src/config/theme.config';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  children: ReactNode;
}

/** Design-system primary button. New code must use this, not raw <button> styles. */
export function Button({ variant = 'primary', style, children, ...rest }: ButtonProps) {
  const bg =
    variant === 'primary'
      ? { background: themeConfig.colors.primary, color: themeConfig.colors.background }
      : variant === 'danger'
        ? { background: '#B91C1C', color: '#fff' }
        : { background: 'transparent', color: 'inherit' };
  return (
    <button
      type="button"
      {...rest}
      style={{ borderRadius: themeConfig.radius, ...bg, ...style }}
      className={`btn-tactile h-11 px-5 text-sm font-extrabold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${rest.className || ''}`}
    >
      {children}
    </button>
  );
}
