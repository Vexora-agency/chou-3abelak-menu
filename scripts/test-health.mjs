// Health endpoint tests: shallow liveness, deep D1 probe, gating.
// Run: node scripts/test-health.mjs
import { onRequest as healthReq } from '../functions/api/health.js';
import { createAsserts, makeReq, readJson } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const req = makeReq;
const json = readJson;

const fakeDb = (rows = 0, fail = false) => ({
  prepare: (sql) => ({
    _sql: sql,
    bind: function () { return this; },
    first: async () => {
      if (fail) throw new Error('d1 down');
      if (this._sql !== 'SELECT 1') throw new Error(`unexpected probe query: ${this._sql}`);
      return { '1': 1, __rowsRead: rows };
    },
  }),
});

// shallow: no bindings, no-store, no version/config leakage
{
  const res = await healthReq({ request: req('GET', 'https://x/api/health'), env: {} });
  const data = await json(res);
  ok(res.status === 200 && data && data.ok === true, 'shallow 200 ok:true with empty env');
  ok(/no-store/.test(res.headers.get('Cache-Control') || ''), 'shallow is no-store');
  const leaked = JSON.stringify(data);
  ok(!/version|config|database|d1|sqlite/i.test(leaked), 'shallow leaks nothing');
}
// shallow ignores deep unless ?deep=1
{
  const res = await healthReq({ request: req('GET', 'https://x/api/health?deep=0'), env: {} });
  ok(res.status === 200 && (await json(res)).deep === undefined, 'deep=0 stays shallow');
}
// deep without a database -> 503, not 500
{
  const res = await healthReq({ request: req('GET', 'https://x/api/health?deep=1'), env: {} });
  const data = await json(res);
  ok(res.status === 503 && data && data.ok === false, 'deep without D1 is 503');
}
// deep with a database -> exactly one SELECT 1
{
  let queries = 0;
  const db = {
    prepare: (sql) => ({
      bind: function () { return this; },
      first: async () => { queries += 1; if (sql !== 'SELECT 1') throw new Error('probe must be SELECT 1'); return { '1': 1 }; },
    }),
  };
  const res = await healthReq({ request: req('GET', 'https://x/api/health?deep=1'), env: { ORDERS_DB: db } });
  const data = await json(res);
  ok(res.status === 200 && data.ok === true && data.deep && data.deep.d1 === 'ok', 'deep ok with one probe query');
  ok(queries === 1, 'deep issues exactly one query');
}
// deep with a failing database -> 503
{
  const res = await healthReq({ request: req('GET', 'https://x/api/health?deep=1'), env: { ORDERS_DB: fakeDb(0, true) } });
  ok(res.status === 503, 'deep with failing D1 is 503');
}
// method gate
{
  const res = await healthReq({ request: req('POST', 'https://x/api/health', { headers: { 'Content-Type': 'application/json' }, body: '{}' }), env: {} });
  ok(res.status === 405, 'POST is 405');
}

summary();
