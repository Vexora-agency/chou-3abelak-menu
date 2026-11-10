import React, { useCallback, useEffect, useState } from 'react';
import { ChefHat } from 'lucide-react';
import { InstallAppPrompt } from './InstallAppPrompt';

interface KitchenInstallGateProps {
  lang: 'en' | 'ar';
}

/** Installed-PWA probe: standalone display mode (Android/desktop), the iOS
 *  `navigator.standalone` flag (Home Screen web clip), or an Android TWA
 *  referrer. Matches the `isStandaloneApp` check plus the TWA case. */
function isInstalledNow(): boolean {
  try {
    if (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {}
  try {
    if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  } catch {}
  try {
    if (typeof document !== 'undefined' && typeof document.referrer === 'string' && document.referrer.startsWith('android-app://')) return true;
  } catch {}
  return false;
}

/**
 * OWNER DECISION (explicit, do not soften): the kitchen board is usable
 * ONLY as an installed app — there is deliberately NO skip button. An
 * installed icon keeps the board full-screen, survives accidental tab
 * closes, and (on iPhone) is Apple's precondition for system alerts, so a
 * browser tab is not an acceptable kitchen setup. UX-only gate: every
 * server route enforces its own session checks regardless.
 *
 * Behaviour: full-screen blocker over the orders board until installed.
 * Re-probes automatically (the `appinstalled` event + every return to the
 * tab via visibilitychange/focus) so installing flips straight to the
 * board with no manual refresh. Returns null once installed.
 */
export const KitchenInstallGate: React.FC<KitchenInstallGateProps> = ({ lang }) => {
  const isAr = lang === 'ar';
  const [installed, setInstalled] = useState<boolean>(() => isInstalledNow());
  const recheck = useCallback(() => setInstalled(isInstalledNow()), []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    window.addEventListener('appinstalled', recheck);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', recheck);
    return () => {
      window.removeEventListener('appinstalled', recheck);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', recheck);
    };
  }, [recheck]);

  if (installed) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-[#0A0A0A] p-4 sm:p-6"
      dir={isAr ? 'rtl' : 'ltr'}
      role="alertdialog"
      aria-modal="true"
      aria-label={isAr ? 'التثبيت مطلوب' : 'Installation required'}
    >
      <div className="mx-auto max-w-md pt-10 sm:pt-16 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <div className="rounded-3xl border border-[var(--primary)]/40 bg-neutral-900 p-6 text-center">
          <span className="mx-auto w-14 h-14 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
            <ChefHat size={28} />
          </span>
          <h2 className="mt-4 text-lg font-black text-white">
            {isAr ? 'ثبّت شاشة المطبخ أولًا' : 'Install the kitchen screen first'}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-neutral-400">
            {isAr
              ? 'الطلبات لا تظهر في المتصفح — ثبّت الشاشة كتطبيق لتظهر بملء الشاشة وتصلك التنبيهات حتى والهاتف مقفل. لا يوجد زر تخطي: هذا شرط التشغيل.'
              : 'Orders do not appear in the browser — install the screen as an app for full-screen view and alerts even with the phone locked. There is no skip: this is required.'}
          </p>
        </div>
        <div className="mt-4">
          {/* Mandatory mode: instructions only, every skip path hidden. */}
          <InstallAppPrompt lang={lang} mandatory />
        </div>
      </div>
    </div>
  );
};
