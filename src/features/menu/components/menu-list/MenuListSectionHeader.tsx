import React from 'react';
import { SplitText } from '@/src/components/motion';
import '@/src/features/seasonal/xmas-accents.css';

interface MenuListSectionHeaderProps {
  title: string;
  darkMode: boolean;
  /** Item count pill (total in section, or filtered count while searching). */
  count?: number;
  /** Christmas theme on: frosty bar instead of the gold bar (same size). */
  festive?: boolean;
}

/** Shared category header used by every menu layout. */
export const MenuListSectionHeader: React.FC<MenuListSectionHeaderProps> = ({
  title,
  darkMode,
  count,
  festive = false,
}) => {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      {festive ? (
        <span
          className="xmas-stocking section-bar-in"
          aria-hidden="true"
        >
          <svg viewBox="0 0 26 36" fill="none" aria-hidden="true">
            {/* cuff */}
            <rect x="6" y="1.5" width="14" height="6.5" rx="3" fill="#F7F3EA" />
            <rect x="6" y="5.5" width="14" height="2.5" rx="1.2" fill="#D9E4EC" />
            {/* sock body */}
            <path
              d="M8 8h10v9.5l4.6 3.4c2.4 1.8 2.6 5.3.4 7.2-2 1.8-5.2 1.6-7.2-.2L8 22.4V8Z"
              fill="#C93333"
            />
            <path
              d="M8 8h10v9.5l4.6 3.4c2.4 1.8 2.6 5.3.4 7.2-.6.5-1.3.9-2 1.1C16.6 27 13 24.6 11.4 22L8 18.6V8Z"
              fill="#E04848"
            />
            {/* heel + toe patches */}
            <ellipse cx="9.5" cy="23.5" rx="3.4" ry="2.6" fill="#F7F3EA" transform="rotate(-18 9.5 23.5)" />
            <ellipse cx="19" cy="27.5" rx="3.6" ry="2.6" fill="#F7F3EA" transform="rotate(8 19 27.5)" />
          </svg>
        </span>
      ) : (
      <span
        className="w-1.5 h-6 bg-[var(--primary)] rounded-sm origin-center section-bar-in"
        aria-hidden="true"
      />
      )}
      <h2 className={`text-xl sm:text-2xl font-extrabold ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
        <SplitText text={title} stagger={45} />
      </h2>
      {typeof count === 'number' && (
        <span className={`text-[11px] font-extrabold tabular-nums px-2 py-0.5 rounded-full border ${darkMode ? 'text-neutral-400 border-neutral-800 bg-black/40' : 'text-neutral-600 border-neutral-200 bg-black/5'}`}>
          {count}
        </span>
      )}
    </div>
  );
};
