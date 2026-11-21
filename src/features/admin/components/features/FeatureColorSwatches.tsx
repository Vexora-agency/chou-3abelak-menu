import React from 'react';
import { Check } from 'lucide-react';
import type { FeatureColorId } from '@/src/types/menu';
import { FEATURE_COLORS } from '@/src/utils/featureColors';

interface FeatureColorSwatchesProps {
  value?: FeatureColorId;
  onChange: (color?: FeatureColorId) => void;
  isAr: boolean;
  /** sm = compact picker inside a feature row; md = section picker. */
  size?: 'sm' | 'md';
}

/**
 * Shared admin color swatches. Swatches carry no visible names and no
 * tooltips — the admin simply sees the color. A numbered aria-label keeps
 * the control usable with a screen reader.
 */
export const FeatureColorSwatches: React.FC<FeatureColorSwatchesProps> = ({
  value,
  onChange,
  isAr,
  size = 'md',
}) => {
  const compact = size === 'sm';
  const swatchSize = compact ? 'h-7 w-7' : 'h-8 w-8';
  const iconSize = compact ? 12 : 14;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange(undefined)}
        className={`${compact ? 'h-7' : 'h-8'} rounded-full border px-2.5 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
          !value
            ? 'border-white/70 text-white'
            : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'
        }`}
      >
        {isAr ? 'بدون' : 'None'}
      </button>
      {FEATURE_COLORS.map((color, index) => {
        const selected = value === color.id;
        const label = isAr ? `لون ${index + 1}` : `Color ${index + 1}`;
        return (
          <button
            key={color.id}
            type="button"
            aria-label={label}
            aria-pressed={selected}
            onClick={() => onChange(color.id)}
            className={`relative inline-flex ${swatchSize} items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] after:absolute after:-inset-1.5 after:content-[''] ${color.swatch} ${
              selected
                ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-900'
                : 'ring-1 ring-black/20'
            }`}
          >
            {selected && (
              <Check size={iconSize} strokeWidth={3} className={color.check} aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
};
