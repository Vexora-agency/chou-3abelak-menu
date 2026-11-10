// Customer-facing order-progress phases (bell + track page must agree).
// Run: tsx scripts/test-track-phases.mjs
import {
  CUSTOMER_CANCEL_WINDOW_MS,
  cancelWindowEndsAt,
  cancelWindowMinOrDefault,
  cancelWindowMsFromMenu,
  cancelWindowMsFromOrdering,
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

// Owner-tunable window: helpers accept the window as a parameter, with the
// 5-minute constant as the default for backwards compatibility.
{
  const tenMin = 10 * 60 * 1000;
  const fresh = iso(T0 - 7 * 60 * 1000); // 7 min old: outside 5, inside 10
  ok(isInCancelWindow('new', fresh, T0) === false, 'default window still 5 min');
  ok(isInCancelWindow('new', fresh, T0, tenMin) === true, 'custom 10 min window keeps it in phase 1');
  ok(cancelWindowEndsAt(fresh, tenMin) === T0 - 7 * 60 * 1000 + tenMin, 'endsAt honors the custom window');
  ok(cancelWindowRemainingMs(fresh, T0, tenMin) === 3 * 60 * 1000, 'remaining honors the custom window');
  const stale = iso(T0 - 11 * 60 * 1000);
  ok(isInCancelWindow('new', stale, T0, tenMin) === false, 'custom window still expires');
}

// Clamp + fallback: 1..30 min whole minutes, zero/blank/garbage = 5.
{
  ok(cancelWindowMinOrDefault(undefined) === 5, 'missing window falls back to 5');
  ok(cancelWindowMinOrDefault(0) === 5, 'zero window falls back to 5');
  ok(cancelWindowMinOrDefault(null) === 5, 'null window falls back to 5');
  ok(cancelWindowMinOrDefault('ten') === 5, 'non-number window falls back to 5');
  ok(cancelWindowMinOrDefault(-3) === 5, 'negative window falls back to 5');
  ok(cancelWindowMinOrDefault(31) === 5, 'window above 30 falls back to 5');
  ok(cancelWindowMinOrDefault(1) === 1, 'window keeps lower bound 1');
  ok(cancelWindowMinOrDefault(30) === 30, 'window keeps upper bound 30');
  ok(cancelWindowMinOrDefault(10) === 10, 'window keeps tuned value');
  ok(cancelWindowMinOrDefault(7.6) === 8, 'window rounds to whole minutes');
  ok(cancelWindowMsFromOrdering({ cancelWindowMin: 10 }) === 10 * 60 * 1000, 'ordering block resolves to ms');
  ok(cancelWindowMsFromOrdering(null) === 5 * 60 * 1000, 'garbage ordering falls back to 5 min');
  ok(cancelWindowMsFromOrdering({}) === 5 * 60 * 1000, 'missing key falls back to 5 min');
  ok(cancelWindowMsFromMenu({ settings: { ordering: { cancelWindowMin: 10 } } }) === 10 * 60 * 1000, 'menu doc resolves to ms');
  ok(cancelWindowMsFromMenu(null) === 5 * 60 * 1000, 'missing menu falls back to 5 min');
  ok(cancelWindowMsFromMenu({ settings: {} }) === 5 * 60 * 1000, 'menu without ordering falls back to 5 min');
}

console.log(`track-phases: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
