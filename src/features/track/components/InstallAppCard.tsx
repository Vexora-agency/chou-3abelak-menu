import React, { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { useInstallPrompt } from '@/src/hooks/useInstallPrompt';
import { isIosDevice, isStandaloneApp } from '@/src/utils/webpush';
import { PushSubscribeButton } from '../PushSubscribeButton';
import { readInstallDismissed, writeInstallDismissed } from './installCooldown';

interface InstallAppCardProps {
  orderNumber: number;
  trackToken: string;
  lang: 'en' | 'ar';
}

/**
 * Phase 2 install + push card (customer track page). Inline only — never a
 * popup, never steals focus. Step 1 installs the app (one-tap where the OS
 * offers `beforeinstallprompt`, numbered manual steps elsewhere); step 2 is
 * the existing PushSubscribeButton, hosted here so this page talks about
 * notifications in exactly one place — install first, subscribe second,
 * because on iOS a subscription only works inside the installed app.
 *
 * Hidden inside the installed app, after a real install, and for 7 days
 * after dismiss (no nagging footer — the card simply returns on expiry).
 */
export const InstallAppCard: React.FC<InstallAppCardProps> = ({ orderNumber, trackToken, lang }) => {
  const isAr = lang === 'ar';
  const { canInstall, install } = useInstallPrompt();
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => readInstallDismissed());
  // iOS Safari never fires beforeinstallprompt (Apple policy: Share menu
  // only) — capture the platform once so the manual steps read correctly.
  const [ios] = useState<boolean>(() => isIosDevice());

  // A real install hides the card at once, even if the OS sheet was
  // accepted while this tab was in the background.
  useEffect(() => {
    const onInstalled = () => setInstalled(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  if (isStandaloneApp() || installed || dismissed) return null;

  const onInstall = () => {
    if (installing) return;
    setInstalling(true);
    void install().then((outcome) => {
      setInstalling(false);
      if (outcome === 'accepted') setInstalled(true);
    });
  };

  const onDismiss = () => {
    writeInstallDismissed();
    setDismissed(true);
  };

  const steps: string[] = ios
    ? isAr
      ? [
          'اضغط «مشاركة» (Share) في سفاري.',
          'اختر «إضافة للشاشة الرئيسية» وأبقِ «يفتح كتطبيق ويب» مفعّلًا.',
          'افتح أيقونة التطبيق من الشاشة الرئيسية.',
        ]
      : [
          'Tap Share in Safari.',
          'Choose “Add to Home Screen” and keep “Open as Web App” ON.',
          'Open the new app icon from your Home Screen.',
        ]
    : isAr
      ? [
          'افتح قائمة المتصفح ( ⋮ ).',
          'اختر «تثبيت التطبيق» أو «إضافة للشاشة الرئيسية».',
          'افتح أيقونة التطبيق الجديدة.',
        ]
      : [
          'Open your browser menu ( ⋮ ).',
          'Choose “Install app” or “Add to Home screen”.',
          'Open the new app icon.',
        ];

  return (
    <section
      aria-labelledby="install-app-title"
      className="relative mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label={isAr ? 'إخفاء' : 'Dismiss'}
        className="btn-tactile absolute top-2 end-2 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-neutral-500 hover:text-neutral-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        <X size={16} />
      </button>

      <div className="flex items-start gap-2.5 pe-10">
        <span className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center bg-[var(--primary)]/10 text-[var(--primary)]">
          <Smartphone size={17} />
        </span>
        <div className="min-w-0">
          <h2 id="install-app-title" className="text-sm font-black text-white">
            {isAr ? 'تابع طلبك لحظة بلحظة' : 'Follow your order live'}
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-400">
            {isAr
              ? 'لتصلك تنبيهات طلبك حتى لو أغلقت المتصفح.'
              : 'Get your order alerts even with the browser closed.'}
          </p>
        </div>
      </div>

      {/* Step 1 — install (Latin numerals both languages: app-wide convention) */}
      <p className="mt-3 text-xs font-black text-white">
        {isAr ? '1 - ثبّت التطبيق' : '1 - Install the app'}
      </p>
      {canInstall ? (
        <button
          type="button"
          onClick={onInstall}
          disabled={installing}
          className="btn-tactile mt-2 w-full h-12 min-h-[48px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
        >
          <Download size={15} />
          {installing
            ? isAr
              ? 'جارٍ التثبيت…'
              : 'Installing…'
            : isAr
              ? 'ثبّت التطبيق (بنقرة واحدة)'
              : 'Install the app (one tap)'}
        </button>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-neutral-300">
              <span
                aria-hidden="true"
                className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-[11px] font-black flex items-center justify-center tabular-nums"
              >
                {i + 1}
              </span>
              <span className="min-w-0 break-words">{s}</span>
            </li>
          ))}
        </ol>
      )}
      {ios && (
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          {isAr
            ? 'ملاحظة: التطبيق المثبت يبدأ من جديد — فعّل التنبيه من داخله.'
            : 'Note: the installed app starts fresh — turn notifications on from inside it.'}
        </p>
      )}

      {/* Step 2 — subscribe this order (single home for push on this page) */}
      <p className="mt-3 text-xs font-black text-white">
        {isAr ? '2 - فعّل تنبيه الطلب' : '2 - Turn on order alerts'}
      </p>
      <div className="mt-2">
        <PushSubscribeButton orderNumber={orderNumber} trackToken={trackToken} lang={lang} darkMode />
      </div>
    </section>
  );
};
