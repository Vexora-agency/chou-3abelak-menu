// Customer-facing order-progress phases (bell + track page must agree).
// Run: tsx scripts/test-track-phases.mjs
import {
  CUSTOMER_CANCEL_WINDOW_MS,
  cancelWindowEndsAt,
  cancelWindowRemainingMs,
  isInCancelWindow,
} from '../src/features/track/orderPhases.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
};

const T0 = Date.parse('2026-11-04T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

ok('cancel window is 5 min', CUSTOMER_CANCEL_WINDOW_MS === 5 * 60 * 1000);

// Ends-at math.
{
  // endsAt ignores nowMs — recompute directly for clarity.
  const end = cancelWindowEndsAt(iso(T0));
  ok(end === T0 + 5 * 60 * 1000, 'window ends 5 min after creation');
  ok(cancelWindowEndsAt(null) === null, 'missing createdAt -> null (static phase-2 copy)');
  ok(cancelWindowEndsAt('garbage') === null, 'unparseable createdAt -> null');
}

// Remaining + phase gating.
{
  const fresh = iso(T0 - 60 * 1000); // 1 min old
  const r = cancelWindowRemainingMs(fresh, T0);
  ok(r !== null && r > 0 && r <= 4 * 60 * 1000 + 1000, 'fresh order has positive remaining');
  ok(isInCancelWindow('new', fresh, T0) === true, 'fresh new order is in phase 1');

  const stale = iso(T0 - 10 * 60 * 1000); // 10 min old
  ok(cancelWindowRemainingMs(stale, T0) !== null && cancelWindowRemainingMs(stale, T0) <= 0, 'elapsed window is not positive');
  ok(isInCancelWindow('new', stale, T0) === false, 'elapsed new order drops to phase 2');

  ok(isInCancelWindow('new', null, T0) === false, 'unknown createdAt is phase 2 (never blocks on countdown)');
  ok(isInCancelWindow('new', 'garbage', T0) === false, 'garbage createdAt is phase 2');
  ok(isInCancelWindow('confirmed', fresh, T0) === false, 'confirmed never uses the cancel copy');
  ok(isInCancelWindow('ready', fresh, T0) === false, 'ready never uses the cancel copy');
  ok(isInCancelWindow('completed', fresh, T0) === false, 'completed never uses the cancel copy');
}

// Boundary: exactly at the deadline the window is over (button copy flips,
// backend gate uses strict <, so the client must agree).
{
  const edge = iso(T0 - 5 * 60 * 1000);
  ok(isInCancelWindow('new', edge, T0) === false, 'exact deadline counts as elapsed');
}

console.log(`track-phases: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
