export const inputCls = (hasError: boolean): string =>
  // text-[16px]: iOS Safari auto-zooms any field under 16px on focus.
  `login-field peer w-full h-14 rounded-2xl bg-black/45 border ps-12 pe-4 pt-5 text-[16px] text-white placeholder:text-transparent outline-none transition-[border-color,box-shadow,background-color] duration-200 focus:border-[var(--primary)] focus:bg-black/60 focus:ring-4 focus:ring-[var(--primary)]/15 disabled:opacity-60 ${
    hasError ? 'border-red-400/70' : 'border-white/15'
  }`;

export const labelCls =
  'pointer-events-none absolute start-12 top-1/2 -translate-y-1/2 text-[14px] text-white/55 transition-all duration-200 ' +
  'peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-[11px] peer-focus:text-[var(--primary)] ' +
  'peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px]';

export const iconCls =
  'pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-white/45 transition-colors duration-200 peer-focus:text-[var(--primary)]';
