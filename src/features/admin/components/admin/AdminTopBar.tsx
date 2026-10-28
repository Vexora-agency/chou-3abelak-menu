import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Globe } from 'lucide-react';

export type AdminTab = 'dashboard' | 'settings' | 'categories' | 'items' | 'backup';

interface AdminTopBarProps {
  lang: 'en' | 'ar';
  onClose: () => void;
  saveSuccess: boolean;
  onToggleLang?: () => void;
  autoSave: boolean;
  onToggleAutoSave: () => void;
  onSignOut?: () => void;
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}

/** Sticky top bar + tab switcher of the admin panel. */
export const AdminTopBar: React.FC<AdminTopBarProps> = ({
  lang, onClose, saveSuccess, onToggleLang, autoSave, onToggleAutoSave,
  onSignOut, activeTab, onTabChange,
}) => {
  const isAr = lang === 'ar';
  return (
    <>
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2 pb-4 border-b border-neutral-800 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-sm font-bold text-[var(--primary)] hover:underline shrink-0"
        >
          <ArrowLeft size={16} className="rtl:rotate-180 shrink-0" />
          <span className="hidden min-[480px]:inline">{isAr ? 'العودة للموقع الرئيسي' : 'Back to Live Menu'}</span>
          <span className="min-[480px]:hidden">{isAr ? 'رجوع' : 'Back'}</span>
        </button>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {saveSuccess && (
            <span className="flex items-center gap-1 text-xs text-green-400 font-bold">
              <Check size={14} /> {isAr ? 'تم الحفظ!' : 'Saved!'}
            </span>
          )}
          {onToggleLang && (
            <button
              type="button"
              onClick={onToggleLang}
              aria-label={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
              title={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
              className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-[var(--primary)] hover:border-[var(--primary)]/60 transition-colors whitespace-nowrap shrink-0"
            >
              <Globe size={14} />
              <span>{isAr ? 'EN' : 'عربي'}</span>
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={autoSave}
            aria-label={isAr ? 'الحفظ التلقائي' : 'Auto-save'}
            title={isAr ? 'حفظ تلقائي لكل تعديل' : 'Auto-save every change'}
            onClick={onToggleAutoSave}
            className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border transition-colors cursor-pointer whitespace-nowrap shrink-0"
            style={{ borderColor: autoSave ? 'var(--primary)' : '#3f3f46', color: autoSave ? 'var(--primary)' : '#a1a1aa' }}
          >
            <span
              className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${autoSave ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}
            >
              <span
                className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all duration-200 ${autoSave ? 'left-[18px]' : 'left-[2px]'}`}
              />
            </span>
            <span>{isAr ? 'حفظ تلقائي' : 'Auto-save'}</span>
          </button>
          {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="text-xs px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-400/60 transition-colors font-bold whitespace-nowrap shrink-0"
          >
            {isAr ? 'خروج' : 'Sign out'}
          </button>
          )}
        </div>
      </div>

      <h1 className="text-2xl font-black mt-4 mb-2 flex items-center gap-2.5">
        <img
          src="/assets/pan-icon-yellow.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="w-8 h-8 object-contain -rotate-12"
        />
        <span>{isAr ? 'إدارة قائمة الطعام' : 'Menu Management'}</span>
      </h1>

      {/* Tabs */}
      <div className="flex gap-1.5 p-1 bg-neutral-900 rounded-2xl border border-neutral-800 mt-4 mb-6 overflow-x-auto no-scrollbar">
        {(['dashboard', 'settings', 'categories', 'items', 'backup'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`relative flex-1 whitespace-nowrap px-3 py-2 rounded-xl text-xs font-bold capitalize transition-colors ${
              activeTab === tab
                ? 'text-[#0A0A0A]'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {activeTab === tab && <motion.span layoutId="admin-tab" className="absolute inset-0 rounded-xl bg-[var(--primary)] shadow-md" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="relative z-10">
            {tab === 'dashboard' && (isAr ? 'الطلبات' : 'Dashboard')}
            {tab === 'settings' && (isAr ? 'الإعدادات' : 'Settings')}
            {tab === 'categories' && (isAr ? 'الأقسام' : 'Categories')}
            {tab === 'items' && (isAr ? 'الوجبات' : 'Items')}
            {tab === 'backup' && (isAr ? 'النسخ الاحتياطي' : 'Backup')}
            </span>
          </button>
        ))}
      </div>
    </>
  );
};
