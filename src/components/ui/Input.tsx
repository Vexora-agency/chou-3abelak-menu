import type { InputHTMLAttributes } from 'react';
import { themeConfig } from '@/src/config/theme.config';

/** Design-system input. New code must use this. */
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{ borderRadius: themeConfig.radius, ...props.style }}
      className={`w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:outline-none ${props.className || ''}`}
    />
  );
}
