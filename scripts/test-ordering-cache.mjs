// Ordering-state Cache API envelope: a fresh snapshot answers with zero KV
// reads; misses/expired snapshots read KV once and store; timed flips bound
// the envelope; purgeOrderingState drops it instantly on admin writes.
// Run: node scripts/test-ordering-cache.mjs
import { onRequest } from '../functions/api/ordering-state.js';
import { purgeOrderingState } from '../functions/_shared/versions.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();

// ---- fakes ----
function makeFakeKV(menuDoc) {
  return {
    reads: 0,
    writes: 0,
    async get() { this.reads += 1; return menuDoc; },
    async put() { this.writes += 1; },
  };
}
function makeFakeCaches() {
  const store = new Map();
  return {
    default: {
      async match(req) {
        const hit = store.get(String(req.url || req));
        return hit ? hit.clone() : undefined;
      },
      async put(req, res) { store.set(String(req.url || req), res.clone()); },
      async delete(req) { return store.delete(String(req.url || req)); },
    },
    __size: () => store.size,
    __raw: (k) => store.get(k),
  };
}
const req = (headers = {}) => ({
  method: 'GET',
  url: 'https://shop.test/api/ordering-state',
  headers: new Headers(headers),
});
const baseSettings = (ordering) => ({
  timezone: 'Asia/Beirut',
  statusMode: 'open',
  openTime: '00:00',
  closeTime: '23:59',
  ordering: { enabled: true, paused: false, ...(ordering || {}) },
});

// ---- 1. miss -> KV once, stores envelope; hit -> zero KV, fresh serverTime ----
{
  const kv = makeFakeKV({ settings: baseSettings() });
  const caches = makeFakeCaches();
  globalThis.caches = caches;
  const env = { MENU_KV: kv };

  const r1 = await onRequest({ request: req(), env });
  ok(r1.status === 200, 'miss answers 200');
  const b1 = await r1.json();
  ok(b1.state === 'open' && typeof b1.serverTime === 'string', 'miss body shape (state + fresh serverTime)');
  const tag = r1.headers.get('ETag');
  ok(typeof tag === 'string' && tag.length > 0, 'miss sets ETag');
  ok(kv.reads === 1 && caches.__size() === 1, 'miss costs exactly one KV read and stores envelope');

  const r2 = await onRequest({ request: req(), env });
  const b2 = await r2.json();
  ok(r2.status === 200 && kv.reads === 1, 'hit costs zero KV reads');
  ok(b2.state === 'open' && b2.serverTime !== b1.serverTime, 'hit serves fresh serverTime');

  const r3 = await onRequest({ request: req({ 'If-None-Match': tag }), env });
  ok(r3.status === 304 && kv.reads === 1, 'hit honors If-None-Match with 304, still zero KV');
}

// ---- 2. purge drops the envelope -> next poll reads KV again ----
{
  const kv = makeFakeKV({ settings: baseSettings() });
  const caches = makeFakeCaches();
  globalThis.caches = caches;
  const env = { MENU_KV: kv };
  await onRequest({ request: req(), env });
  ok(kv.reads === 1, 'primed with one KV read');
  await purgeOrderingState(req());
  ok(caches.__size() === 0, 'purge empties the envelope');
  await onRequest({ request: req(), env });
  ok(kv.reads === 2, 'post-purge poll reads KV again');
}

// ---- 3. timed flip bounds the envelope (pausedUntil) ----
{
  const until = new Date(Date.now() + 10 * 1000).toISOString();
  const kv = makeFakeKV({ settings: baseSettings({ paused: true, pausedUntil: until }) });
  const caches = makeFakeCaches();
  globalThis.caches = caches;
  const env = { MENU_KV: kv };
  const r = await onRequest({ request: req(), env });
  const b = await r.json();
  ok(b.state === 'paused' && b.reopensAt === until, 'paused snapshot carries reopensAt');
  const raw = caches.__raw('https://shop.test/api/ordering-state');
  const envelope = JSON.parse(await raw.text());
  ok(envelope.validUntil <= Date.parse(until) && envelope.validUntil > Date.now(), 'envelope expires on/before the timed flip');
}

// ---- 4. expired envelope is ignored (re-reads KV) ----
{
  const kv = makeFakeKV({ settings: baseSettings() });
  const caches = makeFakeCaches();
  globalThis.caches = caches;
  const env = { MENU_KV: kv };
  await caches.default.put(
    new Request('https://shop.test/api/ordering-state'),
    new Response(JSON.stringify({ tag: 'W/"os-stale"', snapshot: { state: 'open', message: { en: '', ar: '' } }, validUntil: Date.now() - 1000 }), { headers: { 'Content-Type': 'application/json' } })
  );
  const r = await onRequest({ request: req(), env });
  ok(r.status === 200 && kv.reads === 1, 'stale envelope is bypassed with a KV re-read');
}

// ---- 4b. pre-rename envelope shape misses safely (fresh `st`, no `snapshot`) ----
{
  const kv = makeFakeKV({ settings: baseSettings() });
  const caches = makeFakeCaches();
  globalThis.caches = caches;
  const env = { MENU_KV: kv };
  await caches.default.put(
    new Request('https://shop.test/api/ordering-state'),
    new Response(JSON.stringify({ tag: 'W/"os-old"', st: { state: 'open', message: { en: '', ar: '' } }, validUntil: Date.now() + 60000 }), { headers: { 'Content-Type': 'application/json' } })
  );
  const r = await onRequest({ request: req(), env });
  const b = await r.json();
  ok(r.status === 200 && kv.reads === 1 && b.state === 'open', 'old-shape envelope misses safely with a KV re-read');
}

// ---- 5. failure posture unchanged ----
{
  const caches = makeFakeCaches();
  globalThis.caches = caches;
  const bad = { method: 'POST', url: 'https://shop.test/api/ordering-state', headers: new Headers() };
  const r = await onRequest({ request: bad, env: { MENU_KV: makeFakeKV(null) } });
  ok(r.status === 405, 'non-GET still 405');
  const kv = { async get() { throw new Error('down'); } };
  const r2 = await onRequest({ request: req(), env: { MENU_KV: kv } });
  ok(r2.status === 503, 'KV outage still 503s (no cache to serve)');
}

delete globalThis.caches;
summary();
