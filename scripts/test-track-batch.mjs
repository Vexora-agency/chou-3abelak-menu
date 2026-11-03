// Batched order tracking: one request for the whole bell shelf — one KV
// rate-limit probe + one D1 round-trip. No-oracle shapes: unknown numbers
// and bad tokens are indistinguishable from each other; every input pair
// yields exactly one entry (malformed pairs get the unknown shape with
// number: null — accepted residual: null vs int still differs, but the
// bell never sends malformed pairs and token/number guessing stays
// identical).
// Run: node scripts/test-track-batch.mjs
import { onRequest } from '../functions/api/track/batch.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const T0 = Date.now();
const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const TOK = 'a'.repeat(32);
const TOK2 = 'b'.repeat(32);

const seed = [
  { number: 101, track_token: TOK, status: 'confirmed', type: 'delivery', total: 500, items_json: '[{},{},{}]', created_at: iso(T0 - 60 * MIN), confirmed_at: iso(T0 - 5 * MIN), eta_at: iso(T0 + 55 * MIN) },
  { number: 202, track_token: TOK2, status: 'new', type: 'delivery', total: 250, items_json: '[]', created_at: iso(T0 - 120 * 1000), confirmed_at: null, eta_at: null },
  { number: 303, track_token: TOK, status: 'confirmed', type: 'pickup', total: 100, items_json: '[]', created_at: iso(T0 - 120 * MIN), confirmed_at: null, eta_at: null },
];

