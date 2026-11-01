/**
 * Structured error logging — zero dependencies, Workers Logs friendly.
 *
 * Workers Logs indexes JSON objects (developers.cloudflare.com/workers/
 * observability/logs/workers-logs, fetched 2026-11-01). Log ONE line per
 * failure: no bodies, no query strings, no headers, no customer data —
 * message text is truncated to 200 chars. A request id (set by
 * functions/_middleware.js) lets one failure be traced across the
 * dashboard, the health pinger, and an owner report.
 *
 * Free plan: 200,000 events/day, 3-day retention. This app emits logs
 * only on failures (never per request), so normal traffic costs ~zero.
 */

function safeMessage(err) {
  try {
    const m = err && (err.message || err);
    const s = typeof m === 'string' ? m : JSON.stringify(m);
    return String(s || 'unknown').slice(0, 200);
  } catch {
    return 'unknown';
  }
}

function routeOf(request) {
  try {
    const u = new URL(request.url);
    return `${request.method || 'GET'} ${u.pathname}`;
  } catch {
    return 'unknown route';
  }
}

/**
 * Log a server-side failure as one JSON line. Returns the request id so
 * routes can echo it back in the 500 body for owner correlation.
 */
export function logError(request, err, extra) {
  let reqId = '';
  try {
    reqId = (extra && typeof extra.reqId === 'string' && extra.reqId) || (request && request.headers.get('x-request-id')) || '';
  } catch {}
  if (!reqId) {
    try {
      reqId = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).slice(0, 8);
    } catch {
      reqId = 'noid';
    }
  }
  const entry = {
    level: 'error',
    ts: new Date().toISOString(),
    reqId,
    route: routeOf(request),
    message: safeMessage(err),
  };
  if (extra && typeof extra === 'object') {
    if (typeof extra.code === 'string') entry.code = extra.code.slice(0, 64);
    if (Number.isInteger(extra.status)) entry.status = extra.status;
  }
  try {
    console.error(JSON.stringify(entry));
  } catch {}
  return reqId;
}
