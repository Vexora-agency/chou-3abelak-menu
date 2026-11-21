import React from 'react';
import { Check } from 'lucide-react';

interface AddonPillProps {
  /** Localized add-on name (already resolved for the active language). */
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Live "selected add-on" pill, mirroring the HeatPill shape in the item
 * header. Deliberately one unified brand-gold treatment — the admin's
 * semantic section colors never reach the customer storefront, and heat has
 * its own red HeatPill.
 */
export const AddonPill: React.FC<AddonPillProps> = ({
  name,
  size = 'sm',
  className = '',
}) => {
  const sizing =
    size === 'md'
      ? 'px-3 py-1 text-xs gap-1.5'
      : 'px-2 py-0.5 text-[11px] gap-1';
  const iconSize = size === 'md' ? 13 : 11;
  return (
    <span
      dir="auto"
      title={name}
      className={`inline-flex max-w-full items-center rounded-full font-bold border bg-[var(--primary)]/10 text-[#8a6d00] border-[var(--primary)]/30 dark:bg-[var(--primary)]/10 dark:text-[var(--primary)] dark:border-[var(--primary)]/30 ${sizing} ${className}`}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 items-center">
        <Check size={iconSize} strokeWidth={3} />
      </span>
      <span className="min-w-0 truncate whitespace-nowrap">{name}</span>
    </span>
  );
};
