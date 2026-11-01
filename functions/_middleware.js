/**
 * Pages Functions root middleware — request id + last-resort error log.
 *
 * Runs before every Function in this directory. Assigns each request a
 * short id (echoed back as `x-request-id`) and guarantees that an
 * unexpected throw becomes ONE structured JSON error line (see
 * _shared/log.js) plus a generic 500 — stack traces never reach clients.
 *
 * Zero dependencies. Pages Functions logs stream to the dashboard
 * (`wrangler pages deployment tail`); on the free plan they are NOT
 * stored, so this middleware only logs failures, never hot paths.
 */
import { logError } from './_shared/log.js';

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

export async function onRequest(context) {
  const reqId = newReqId();
  try {
    const res = await context.next();
    const out = new Response(res.body, res);
    try {
      out.headers.set('x-request-id', reqId);
    } catch {}
    return out;
  } catch (err) {
    const id = logError(context.request, err, { code: 'unhandled', status: 500, reqId });
    return new Response(JSON.stringify({ error: 'unavailable', reqId: id }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-request-id': reqId },
    });
  }
}
