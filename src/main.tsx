import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/src/App.tsx';
import { applyTheme } from '@/src/config/theme.config';
import { captureFrontendError, initSentry } from '@/src/lib/sentry';
import { recoverFromChunkError, reloadFresh } from '@/src/utils/lazyRetry';
import { initMotionRuntime } from '@/src/lib/motion';
import './index.css';

// Premium motion runtime first: Lenis + the reveal observer must be armed
// before React's first commit, so no above-the-fold section ever flashes.
// GSAP itself is deferred to idle inside the runtime.
initMotionRuntime();

// Error monitoring first (no-op without VITE_SENTRY_DSN in production).
// initSentry loads the Sentry SDK in a background chunk only when PROD + DSN;
// otherwise this whole path costs zero bytes in the main bundle.
initSentry();

// White-label theme: push themeConfig onto :root before first render (no flash).
applyTheme();

/** Bilingual crash fallback: generic message only, never internal details. */
function CrashFallback() {
  return (
    <div
      role="alert"
      className="min-h-screen min-h-dvh bg-[#0A0A0A] text-white flex flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p className="text-lg font-extrabold">Something went wrong / حدث خطأ ما</p>
      <p className="text-sm text-neutral-400">Please reload the page / يرجى إعادة تحميل الصفحة</p>
      <button
        type="button"
        onClick={() => reloadFresh()}
        className="h-11 px-6 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold"
      >
        Reload / إعادة التحميل
      </button>
    </div>
  );
}

/**
 * Lightweight local error boundary: identical crash UI to the old
 * Sentry.ErrorBoundary (same fallback, same reload contract). Caught errors
 * are forwarded to Sentry only when its background chunk actually loaded —
 * without a DSN this is a pure no-op, matching the old behavior exactly.
 */
class LocalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    captureFrontendError(error);
    // Defense in depth: a chunk import that bypassed lazyWithReload still gets
    // one automatic cache-busting reload instead of the permanent crash card.
    recoverFromChunkError(error);
  }

  render(): ReactNode {
    if (this.state.hasError) return <CrashFallback />;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <LocalErrorBoundary>
    <App />
  </LocalErrorBoundary>
);
