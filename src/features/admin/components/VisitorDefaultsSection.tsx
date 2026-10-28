import React from 'react';
import type { MenuSettings } from '@/src/types/menu';

type VisitorDefaultsValues = Pick<MenuSettings, 'defaultTheme' | 'defaultLang'>;

interface VisitorDefaultsSectionProps extends VisitorDefaultsValues {
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: VisitorDefaultsValues) => VisitorDefaultsValues) => void;
}

/** New Visitor Defaults card of the admin Settings tab. */
export const VisitorDefaultsSection: React.FC<VisitorDefaultsSectionProps> = ({
  defaultTheme,
  defaultLang,
  lang,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div>
        <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
          {isAr ? 'الوضع الافتراضي للزوار الجدد' : 'New Visitor Defaults'}
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {isAr
            ? 'يطبق فقط على أول زيارة — اختيار العميل محفوظ دائماً'
            : 'First visit only — a returning visitor keeps their own choice'}
        </p>
      </div>
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'المظهر الافتراضي' : 'Default theme'}</label>
          <select
            value={defaultTheme === 'light' ? 'light' : 'dark'}
            onChange={(e) => onUpdate((prev) => ({ ...prev, defaultTheme: (e.target.value === 'light' ? 'light' : 'dark') }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          >
            <option value="dark">{isAr ? 'ليلي (افتراضي)' : 'Dark (default)'}</option>
            <option value="light">{isAr ? 'نهاري' : 'Light'}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'اللغة الافتراضية' : 'Default language'}</label>
          <select
            value={defaultLang === 'ar' ? 'ar' : 'en'}
            onChange={(e) => onUpdate((prev) => ({ ...prev, defaultLang: (e.target.value === 'ar' ? 'ar' : 'en') }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          >
            <option value="en">{isAr ? 'الإنجليزية (افتراضي)' : 'English (default)'}</option>
            <option value="ar">{isAr ? 'العربية' : 'Arabic'}</option>
          </select>
        </div>
      </div>
    </div>
  );
};
