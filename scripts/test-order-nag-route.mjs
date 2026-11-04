// Order-nag route success path: valid Bearer stamps the heartbeat once
// (started + success) and returns the zero-counters shape with no
// Telegram/push side effects on idle sweeps.
// Run: node scripts/test-order-nag-route.mjs
import { onRequest } from '../functions/api/internal/order-nag.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();

// Idle D1 stand-in (mock-D1 prepare/bind/first/all/run style, matching on
// SQL substrings already used by scripts/test-cron-health.mjs and
// scripts/test-nag-gate.mjs).
function mockDb(calls) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('FROM service_secrets')) {
                calls.secretLookups.push(args.slice());
                // Mirror the route: SELECT secret FROM service_secrets WHERE key = ?1.
                if (args[0] === 'order-nag') return { secret: 's' };
                return null;
              }
              if (sql.includes('SELECT 1 AS x FROM orders')) {
                return null; // idle: no released-but-unacked order in window
              }
              return null;
            },
            async all() {
              // Release, lock-notice + auto-complete sweeps: no work.
              // (all() covers every sweep SELECT; each returns empty.)
              calls.alls.push(sql);
              return { results: [] };
            },
            async run() {
              calls.runs.push({ sql, args: args.slice() });
              if (sql.includes('INSERT INTO cron_heartbeat')) return { meta: { changes: 1 } };
              if (sql.includes('SET last_success_at')) return { meta: { changes: 1 } };
              if (sql.includes('SET consecutive_errors')) return { meta: { changes: 1 } };
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

const req = (secret) =>
  new Request('https://x/api/internal/order-nag', {
    method: 'POST',
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });

// Network guard: with empty candidates every notify* helper returns before
// touching fetch — nagUnackedOrders is skipped by the false probe, and the
// lock/release/auto-complete loops run zero iterations (Telegram helpers
// also early-skip on a null token). If any path DOES reach the network,
// flag it loudly instead of hitting it.
const realFetch = globalThis.fetch;
let fetchTouched = false;
globalThis.fetch = async () => {
  fetchTouched = true;
  throw new Error('fetch must not be called on an idle order-nag sweep');
};

let goodRes;
let goodBody;
let goodCalls;
let badRes;
let badBody;
let badCalls;
try {
  goodCalls = { secretLookups: [], alls: [], runs: [] };
  goodRes = await onRequest({
    request: req('s'),
    env: { ORDERS_DB: mockDb(goodCalls), MENU_KV: null, TELEGRAM_BOT_TOKEN: null },
  });
  try {
    goodBody = await goodRes.json();
  } catch {
    goodBody = null;
  }

  badCalls = { secretLookups: [], alls: [], runs: [] };
  badRes = await onRequest({
    request: req('wrong'),
    env: { ORDERS_DB: mockDb(badCalls), MENU_KV: null, TELEGRAM_BOT_TOKEN: null },
  });
  try {
    badBody = await badRes.json();
  } catch {
    badBody = null;
  }
} finally {
  globalThis.fetch = realFetch;
}

// (a) Idle success shape.
ok(goodRes && goodRes.status === 200, 'valid secret returns 200');
ok(
  goodBody &&
    goodBody.ok === true &&
    goodBody.nagged === 0 &&
    goodBody.released === 0 &&
    goodBody.autoCompleted === 0 &&
    goodBody.lockNoticed === 0 &&
    goodBody.receiptChecked === 0 &&
    JSON.stringify(Object.keys(goodBody).sort()) ===
      JSON.stringify(['autoCompleted', 'lockNoticed', 'nagged', 'ok', 'receiptChecked', 'released']),
  'idle body is exactly {ok:true,nagged:0,released:0,autoCompleted:0,lockNoticed:0,receiptChecked:0}'
);
ok(
  goodCalls.secretLookups.length === 1 && goodCalls.secretLookups[0][0] === 'order-nag',
  "secret lookup binds key 'order-nag'"
);

// (b) Exactly one started-stamp + one success-stamp.
{
  const started = goodCalls.runs.filter((r) => r.sql.includes('INSERT INTO cron_heartbeat'));
  const success = goodCalls.runs.filter((r) => r.sql.includes('SET last_success_at'));
  const errors = goodCalls.runs.filter((r) => r.sql.includes('SET consecutive_errors'));
  ok(started.length === 1 && started[0].args[0] === 'order-nag', 'exactly one started heartbeat stamp');
  ok(success.length === 1 && success[0].args[0] === 'order-nag', 'exactly one success heartbeat stamp');
  ok(errors.length === 0, 'no error heartbeat stamp on the happy path');
  ok(goodCalls.runs.length === 2, 'heartbeat writes are exactly started + success');
}

// (c) Zero Telegram/push side effects.
ok(fetchTouched === false, 'no Telegram/push network touched on idle sweeps');

// (d) Wrong secret: 404 with no heartbeat write.
ok(badRes && badRes.status === 404, 'wrong secret returns 404');
ok(badBody && badBody.error === 'not_found', 'wrong secret body is not_found');
ok(badCalls.runs.length === 0, 'wrong secret writes no heartbeat');

summary();
