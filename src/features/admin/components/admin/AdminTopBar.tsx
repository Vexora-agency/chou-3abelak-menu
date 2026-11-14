import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Globe, LogOut } from 'lucide-react';
import { featuresConfig } from '@/src/config/features.config';

export type AdminTab = 'dashboard' | 'settings' | 'categories' | 'libraries' | 'items' | 'backup';

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
  /** Kitchen session: show the orders tab alone (UX only). */
  kitchenOnly?: boolean;
}

/** Sticky top bar + tab switcher of the admin panel. */
export const AdminTopBar: React.FC<AdminTopBarProps> = ({
  lang, onClose, saveSuccess, onToggleLang, autoSave, onToggleAutoSave,
  onSignOut, activeTab, onTabChange, kitchenOnly,
}) => {
  const isAr = lang === 'ar';
  return (
    <>
      {/* Top Bar */}
      <div className="sticky top-0 z-30 bg-[#0A0A0A]/95 backdrop-blur pb-4 pt-[env(safe-area-inset-top)] border-b border-neutral-800 overflow-x-auto no-scrollbar">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-sm font-bold text-[var(--primary)] hover:underline shrink-0 min-h-[44px] px-2 -mx-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded-lg"
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
              className="flex items-center gap-1.5 text-xs font-bold px-3 min-h-[44px] min-w-[44px] rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-[var(--primary)] hover:border-[var(--primary)]/60 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <Globe size={14} />
              <span>{isAr ? 'EN' : 'عربي'}</span>
            </button>
          )}
          {!kitchenOnly && (
          <button
            type="button"
            role="switch"
            aria-checked={autoSave}
            aria-label={isAr ? 'الحفظ التلقائي' : 'Auto-save'}
            title={isAr ? 'حفظ تلقائي لكل تعديل' : 'Auto-save every change'}
            onClick={onToggleAutoSave}
            className="flex items-center gap-1.5 text-xs font-bold px-3 min-h-[44px] rounded-full border transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
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
          )}
          {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            aria-label={isAr ? 'تسجيل الخروج' : 'Sign out'}
            title={isAr ? 'تسجيل الخروج' : 'Sign out'}
            className="w-11 h-11 min-w-[44px] min-h-[44px] sm:w-auto sm:px-3 inline-flex items-center justify-center gap-1.5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-400/60 transition-colors font-bold whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <LogOut size={16} aria-hidden="true" />
            <span className="hidden sm:inline text-xs">{isAr ? 'تسجيل الخروج' : 'Sign out'}</span>
          </button>
          )}
        </div>
      </div>
      </div>

      <h1 className="text-2xl font-black mt-4 mb-2 flex items-center gap-2.5">
        <img
          src="/assets/pan-icon-yellow-192.webp"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="w-8 h-8 object-contain -rotate-12"
        />
        {/* Kitchen session: its own title, never "Menu Management". */}
        <span>{kitchenOnly ? (isAr ? 'المطبخ' : 'Kitchen') : (isAr ? 'إدارة القائمة' : 'Menu Management')}</span>
        {/* Client's sold plan (from features.config `plan`, set by the setup
            script — keep SITE_PLAN in sync on rebuild). Gold for pro, gray
            for starter. Kitchen never sees plan info. */}
        {!kitchenOnly && (
        <span
          title={isAr ? 'باقة العميل' : 'Client plan'}
          className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${isAr ? '' : 'uppercase tracking-wider'} ${
            featuresConfig.plan === 'pro'
              ? 'bg-[var(--primary)] text-[#0A0A0A] border-[var(--primary)]'
              : 'bg-neutral-800 text-neutral-300 border-neutral-700'
          }`}
        >
          {featuresConfig.plan === 'pro'
            ? (isAr ? 'برو' : 'Pro')
            : (isAr ? 'ستارتر' : 'Starter')}
        </span>
        )}
      </h1>

      {/* Tabs (Backup hidden on starter — backend 404s it too).
          Mobile shows a 3×2 grid so every tab is visible with no hidden
          horizontal scroll; sm+ keeps the single scrollable row.
          Kitchen has a single screen, so the whole switcher is hidden —
          no stray single "Orders" tab under the title. */}
      {!kitchenOnly && (
      <div className="grid grid-cols-3 sm:flex gap-1.5 p-1 bg-neutral-900 rounded-2xl border border-neutral-800 mt-4 mb-6 sm:overflow-x-auto no-scrollbar">
        {(['dashboard', 'settings', ...(featuresConfig.enableBackup ? ['backup'] as const : []), 'categories', 'libraries', 'items'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`relative min-w-0 sm:flex-1 whitespace-nowrap px-2 sm:px-3 min-h-[44px] inline-flex items-center justify-center rounded-xl text-xs font-bold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
              activeTab === tab
                ? 'text-[#0A0A0A]'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {activeTab === tab && <motion.span layoutId="admin-tab" className="absolute inset-0 rounded-xl bg-[var(--primary)] shadow-md" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="relative z-10 truncate">
            {/* Owner tabs (the switcher above renders owner-only). */}
            {tab === 'dashboard' && (isAr ? 'الطلبات' : 'Dashboard')}
            {tab === 'settings' && (isAr ? 'الإعدادات' : 'Settings')}
            {tab === 'categories' && (isAr ? 'الأقسام' : 'Categories')}
            {tab === 'libraries' && (isAr ? 'المكتبات' : 'Libraries')}
            {tab === 'items' && (isAr ? 'الأصناف' : 'Items')}
            {tab === 'backup' && (isAr ? 'النسخ الاحتياطي' : 'Backup')}
            </span>
          </button>
        ))}
      </div>
      )}
    </>
  );
};
