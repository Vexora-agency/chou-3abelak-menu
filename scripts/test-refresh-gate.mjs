/**
 * Regression test for the focus/visibility request storm (refreshGate).
 * Context: every window focus (iOS keyboard show/hide per input, app
 * switches, toolbar toggles) used to fire an immediate /api/menu +
 * /api/ordering-state (+ N track) fetch AND reset the 120 s fast window,
 * so normal phone tapping pinned 5 s polling and produced 200+ requests
 * in minutes. The gate coalesces ambient event refreshes to one per
 * window per channel, never while hidden. Scheduled pollers are untouched.
 * Run: node scripts/test-refresh-gate.mjs
 */
import { markFetchStart, shouldEventFetch } from '../src/utils/refreshGate.ts';

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; } else { fail++; console.error(`FAIL ${n} ${x}`); } };

// 1. First ambient refresh is allowed (cold start, no prior fetch).
ok(shouldEventFetch('t-cold', 15000) === true, 'cold event fetch allowed');

// 2. Immediate repeat is throttled (tap-storm collapses to one).
markFetchStart('t-storm');
ok(shouldEventFetch('t-storm', 15000) === false, 'burst repeat throttled');
ok(shouldEventFetch('t-storm', 0) === true, 'zero window disables throttle');

// 3. Scheduled ticks stamp the same clock, so events dedupe against them:
//    a tick 1 s ago means a focus event right now is redundant.
markFetchStart('t-tick');
ok(shouldEventFetch('t-tick', 15000) === false, 'event dedupes against fresh tick');

// 4. Hidden pages never fetch on events (pure waste + invisible anyway).
const realDoc = globalThis.document;
globalThis.document = { visibilityState: 'hidden' };
try {
  ok(shouldEventFetch('t-hidden', 15000) === false, 'hidden page never event-fetches');
} finally {
  if (realDoc === undefined) delete globalThis.document;
  else globalThis.document = realDoc;
}

// 5. Genuine returns still refresh: stub Date.now past the window.
const realNow = Date.now;
try {
  markFetchStart('t-stale');
  Date.now = () => realNow() + 60000;
  ok(shouldEventFetch('t-stale', 15000) === true, 'stale return refreshes immediately');
} finally {
  Date.now = realNow;
}

// 6. Channels are independent (menu storm must not block ordering).
markFetchStart('t-a');
ok(shouldEventFetch('t-b', 15000) === true, 'channels are independent');

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
