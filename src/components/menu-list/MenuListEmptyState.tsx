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
      <div className="w-16 h-16 rounded-full bg-[#FFC400]/10 text-[#FFC400] flex items-center justify-center mx-auto mb-3">
        🔍
      </div>
      <p className={`text-base font-semibold ${darkMode ? 'text-white/80' : 'text-neutral-700'}`}>
        {isAr ? 'لم يتم العثور على وجبات مطابقة لبحثك' : 'Nothing matches your search yet.'}
      </p>
      <p className="text-xs text-neutral-500 mt-1">
        {isAr ? 'جرب كلمات أخرى أو اختر قسماً آخر' : 'Try different words or pick another category.'}
      </p>
    </div>
  );
};
