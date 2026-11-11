/**
 * Pages Functions root middleware — Sentry first, then request id + last-resort error log.
 *
 * Runs before every Function in this directory. Sentry.sentryPagesPlugin
 * captures unhandled throws (DSN-gated: without SENTRY_DSN it no-ops).
 * The app middleware below preserves the original contract exactly:
 * every request gets a short id (echoed as `x-request-id`) and an
 * unexpected throw becomes ONE structured JSON error line (see
 * _shared/log.js) plus a generic 500 — stack traces never reach clients.
 *
 * Zero behavioral change when Sentry is unconfigured or unreachable:
 * capture failures are swallowed so monitoring can never break a request.
 */
import * as Sentry from '@sentry/cloudflare';
import { logError } from './_shared/log.js';
import { captureBackendException, sentryPluginOptions } from './_shared/sentry.js';

function newReqId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  } catch {}
  try {
    return Math.random().toString(36).slice(2, 10);
  } catch {
    return 'noid';
  }
}

async function appMiddleware(context) {
  const reqId = newReqId();
  try {
    const res = await context.next();
    const out = new Response(res.body, res);
    try {
      out.headers.set('x-request-id', reqId);
    } catch {}
    return out;
  } catch (err) {
    // One console line for Workers Logs (existing behavior) + one Sentry
    // event. The response stays a generic 500 with the request id only.
    // Edge-text filter: a message that IS Cloudflare's own edge 500 text
    // ("internal error; reference = …") proves the failure happened
    // outside our code (a deploy cutover, an edge-node blip) — we never
    // construct that string. Log it locally but don't page Sentry for
    // someone else's outage; real bugs keep reporting as before.
    const msg = err instanceof Error ? err.message : String(err ?? '');
    const isEdgeNoise = /^internal error;\s*reference\s*=/i.test(msg.trim());
    const id = logError(context.request, err, { code: 'unhandled', status: 500, reqId });
    if (!isEdgeNoise) captureBackendException(context, err, { code: 'unhandled', reqId: id });
    return new Response(JSON.stringify({ error: 'unavailable', reqId: id }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-request-id': reqId },
    });
  }
}

// Sentry MUST be the first middleware so it sees every downstream throw.
export const onRequest = [Sentry.sentryPagesPlugin(sentryPluginOptions), appMiddleware];
