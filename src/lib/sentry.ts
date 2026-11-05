import * as Sentry from '@sentry/react';

/**
 * Frontend Sentry initialization — error monitoring only.
 *
 * Privacy rules (never relaxed):
 * - No secret token lives in the frontend: only the public DSN
 *   (VITE_SENTRY_DSN) is inlined at build time. SENTRY_AUTH_TOKEN stays
 *   in build-time secrets for source-map upload and never ships.
 * - No customer PII is sent: beforeSend scrubs passwords, tokens, emails,
 *   phones and addresses from events, breadcrumbs and URLs.
 * - Development builds never report: init is a no-op unless PROD + DSN.
 * - init never throws: a dead monitoring service must not break the menu.
 */

const SENSITIVE_KEY = /(password|passwd|pwd|secret|token|auth|session|cookie|credential|phone|mobile|email|address|whatsapp)/i;

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > 4) return '[Truncated]';
  if (typeof value === 'string') {
    // Redact query-string style secrets that slipped into a message/URL.
    if (/([?&](token|password|auth|session|t|key)=[^&\s]{3,})/i.test(value)) return '[Filtered URL]';
    return value.length > 2000 ? `${value.slice(0, 2000)}…[Truncated]` : value;
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[Filtered]' : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url, window.location.origin);
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) u.searchParams.set(key, '[Filtered]');
    }
    return u.toString();
  } catch {
    return '[Filtered URL]';
  }
}

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  const readDsn = (): string => {
    try {
      return (import.meta.env.VITE_SENTRY_DSN as string | undefined) || '';
    } catch {
      return '';
    }
  };
  const dsn = readDsn();
  // Dev / preview-local builds never report — production only.
  if (!dsn || !import.meta.env.PROD) return;
  try {
    Sentry.init({
      dsn,
      environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || 'production',
      release: (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) || undefined,
      // Error monitoring only: no tracing, no replay (keeps the bundle lean
      // and avoids collecting session data).
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      // Benign browser noise that is never an app bug.
      ignoreErrors: ['ResizeObserver loop completed with undelivered notifications'],
      beforeSend(event) {
        try {
          if (event.request?.url) event.request.url = scrubUrl(event.request.url);
          if (event.request?.headers) event.request.headers = scrubValue(event.request.headers, 0) as Record<string, string>;
          if (event.request?.cookies) event.request.cookies = { filtered: '[Filtered]' };
          // Never attach user identity from the storefront.
          if (event.user) delete event.user;
          if (event.breadcrumbs) {
            for (const crumb of event.breadcrumbs) {
              if (crumb.data) crumb.data = scrubValue(crumb.data, 0) as typeof crumb.data;
              if (crumb.message && typeof crumb.message === 'string') {
                crumb.message = scrubValue(crumb.message, 0) as string;
              }
            }
          }
          if (event.contexts) event.contexts = scrubValue(event.contexts, 0) as typeof event.contexts;
          if (event.extra) event.extra = scrubValue(event.extra, 0) as typeof event.extra;
        } catch {
          // Scrubbing must never drop the event itself.
        }
        return event;
      },
    });
  } catch {
    // Monitoring init failure is silent by design — the menu must work.
  }
}

/** Send one manually-caught frontend error (used by the admin test button). */
export function captureFrontendError(err: unknown, extra?: Record<string, string>): void {
  try {
    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setTag('source', 'admin-test');
      if (extra) {
        for (const [k, v] of Object.entries(extra)) scope.setTag(k, v);
      }
      Sentry.captureException(err);
    });
  } catch {
    // Never break the UI because monitoring is down.
  }
}
