// Nag release-gate: the reminder re-push must only ever select ALREADY
// released orders — the first ping is always the release sweep's job.
// Guards the same-pass double (nag + release push within seconds).
// Run: node scripts/test-nag-gate.mjs
import { nagUnackedOrders } from '../functions/_shared/push.js';
import { hasUnackedOrders } from '../functions/_shared/repositories/orders.repo.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const MIN = 60 * 1000;
const T0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// Seed: one of each fate.
const rows = [
  { id: 'due', number: 101, status: 'new', created_at: iso(T0 - 6 * MIN), released_at: null, total: 100 }, // must NEVER nag
  { id: 'rel', number: 102, status: 'new', created_at: iso(T0 - 10 * MIN), released_at: iso(T0 - 9 * MIN), total: 200 }, // nag candidate
  { id: 'old', number: 103, status: 'new', created_at: iso(T0 - 40 * MIN), released_at: iso(T0 - 39 * MIN), total: 300 }, // aged out
  { id: 'cnl', number: 104, status: 'cancelled', created_at: iso(T0 - 10 * MIN), released_at: null, total: 400 }, // terminal
];

function mockDb(seen) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('SELECT 1 AS x FROM orders')) {
                seen.probeSql = sql;
                const [cutoff, recent] = args;
                const found = rows.some(
                  (r) =>
                    r.status === 'new' &&
                    r.released_at !== null &&
                    r.created_at <= cutoff &&
                    r.created_at >= recent
                );
                return found ? { x: 1 } : null;
              }
              return null;
            },
            async all() {
              if (sql.includes('FROM orders')) {
                seen.nagSql = sql;
                const [from, to] = args;
                // Faithful mirror of the nag SELECT predicate.
                const out = rows
                  .filter(
                    (r) =>
                      r.status === 'new' &&
                      r.released_at !== null &&
                      r.created_at >= from &&
                      r.created_at <= to
                  )
                  .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
                  .slice(0, 20);
                seen.selected = out.map((r) => r.number);
                return { results: out };
              }
              if (sql.includes('admin_push_subscriptions')) return { results: [] };
              return { results: [] };
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

// 1. Nag selects only the released in-window order (no network: zero subs).
{
  const seen = {};
  const out = await nagUnackedOrders(mockDb(seen), {
    storeName: 'S', currency: 'LBP', adminUrl: 'https://x/admin', subject: 'x',
  });
  ok(out.nagged === 0, 'zero subs means zero sends (no network touched)');
  ok(typeof seen.nagSql === 'string' && seen.nagSql.includes('released_at IS NOT NULL'), 'nag SQL carries the released gate');
  ok(JSON.stringify(seen.selected) === JSON.stringify([102]), 'only the released order is selected — the 6-min unreleased one is skipped');
}

// 2. Probe mirrors the gate (drives the menu-KV skip in order-nag).
{
  const seen = {};
  ok((await hasUnackedOrders(mockDb(seen), iso(T0 - 5 * MIN), iso(T0 - 30 * MIN))) === true, 'probe finds the released candidate');
  ok(typeof seen.probeSql === 'string' && seen.probeSql.includes('released_at IS NOT NULL'), 'probe SQL carries the released gate');
  const freshOnly = {
    prepare() {
      return { bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }) };
    },
  };
  ok((await hasUnackedOrders(freshOnly, iso(T0 - 5 * MIN), iso(T0 - 30 * MIN))) === false, 'unreleased-only window probes false');
}

summary();
