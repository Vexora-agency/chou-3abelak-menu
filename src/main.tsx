import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from '@/src/App.tsx';
import { applyTheme } from '@/src/config/theme.config';
import { initSentry } from '@/src/lib/sentry';
import './index.css';

// Error monitoring first (no-op without VITE_SENTRY_DSN in production).
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
        onClick={() => window.location.reload()}
        className="h-11 px-6 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold"
      >
        Reload / إعادة التحميل
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <Sentry.ErrorBoundary fallback={<CrashFallback />}>
    <App />
  </Sentry.ErrorBoundary>
);