function mockDb() {
  return {
    prepare(sql) {
      if (!sql.includes('WHERE number IN (')) throw new Error(`unexpected SQL: ${sql}`);
      return {
        bind(...nums) {
          return {
            async all() {
              return { results: seed.filter((r) => nums.includes(r.number)) };
            },
            async first() { return null; },
            async run() { return { meta: { changes: 0 } }; },
          };
        },
      };
    },
  };
}
function mockKv() {
  return {
    reads: 0,
    writes: 0,
    store: new Map(),
    async get(k) { this.reads += 1; return this.store.has(k) ? this.store.get(k) : null; },
    async put(k, v) { this.writes += 1; this.store.set(k, v); },
  };
}
const req = (body) => ({
  method: 'POST',
  url: 'https://shop.test/api/track/batch',
  headers: new Headers({ 'Content-Type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const env = () => ({ MENU_KV: mockKv(), ORDERS_DB: mockDb() });

// 1. Method + body validation.
{
  const bad = { method: 'GET', url: 'https://shop.test/api/track/batch', headers: new Headers() };
  ok((await onRequest({ request: bad, env: env() })).status === 405, 'non-POST is 405');
  ok((await onRequest({ request: req({ nope: 1 }), env: env() })).status === 400, 'missing orders is 400');
  const many = Array.from({ length: 21 }, (_, i) => ({ number: 1000 + i, t: TOK }));
  ok((await onRequest({ request: req({ orders: many }), env: env() })).status === 400, 'over-cap batch is 400');
}

// 2. Mixed batch: valid, bad token, unknown number, malformed, duplicate.
{
  const kv = mockKv();
  const e = { MENU_KV: kv, ORDERS_DB: mockDb() };
  const r = await onRequest({
    request: req({ orders: [
      { number: 101, t: TOK }, // valid
      { number: 202, t: TOK2 }, // valid
      { number: 101, t: 'c'.repeat(32) }, // bad token, same number as #1 (dedupe: first wins)
      { number: 999, t: TOK }, // unknown number
      { number: 'x', t: TOK }, // malformed — unknown entry with number: null
      { number: 202 }, // malformed — unknown entry with number: null
    ] }),
    env: e,
  });
  ok(r.status === 200, 'mixed batch is 200');
  const d = await r.json();
  ok(d.ok === true && Array.isArray(d.results) && d.results.length === 6, 'one entry per input pair, malformed get number:null unknown');
  const [r101, r202, r101bad, r999, rMal1, rMal2] = d.results;
  ok(r101.status === 'confirmed' && r101.total === 500 && r101.itemsCount === 3 && typeof r101.createdAt === 'string', 'valid row returns status payload');
  ok(r101.receivableAt === iso(T0 + 60 * MIN), 'locked row carries exact unlock instant (eta + 5 min buffer)');
  ok(r202.status === 'new' && r202.itemsCount === 0, 'second valid row resolves independently');
  ok(r202.receivableAt === null, 'new rows carry no unlock instant');
  const unknownShape = (r) => r && r.status === 'unknown' && r.total === null && r.itemsCount === null && r.createdAt === null && r.receivableAt === null;
  ok(unknownShape(r101bad) && r101bad.number === 101, 'bad token reads exactly like unknown (no oracle)');
  ok(unknownShape(r999) && r999.number === 999, 'unknown number reads identically (no oracle)');
  ok(unknownShape(rMal1) && rMal1.number === null, 'malformed pair yields unknown with number:null');
  ok(unknownShape(rMal2) && rMal2.number === null, 'missing-token pair yields unknown with number:null');
  ok(kv.reads === 3, 'probe + menu settings + one failure-count read for the whole batch (still a single write)');
  ok(kv.writes === 1, 'exactly one write counted for the failed pair');
}

// 3. All-valid batch costs zero writes (probe + one settings read).
{
  const kv = mockKv();
  const e = { MENU_KV: kv, ORDERS_DB: mockDb() };
  const r = await onRequest({ request: req({ orders: [{ number: 101, t: TOK }] }), env: e });
  ok(r.status === 200 && kv.reads === 2 && kv.writes === 0, 'clean batch: probe + settings read, 0 writes');
}

// 4. Rate-limited IP gets 429 without touching D1.
{
  let dbTouched = false;
  const kv = mockKv();
  await kv.put('track:9.9.9.9', JSON.stringify({ n: 120, reset: Math.floor(Date.now() / 1000) + 300 }));
  const readsBefore = kv.reads;
  const e = { MENU_KV: kv, ORDERS_DB: { prepare() { dbTouched = true; throw new Error('must not query'); } } };
  const r = await onRequest({
    request: {
      method: 'POST', url: 'https://shop.test/api/track/batch',
      headers: new Headers({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' }),
      json: async () => ({ orders: [{ number: 101, t: TOK }] }),
      text: async () => JSON.stringify({ orders: [{ number: 101, t: TOK }] }),
    },
    env: e,
  });
  ok(r.status === 429 && dbTouched === false && kv.reads === readsBefore + 1, 'limited IP is 429 before any D1 work');
}

// 5. Unlock instants: legacy pickup row (no stamps) unlocks from created_at;
//    KV outage degrades to hardcoded defaults instead of failing.
{
  const kv = mockKv();
  const e = { MENU_KV: kv, ORDERS_DB: mockDb() };
  const r = await onRequest({ request: req({ orders: [{ number: 303, t: TOK }] }), env: e });
  ok(r.status === 200, 'legacy row batch is 200');
  const d = await r.json();
  const r303 = d.results[0];
  // created 120 min ago + pickup delay 15 min -> long past: unlocked.
  ok(r303.status === 'confirmed' && Date.parse(r303.receivableAt) <= Date.now(), 'legacy confirmed row unlocks from created_at + pickup delay');

  const kvDown = { reads: 0, writes: 0, async get() { throw new Error('down'); }, async put() {} };
  const r2 = await onRequest({ request: req({ orders: [{ number: 303, t: TOK }] }), env: { MENU_KV: kvDown, ORDERS_DB: mockDb() } });
  const d2 = await r2.json();
  ok(r2.status === 200 && Date.parse(d2.results[0].receivableAt) <= Date.now(), 'KV outage still unlocks via fallback defaults');
}

summary();
