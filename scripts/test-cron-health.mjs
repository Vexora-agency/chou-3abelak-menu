// Cron heartbeat helpers: started/success/error stamps + server-side
// staleness view. Run: node scripts/test-cron-health.mjs
import {
  CRON_CRITICAL_AFTER_MS,
  CRON_STALE_AFTER_MS,
  ORDER_NAG_SERVICE,
  cronHealthFromRow,
  getCronHeartbeat,
  recordCronRunError,
  recordCronRunStarted,
  recordCronRunSuccess,
} from '../functions/_shared/repositories/orders.repo.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const MIN = 60 * 1000;
const T0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// In-memory cron_heartbeat table.
function mockDb(failOn) {
  const rows = new Map();
  return {
    __rows: rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (failOn === 'first') throw new Error('down');
              if (sql.includes('FROM cron_heartbeat WHERE')) {
                return rows.get(args[0]) || null;
              }
              return null;
            },
            async run() {
              if (failOn === 'run') throw new Error('down');
              if (sql.includes('INSERT INTO cron_heartbeat')) {
                const [service, started] = args;
                const prev = rows.get(service);
                rows.set(service, {
                  service,
                  last_started_at: started,
                  last_success_at: prev ? prev.last_success_at : null,
                  last_duration_ms: prev ? prev.last_duration_ms : null,
                  runs: (prev ? prev.runs : 0) + 1,
                  consecutive_errors: prev ? prev.consecutive_errors : 0,
                  last_error: prev ? prev.last_error : null,
                  last_result: prev ? prev.last_result : null,
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('SET last_success_at')) {
                const r = rows.get(args[0]);
                if (!r) return { meta: { changes: 0 } };
                r.last_success_at = args[1];
                r.last_duration_ms = args[2];
                r.consecutive_errors = 0;
                r.last_error = null;
                r.last_result = args[3];
                return { meta: { changes: 1 } };
              }
              if (sql.includes('SET consecutive_errors')) {
                const r = rows.get(args[0]);
                if (!r) return { meta: { changes: 0 } };
                r.consecutive_errors += 1;
                r.last_error = args[1];
                r.last_result = args[2];
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

ok(CRON_STALE_AFTER_MS === 3 * MIN, 'stale after 3 missed runs');
ok(CRON_CRITICAL_AFTER_MS === 5 * MIN, 'critical after 5 missed runs');

// Fresh DB: no row, no alarm.
{
  const db = mockDb();
  ok((await getCronHeartbeat(db, ORDER_NAG_SERVICE)) === null, 'no row before first sweep');
  const h = cronHealthFromRow(null, T0);
  ok(h.neverRan === true && h.stale === false && h.critical === false, 'fresh install never alarms');
}

// Started stamps + run counter.
{
  const db = mockDb();
  ok((await recordCronRunStarted(db, ORDER_NAG_SERVICE, iso(T0))) === true, 'started claims a row');
  ok((await recordCronRunStarted(db, ORDER_NAG_SERVICE, iso(T0 + 1000))) === true, 'started upserts');
  const row = await getCronHeartbeat(db, ORDER_NAG_SERVICE);
  ok(row && row.runs === 2 && row.last_started_at === iso(T0 + 1000), 'runs increments, started moves');
}

// Success stamps duration + resets errors; health parses result.
{
  const db = mockDb();
  await recordCronRunStarted(db, ORDER_NAG_SERVICE, iso(T0));
  await recordCronRunError(db, ORDER_NAG_SERVICE, { endedIso: iso(T0), error: 'boom', result: { nagged: 0 } });
  let row = await getCronHeartbeat(db, ORDER_NAG_SERVICE);
  ok(row && row.consecutive_errors === 1 && row.last_error === 'boom', 'error counted with message');
  ok((await recordCronRunSuccess(db, ORDER_NAG_SERVICE, {
    endedIso: iso(T0 + 5000), durationMs: 1200, result: { nagged: 2, released: 1, autoCompleted: 0, lockNoticed: 0 },
  })) === true, 'success claims the row');
  row = await getCronHeartbeat(db, ORDER_NAG_SERVICE);
  const h = cronHealthFromRow(row, T0 + 30 * 1000);
  ok(row.consecutive_errors === 0 && row.last_error === null, 'success resets error streak');
  ok(h.stale === false && h.critical === false && h.neverRan === false, 'fresh success is healthy');
  ok(h.lastResult && h.lastResult.released === 1, 'result counts survive the round trip');
  ok(h.lastStartedAt === iso(T0) && typeof h.lastDurationMs === 'number', 'started + duration exposed');
}

// Staleness ladder (server clock decides).
{
  const mk = (successAgoMs) => ({
    service: ORDER_NAG_SERVICE,
    last_started_at: iso(T0 - successAgoMs),
    last_success_at: iso(T0 - successAgoMs),
    last_duration_ms: 800,
    runs: 42,
    consecutive_errors: 0,
    last_error: null,
    last_result: null,
  });
  ok(cronHealthFromRow(mk(2 * MIN), T0).stale === false, '2 min old is healthy');
  const stale = cronHealthFromRow(mk(4 * MIN), T0);
  ok(stale.stale === true && stale.critical === false, '4 min old is stale, not critical');
  const crit = cronHealthFromRow(mk(6 * MIN), T0);
  ok(crit.stale === true && crit.critical === true, '6 min old is critical');
  const noSuccess = { ...mk(10 * MIN), last_success_at: null };
  const h = cronHealthFromRow(noSuccess, T0);
  ok(h.stale === false && h.critical === false, 'started-but-never-succeeded does not alarm on age alone');
  ok(cronHealthFromRow({ ...mk(0), last_success_at: 'garbage' }, T0).stale === false, 'bad date fails open');
}

// Failures never throw.
{
  const db = mockDb('run');
  ok((await recordCronRunStarted(db, ORDER_NAG_SERVICE, iso(T0))) === false, 'started swallows DB errors');
  ok((await recordCronRunSuccess(db, ORDER_NAG_SERVICE, { endedIso: iso(T0) })) === false, 'success swallows DB errors');
  ok((await recordCronRunError(db, ORDER_NAG_SERVICE, { error: 'x' })) === false, 'error path swallows DB errors');
  const db2 = mockDb('first');
  ok((await getCronHeartbeat(db2, ORDER_NAG_SERVICE)) === null, 'read swallows DB errors');
}

summary();
