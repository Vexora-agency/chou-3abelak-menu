import { useEffect, useState } from 'react';

/** beforeinstallprompt is NOT in TS DOM lib (and NOT on iOS Safari at all). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * One-tap install where the OS allows it (Android Chrome/Edge, desktop
 * Chrome/Edge): captures beforeinstallprompt and re-fires it from our own
 * button. iOS Safari never fires this event (Apple policy: Share menu only),
 * so `canInstall` stays false there and callers show manual steps instead.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') setDeferred(null);
      return choice.outcome;
    } catch {
      return 'dismissed';
    }
  };

  return { canInstall: deferred !== null, install };
}
