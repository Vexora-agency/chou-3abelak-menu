/**
 * Backend Sentry helpers — Cloudflare Pages Functions (workerd).
 *
 * The SDK itself is initialized by `Sentry.sentryPagesPlugin` in
 * functions/_middleware.js (first middleware). This module only:
 *  - builds the plugin options from env (DSN-gated: no DSN = no-op),
 *  - scrubs customer PII out of every backend event,
 *  - offers captureBackendException() for caught 503/degraded paths so
 *    D1/KV/R2 failures are visible WITHOUT changing any response body.
 *
 * Never throws. When monitoring is down or unconfigured, every helper is
 * a silent no-op and the request path is untouched.
 */
import * as Sentry from '@sentry/cloudflare';

const SENSITIVE_KEY = /(password|passwd|pwd|secret|token|auth|session|cookie|credential|phone|mobile|email|address|whatsapp|track)/i;

function scrubValue(value, depth) {
  if (depth > 4) return '[Truncated]';
  if (typeof value === 'string') {
    if (/([?&](token|password|auth|session|t|key)=[^&\s]{3,})/i.test(value)) return '[Filtered URL]';
    return value.length > 2000 ? `${value.slice(0, 2000)}…[Truncated]` : value;
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[Filtered]' : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function routeOf(request) {
  try {
    const u = new URL(request.url);
    return `${request.method || 'GET'} ${u.pathname}`;
  } catch {
    return 'unknown route';
  }
}

function envText(env, key, fallback) {
  try {
    const v = env && typeof env[key] === 'string' ? env[key].trim() : '';
    return v || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Options factory for Sentry.sentryPagesPlugin(context => options).
 * Returns stable, PII-safe options. Missing DSN disables the SDK.
 */
export function sentryPluginOptions(context) {
  const env = (context && context.env) || {};
  const dsn = envText(env, 'SENTRY_DSN', '');
  const tracesRaw = envText(env, 'SENTRY_TRACES_SAMPLE_RATE', '0');
  const traces = Math.min(1, Math.max(0, Number.parseFloat(tracesRaw) || 0));
  return {
    // No DSN in any environment = SDK collects nothing, sends nothing.
    dsn: dsn || undefined,
    environment: envText(env, 'SENTRY_ENVIRONMENT', 'production').slice(0, 64),
    release: envText(env, 'SENTRY_RELEASE', '') || undefined,
    // Error monitoring only by default; raise via env when tracing is wanted.
    tracesSampleRate: traces,
    // Privacy-first collection: no user identity, no cookies/headers,
    // no bodies, no query params, no stack locals (order phones, session
    // cookies and track tokens must never leave the edge).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeSend(event) {
      try {
        if (event.request && event.request.url) {
          try {
            const u = new URL(event.request.url);
            event.request.url = `${u.origin}${u.pathname}`;
          } catch {
            event.request.url = '[Filtered URL]';
          }
        }
        if (event.request && event.request.query_string) delete event.request.query_string;
        if (event.request && event.request.cookies) event.request.cookies = '[Filtered]';
        if (event.request && event.request.headers) event.request.headers = '[Filtered]';
        if (event.request && event.request.data) event.request.data = '[Filtered]';
        if (event.user) delete event.user;
        if (event.breadcrumbs) {
          for (const crumb of event.breadcrumbs) {
            if (crumb.data) crumb.data = scrubValue(crumb.data, 0);
            if (typeof crumb.message === 'string') crumb.message = scrubValue(crumb.message, 0);
          }
        }
        if (event.contexts) event.contexts = scrubValue(event.contexts, 0);
        if (event.extra) event.extra = scrubValue(event.extra, 0);
      } catch {
        // Scrubbing must never drop the event itself.
      }
      return event;
    },
  };
}

/**
 * Report one caught backend failure (D1/KV/R2/5xx) without changing the
 * response. Single-send per call site — callers must NOT also rethrow to
 * the middleware for the same error (that path sends its own event).
 * Returns the request id for log correlation, or null when disabled.
 */
export function captureBackendException(context, err, info) {
  try {
    const env = (context && context.env) || {};
    if (!envText(env, 'SENTRY_DSN', '')) return null;
    const request = (context && context.request) || null;
    let reqId = '';
    try {
      reqId = (info && typeof info.reqId === 'string' && info.reqId) || (request && request.headers.get('x-request-id')) || '';
    } catch {
      reqId = '';
    }
    Sentry.withScope((scope) => {
      try {
        scope.setLevel((info && info.level) || 'error');
        scope.setTag('route', routeOf(request));
        if (reqId) scope.setTag('reqId', String(reqId).slice(0, 32));
        if (info && typeof info.binding === 'string') scope.setTag('binding', info.binding.slice(0, 16));
        if (info && typeof info.code === 'string') scope.setTag('code', info.code.slice(0, 64));
        if (info && info.test === true) scope.setTag('source', 'admin-test');
      } catch {}
      try {
        Sentry.captureException(err);
      } catch {}
    });
    return reqId || null;
  } catch {
    return null;
  }
}
