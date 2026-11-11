import React from 'react';

interface MenuListEmptyStateProps {
  darkMode: boolean;
  isAr: boolean;
}

export const MenuListEmptyState: React.FC<MenuListEmptyStateProps> = ({
  darkMode,
  isAr,
}) => {
  return (
    <div className="py-16 px-5 text-center">
      <div className="w-16 h-16 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center mx-auto mb-3">
        🔍
      </div>
      <p className={`text-base font-semibold ${darkMode ? 'text-white/80' : 'text-neutral-700'}`}>
        {isAr ? 'لم يتم العثور على أصناف مطابقة لبحثك' : 'Nothing matches your search yet.'}
      </p>
      <p className={`text-xs mt-1 ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
        {isAr ? 'جرب كلمات أخرى أو اختر قسمًا آخر' : 'Try different words or pick another category.'}
      </p>
    </div>
  );
};
