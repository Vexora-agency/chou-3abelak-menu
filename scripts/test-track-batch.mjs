// Batched order tracking: one request for the whole bell shelf — one KV
// rate-limit probe + one D1 round-trip. No-oracle shapes: unknown numbers,
// bad tokens and malformed pairs are indistinguishable from each other.
// Run: node scripts/test-track-batch.mjs
import { onRequest } from '../functions/api/track/batch.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const T0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const TOK = 'a'.repeat(32);
const TOK2 = 'b'.repeat(32);

const seed = [
  { number: 101, track_token: TOK, status: 'confirmed', type: 'delivery', total: 500, items_json: '[{},{},{}]', created_at: iso(T0 - 60 * 1000) },
  { number: 202, track_token: TOK2, status: 'new', type: 'pickup', total: 250, items_json: '[]', created_at: iso(T0 - 120 * 1000) },
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
      { number: 'x', t: TOK }, // malformed — dropped, no entry
      { number: 202 }, // malformed — dropped, no entry
    ] }),
    env: e,
  });
  ok(r.status === 200, 'mixed batch is 200');
  const d = await r.json();
  ok(d.ok === true && Array.isArray(d.results) && d.results.length === 4, 'one entry per well-formed pair, malformed dropped');
  const [r101, r202, r101bad, r999] = d.results;
  ok(r101.status === 'confirmed' && r101.total === 500 && r101.itemsCount === 3 && typeof r101.createdAt === 'string', 'valid row returns status payload');
  ok(r202.status === 'new' && r202.itemsCount === 0, 'second valid row resolves independently');
  const unknownShape = (r) => r && r.status === 'unknown' && r.total === null && r.itemsCount === null && r.createdAt === null;
  ok(unknownShape(r101bad) && r101bad.number === 101, 'bad token reads exactly like unknown (no oracle)');
  ok(unknownShape(r999) && r999.number === 999, 'unknown number reads identically (no oracle)');
  ok(kv.reads === 2, 'probe + one failure-count read for the whole batch (still a single write)');
  ok(kv.writes === 1, 'exactly one write counted for the failed pair');
}

// 3. All-valid batch costs zero writes.
{
  const kv = mockKv();
  const e = { MENU_KV: kv, ORDERS_DB: mockDb() };
  const r = await onRequest({ request: req({ orders: [{ number: 101, t: TOK }] }), env: e });
  ok(r.status === 200 && kv.reads === 1 && kv.writes === 0, 'clean batch: 1 read, 0 writes');
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

summary();
