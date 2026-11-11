import React, { useState } from 'react';

/**
 * Flexible admin number field: the classic controlled `type="number"` input
 * fights the admin — clearing a "0" snaps it right back (Number('') === 0),
 * and mid-typing states like "0." get wiped. This keeps a text draft while
 * focused (full freedom: clear, decimals, leading zeros) and commits a real
 * number live, so previews stay reactive. Blur re-formats to the stored
 * value; blank reads as 0 with an explicit placeholder.
 */
function sanitizeNumText(raw: string): string {
  let s = raw.replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  return s.slice(0, 12);
}

interface NumFieldProps {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** Maximum value clamp (fees, thresholds). Omit = no clamp. */
  max?: number;
}

export const NumField: React.FC<NumFieldProps> = ({
  value,
  onChange,
  placeholder,
  ariaLabel,
  max,
  className = 'w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base tabular-nums focus:border-[var(--primary)]',
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => (typeof max === 'number' ? Math.min(max, n) : n);
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      dir="ltr"
      value={draft ?? (value === 0 ? '' : String(value))}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        const s = sanitizeNumText(e.target.value);
        setDraft(s);
        if (s === '' || s === '.') {
          onChange(0);
          return;
        }
        const n = Number(s);
        onChange(Number.isFinite(n) ? clamp(Math.max(0, n)) : 0);
      }}
      onBlur={() => setDraft(null)}
      className={className}
    />
  );
};
