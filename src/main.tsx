import {createRoot} from 'react-dom/client';
import App from '@/src/App.tsx';
import { applyTheme } from '@/src/config/theme.config';
import { scheduleIdle } from '@/src/utils/scheduleIdle';
import './index.css';

// White-label theme: push themeConfig onto :root before first render (no flash).
applyTheme();

createRoot(document.getElementById('root')!).render(<App />);

// Boosthis web kit — deferred until after first paint (idle, 2.5 s ceiling).
// None of it is needed for the first frame, and the static import used to
// pull the whole runtime (vitals + telemetry + snapshot) into the main chunk,
// paying its parse + eval on the critical path. The dynamic import below also
// code-splits it into its own chunk. Everything keeps working, only later:
// startWebVitals observes *buffered* performance entries, so load-time entries
// are still collected when it starts late; telemetry registration and the
// snapshot uploader only report afterwards and lose nothing by the delay.
scheduleIdle(() => {
  void import('@workspace/boosthis-runtime-web').then(
    ({ startWebVitals, registerWebRoutes, enableTelemetry, startSnapshotAutoUpload }) => {
      try {
        // Measures real browser Web Vitals per page.
        // Project key comes from VITE_BOOSTHIS_PROJECT_KEY at build time (never committed).
        // Without a key the app measures on-device only and never appears on the dashboard.
        startWebVitals({ bubble: true });

        // Single-page app: one route. The badge counts registered-but-unopened routes.
        registerWebRoutes(['/']);

        enableTelemetry({
          installId: '597c7587-b144-4ed6-a717-ff8f80e76d1',
          inviteKey: import.meta.env.VITE_BOOSTHIS_PROJECT_KEY,
          endpoint: 'https://www.boosthis.com/api',
          appName: 'Chou 3abelak',
        });

        // Periodically upload the PII-filtered meter snapshot for the AI live-read path.
        startSnapshotAutoUpload();
      } catch {
        // Measuring must never crash the host page.
      }
    },
  ).catch(() => {
    // Offline or chunk fetch failed: the menu works fully without measuring.
  });
}, 2500);
