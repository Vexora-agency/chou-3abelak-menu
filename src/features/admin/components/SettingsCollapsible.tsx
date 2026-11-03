import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';

interface SettingsGroupHeaderProps {
  title: string;
  subtitle?: string;
  lang: 'en' | 'ar';
  collapsed: boolean;
  onToggle: () => void;
  /** Right-side control that stays visible when collapsed (switch, status pill). */
  action?: React.ReactNode;
}

/**
 * Collapsible settings card header in brand style: full-width toggle with a
 * gold chevron disc that rotates 180°. RTL-safe (flex order, no physical
 * left/right). Optional `action` (e.g. master switch, linked pill) stays
 * mounted and usable while the section is collapsed.
 */
export const SettingsGroupHeader: React.FC<SettingsGroupHeaderProps> = ({
  title,
  subtitle,
  lang,
  collapsed,
  onToggle,
  action,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex-1 min-w-0 flex items-center justify-between gap-3 text-start rounded-xl min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        <span className="min-w-0">
          <span className={`block text-sm font-extrabold text-[var(--primary)] truncate ${isAr ? '' : 'uppercase tracking-wider'}`}>
            {title}
          </span>
          {subtitle ? <span className="block text-[11px] text-neutral-500 mt-0.5">{subtitle}</span> : null}
        </span>
        <span className="shrink-0 w-8 h-8 rounded-full border border-[var(--primary)]/40 text-[var(--primary)] bg-[var(--primary)]/10 flex items-center justify-center">
          <ChevronDown size={15} className={`transition-transform duration-300 ${collapsed ? '' : 'rotate-180'}`} />
        </span>
      </button>
      {action}
    </div>
  );
};

/**
 * Animated collapsible body: height-auto tween + fade on the same 0.3s
 * curve as the order cards (GPU-cheap transform/height composite, no layout
 * thrash). Unmounted when closed, so heavy sections (live previews, polling
 * timers) cost zero while collapsed.
 */
export const SettingsGroupBody: React.FC<{ open: boolean; children: React.ReactNode }> = ({ open, children }) => (
  <AnimatePresence initial={false}>
    {open && (
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden"
      >
        <div className="space-y-4 pt-4">{children}</div>
      </motion.div>
    )}
  </AnimatePresence>
);
