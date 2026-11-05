import tailwindcss from '@tailwindcss/vite';
import {sentryVitePlugin} from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  // Source maps upload to Sentry only when the build secret is present
  // (SENTRY_AUTH_TOKEN lives in build-time secrets, never in the bundle).
  // Maps are 'hidden' (no public comment) and deleted after upload so the
  // deployed dist carries no map files.
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || '';
  const sentryEnabled = Boolean(sentryAuthToken);
  return {
    build: {
      sourcemap: sentryEnabled ? ('hidden' as const) : false,
    },
    plugins: [
      react(),
      tailwindcss(),
      ...(sentryEnabled
        ? [
            sentryVitePlugin({
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              authToken: sentryAuthToken,
              release: process.env.SENTRY_RELEASE ? { name: process.env.SENTRY_RELEASE } : undefined,
              sourcemaps: {
                filesToDeleteAfterUpload: ['./dist/**/*.map'],
              },
              telemetry: false,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
