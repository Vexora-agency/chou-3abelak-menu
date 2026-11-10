import React, { useState } from 'react';
import { Download, Monitor, Share, X } from 'lucide-react';
import { useInstallPrompt } from '@/src/hooks/useInstallPrompt';
import { isIosDevice, isStandaloneApp } from '@/src/utils/webpush';

interface InstallAppPromptProps {
  lang: 'en' | 'ar';
  /**
   * Mandatory mode (kitchen install gate): hides every skip path (the X
   * button and the "continue in the browser" link) — the prompt becomes
   * instructions-only. Optional mode keeps both skips (owner browsing).
   */
  mandatory?: boolean;
}

const DISMISS_KEY = 'kitchen_install_dismissed_v1';

/**
 * First-visit install nudge for the kitchen screen. Dismissal persists in
 * localStorage; an installed app never sees it. Install is always
 * optional — the panel works fully from the browser, and iOS forbids
 * programmatic install, so iPhone gets illustrated manual steps.
 */
export const InstallAppPrompt: React.FC<InstallAppPromptProps> = ({ lang, mandatory }) => {
  const isAr = lang === 'ar';
  // Mandatory mode never dismisses (kitchen gate): skip the persisted
  // dismissal entirely so the instructions always render.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (mandatory) return false;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [installed] = useState<boolean>(() => isStandaloneApp());
  const [installing, setInstalling] = useState(false);
  const { canInstall, install } = useInstallPrompt();

  if (dismissed || installed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {}
    setDismissed(true);
  };

  const onInstall = () => {
    setInstalling(true);
    void install().finally(() => setInstalling(false));
  };

  const ios = isIosDevice();

  return (
    <div
      className="mb-4 rounded-2xl border border-[var(--primary)]/40 bg-[var(--primary)]/[0.06] p-4"
      dir={isAr ? 'rtl' : 'ltr'}
      role="dialog"
      aria-label={isAr ? 'تثبيت شاشة المطبخ' : 'Install the kitchen screen'}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-black text-white">
          {isAr ? 'ثبّت شاشة المطبخ على الجهاز' : 'Install the kitchen screen'}
        </p>
        {!mandatory && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={isAr ? 'تخطي' : 'Dismiss'}
            className="shrink-0 w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {ios ? (
        /* iPhone/iPad: Apple forbids auto-install — manual Share steps only. */
        <ol className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-neutral-300">
          <li className="flex items-center gap-2">
            <Share size={14} className="shrink-0 text-[var(--primary)]" />
            {isAr
              ? '١. افتح هذه الصفحة في سفاري واضغط زر المشاركة'
              : '1. Open this page in Safari and tap Share'}
          </li>
          <li className="flex items-center gap-2">
            <Download size={14} className="shrink-0 text-[var(--primary)]" />
            {isAr
              ? '٢. اختر «إضافة للشاشة الرئيسية» ثم «إضافة»'
              : '2. Choose “Add to Home Screen”, then “Add”'}
          </li>
          <li className="flex items-center gap-2">
            <Download size={14} className="shrink-0 text-[var(--primary)]" />
            {isAr
              ? '٣. افتح أيقونة المطبخ الجديدة وفعّل التنبيهات من هناك'
              : '3. Open the new kitchen icon and enable alerts from there'}
          </li>
        </ol>
      ) : canInstall ? (
        /* Android Chrome / desktop Chromium: one-tap system install sheet. */
        <>
          <p className="mt-2 text-xs leading-relaxed text-neutral-400">
            {isAr
              ? 'أيقونة بملء الشاشة وتنبيهات أقوى — بضغطة واحدة:'
              : 'A full-screen icon with stronger alerts — in one tap:'}
          </p>
          <button
            type="button"
            onClick={onInstall}
            disabled={installing}
            className="btn-tactile mt-2.5 h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <Download size={15} />
            {installing
              ? (isAr ? 'جارٍ التثبيت…' : 'Installing…')
              : (isAr ? 'ثبّت الآن' : 'Install now')}
          </button>
        </>
      ) : (
        /* Desktop / other browsers without a deferred prompt: menu path. */
        <div className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-neutral-400">
          <Monitor size={14} className="shrink-0 mt-0.5 text-[var(--primary)]" />
          <p>
            {isAr
              ? 'من قائمة المتصفح (⋮) اختر «تثبيت» أو «إضافة للشاشة الرئيسية» لفتح المطبخ بملء الشاشة.'
              : 'From the browser menu (⋮) choose “Install” or “Add to Home screen” for a full-screen kitchen.'}
          </p>
        </div>
      )}

      {!mandatory && (
        <button
          type="button"
          onClick={dismiss}
          className="mt-2.5 text-[11px] font-bold text-neutral-500 hover:text-neutral-300 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded"
        >
          {isAr ? 'المتابعة من المتصفح بدون تثبيت' : 'Continue in the browser without installing'}
        </button>
      )}
    </div>
  );
};
