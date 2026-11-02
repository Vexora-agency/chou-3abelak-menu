/**
 * Contract tests for conditional polling (ETag round-trips).
 * Context: the 5 s / 30 s / 60 s schedulers must keep running (live pause
 * + menu updates), but unchanged polls must cost headers only. The server
 * endpoints below already speak ETag; the client echoes it.
 * Run: tsx scripts/test-etag.mjs (tsx: imports TS client code + plain-JS
 * function routes, both free of platform globals at import time).
 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { publicGetVersioned } from '../src/lib/api-client.ts';
import { onRequest as orderingState } from '../functions/api/ordering-state.js';
import { onRequest as menu } from '../functions/api/menu.js';

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; } else { fail++; console.error(`FAIL ${n} ${x}`); } };

const SETTINGS = {
  statusMode: 'auto', openTime: '08:00', closeTime: '21:00',
  workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'],
  timezone: 'Asia/Beirut', ordering: { enabled: true },
};
const stubEnv = (settings) => ({ MENU_KV: { get: async () => ({ settings, version: 9, updatedAt: '2026-11-01T00:00:00.000Z' }) } });
const req = (url, inm) => new Request(url, inm ? { headers: { 'If-None-Match': inm } } : undefined);

// --- 1. ordering-state: stable tag, 304 on match, new tag on change ---
{
  const ctx = (inm) => ({ request: req('https://x/api/ordering-state', inm), env: stubEnv(SETTINGS) });
  const r1 = await orderingState(ctx());
  const tag1 = r1.headers.get('ETag');
  ok(r1.status === 200 && !!tag1, 'ordering-state 200 carries ETag', `status=${r1.status} etag=${tag1}`);
  const body1 = await r1.json().catch(() => null);
  ok(body1 && typeof body1.state === 'string', 'ordering-state 200 has state');
  const r2 = await orderingState(ctx(tag1));
  ok(r2.status === 304, 'ordering-state unchanged answers 304', `status=${r2.status}`);
  ok((await r2.text()) === '', 'ordering-state 304 has no body');
  ok(r2.headers.get('ETag') === tag1, 'ordering-state 304 repeats ETag');
  const paused = { ...SETTINGS, ordering: { enabled: true, paused: true } };
  const r3 = await orderingState({ request: req('https://x/api/ordering-state', tag1), env: stubEnv(paused) });
  ok(r3.status === 200 && r3.headers.get('ETag') !== tag1, 'ordering-state change answers 200 with new tag');
}

// --- 2. menu endpoint: version-based tag the client can predict ---
{
  const doc = { version: 42, updatedAt: '2026-11-01T12:00:00.000Z', settings: SETTINGS, categories: [], items: [] };
  const env = { MENU_KV: { get: async () => doc } };
  const ctx = (inm) => ({ request: req('https://x/api/menu', inm), env, waitUntil: () => {} });
  const r1 = await menu(ctx());
  const tag1 = r1.headers.get('ETag');
  ok(r1.status === 200 && tag1 === 'W/"42-2026-11-01T12:00:00.000Z"', 'menu ETag derives from version+updatedAt', `etag=${tag1}`);
  const r2 = await menu(ctx(tag1));
  ok(r2.status === 304, 'menu unchanged answers 304', `status=${r2.status}`);
  ok((await r2.text()) === '', 'menu 304 has no body');
}

// --- 3. client round-trip: echo tag, treat 304 as unchanged (not error) ---
{
  let seenInm = null;
  const srv = createServer((rq, rs) => {
    seenInm = rq.headers['if-none-match'] || null;
    if (seenInm === 'W/"v9-test"') {
      rs.writeHead(304, { ETag: 'W/"v9-test"', Date: new Date().toUTCString() });
      rs.end();
      return;
    }
    rs.writeHead(200, { 'Content-Type': 'application/json', ETag: 'W/"v9-test"', Date: new Date().toUTCString() });
    rs.end(JSON.stringify({ ok: true }));
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const first = await publicGetVersioned(`${base}/doc`);
    ok(first.status === 'fresh' && first.data?.ok === true, 'client first fetch is fresh');
    ok(first.status === 'fresh' && first.etag === 'W/"v9-test"', 'client stores server ETag');
    const second = await publicGetVersioned(`${base}/doc`, { etag: first.status === 'fresh' ? first.etag : null });
    ok(seenInm === 'W/"v9-test"', 'client echoes If-None-Match byte-exact');
    ok(second.status === 'not-modified', 'client maps 304 to not-modified (not error)');
    const bad = await publicGetVersioned(`http://127.0.0.1:1/unreachable`);
    ok(bad.status === 'error', 'client maps network failure to error');
  } finally {
    srv.close();
  }
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
