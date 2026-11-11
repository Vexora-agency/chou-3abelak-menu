/**
 * Frontend Sentry initialization — error monitoring only.
 *
 * Lazy by design: `@sentry/react` is dynamically imported ONLY when the build
 * actually reports (PROD + VITE_SENTRY_DSN). Without a DSN (or in dev) this
 * module ships zero Sentry code in the main chunk — the SDK lives in its own
 * async chunk that the customer bundle never downloads. Every export below is
 * a no-op until the SDK chunk arrives, so behavior without a DSN is identical
 * to the old static path (nothing captured, nothing thrown).
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

type SentryModule = typeof import('@sentry/react');

/** SDK module once its async chunk has loaded (null = not loaded / no DSN). */
let sentryModule: SentryModule | null = null;
let loadPromise: Promise<SentryModule | null> | null = null;

function loadSentry(): Promise<SentryModule | null> {
  if (sentryModule) return Promise.resolve(sentryModule);
  if (!loadPromise) {
    loadPromise = import('@sentry/react').then(
      (m) => (sentryModule = m),
      () => null,
    );
  }
  return loadPromise;
}

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

function readDsn(): string {
  try {
    return (import.meta.env.VITE_SENTRY_DSN as string | undefined) || '';
  } catch {
    return '';
  }
}

function readEnvName(): string {
  try {
    return (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || 'production';
  } catch {
    return 'production';
  }
}

/** True when the SDK client actually initialized (not just DSN present). */
export function isSentryActive(): boolean {
  try {
    return Boolean(sentryModule?.getClient());
  } catch {
    return false;
  }
}
/** Honest client-side status: is the storefront SDK actually reporting? */
export function frontendSentryStatus(): { enabled: boolean; environment: string } {
  try {
    return { enabled: Boolean(readDsn() && import.meta.env.PROD), environment: readEnvName() };
  } catch {
    return { enabled: false, environment: 'production' };
  }
}

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  const dsn = readDsn();
  const envName = readEnvName();
  // Dev / preview-local builds never report — production only.
  if (!dsn || !import.meta.env.PROD) return;
  // Async on purpose: the SDK chunk downloads in the background, first paint
  // never waits for it. initSentry() itself stays synchronous (same call site
  // in main.tsx), only the SDK load + init defer.
  void loadSentry().then((m) => {
    if (!m) return;
    try {
      m.init({
        dsn,
        environment: envName,
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
  });
}

/** Send one manually-caught frontend error. Returns the Sentry event id, or null when it could not be captured. */
export function captureFrontendError(err: unknown, extra?: Record<string, string>): string | null {
  try {
    // SDK chunk absent (no DSN, dev, or still downloading): no-op, same as the
    // old static path where capture without init went nowhere.
    if (!sentryModule) return null;
    let eventId: string | null = null;
    const m = sentryModule;
    m.withScope((scope) => {
      scope.setLevel('error');
      scope.setTag('source', 'admin-test');
      if (extra) {
        for (const [k, v] of Object.entries(extra)) scope.setTag(k, v);
      }
      eventId = m.captureException(err);
    });
    return typeof eventId === 'string' && eventId ? eventId : null;
  } catch {
    // Never break the UI because monitoring is down.
    return null;
  }
}
