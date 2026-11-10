import React from 'react';
import { Flame } from 'lucide-react';
import { spicyFlames, spicyLabel } from '@/src/utils/menuHelpers';

interface HeatPillProps {
  /** Spicy feature id ('spicy-mild' | 'spicy-medium' | 'spicy-hot' | legacy 'spicy').
   *  Unknown/legacy ids fall back to a single flame + the generic label. */
  featureId?: unknown;
  lang: 'en' | 'ar';
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Unified heat indicator: N flame icons (1 mild · 2 medium · 3 extra-hot)
 * + the degree label (خفيف / متوسط / حار جداً).
 *
 * Display-only: all logic (counts, labels) comes from menuHelpers.
 * Red pro styling in both modes (mirrors the `dark:`-variant pattern used
 * by the existing spicy pills, so no darkMode prop is needed).
 */
export const HeatPill: React.FC<HeatPillProps> = ({
  featureId,
  lang,
  size = 'sm',
  className = '',
}) => {
  const flames = spicyFlames(featureId);
  const label = spicyLabel(lang, featureId);
  const sizing =
    size === 'md'
      ? 'px-3 py-1 text-xs gap-1.5'
      : 'px-2 py-0.5 text-[11px] gap-1';
  const flameSize = size === 'md' ? 13 : 11;
  return (
    <span
      dir="auto"
      aria-label={label}
      className={`inline-flex items-center rounded-full font-bold border bg-red-600/10 text-red-600 border-red-600/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-400/30 ${sizing} ${className}`}
    >
      <span aria-hidden="true" className="inline-flex items-center gap-[1px]">
        {Array.from({ length: flames }).map((_, i) => (
          <Flame key={i} size={flameSize} className="fill-red-500/25" />
        ))}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
};
