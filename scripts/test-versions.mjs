// Version-history logic: own-changes reviews, no empty rows (node, no infra).
// Usage: node scripts/test-versions.mjs
// Runs the REAL endpoint modules + REAL migration-free KV shim:
// every save/review/restore below executes production code paths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const BASE = 'http://127.0.0.1:8788';

const store = new Map();
const KV = {
  get: async (k, opts) => {
    const e = store.get(k);
    if (!e) return null;
    if (opts && opts.type === 'json') { try { return JSON.parse(e.value); } catch { return null; } }
    return e.value;
  },
  put: async (k, v, opts) => { store.set(k, { value: String(v), metadata: (opts && opts.metadata) || null }); },
  delete: async (k) => { store.delete(k); },
  list: async (opts) => ({
    keys: [...store.entries()].filter(([k]) => k.startsWith((opts && opts.prefix) || '')).map(([name, e]) => ({ name, metadata: e.metadata })),
    list_complete: true,
    cursor: '',
  }),
};

const env = { MENU_KV: KV, SITE_PLAN: 'pro' };
const menuMod = await mod('functions/api/admin/menu.js');
const versMod = await mod('functions/api/admin/versions.js');
const changesMod = await mod('functions/api/admin/versions/[id]/changes.js');
const restoreMod = await mod('functions/api/admin/versions/[id]/restore.js');
const actMod = await mod('functions/api/admin/activity.js');
const { createSessionToken } = await mod('functions/_shared/session.js');

// Owner session for the owner-gated history endpoints (history is invisible
// to client logins — asserted below).
const SECRET = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
env.SESSION_SECRET = Buffer.from(SECRET).toString('base64');
const OWNER_COOKIE = `__Host-admin-session=${await createSessionToken(SECRET, 'admin', 3600)}`;
const CLIENT_COOKIE = `__Host-admin-session=${await createSessionToken(SECRET, 'client:layali', 3600)}`;
const AH = { 'X-Requested-With': 'menu-admin', Cookie: OWNER_COOKIE };

let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { fails++; console.error(`  FAIL ${name} ${extra}`); }
  else console.log(`  ok ${name}`);
};
const H = { 'X-Requested-With': 'menu-admin', Origin: BASE, 'Content-Type': 'application/json' };
const put = async (doc, source) => {
  const r = await menuMod.onRequest({
    request: new Request(BASE + `/api/admin/menu${source ? `?source=${source}` : ''}`, { method: 'PUT', headers: H, body: JSON.stringify(doc) }),
    env,
  });
  return { status: r.status, doc: await r.json().catch(() => ({})) };
};
const versions = async (headers) => (await (await versMod.onRequest({ request: new Request(BASE + '/api/admin/versions', { headers }), env })).json().catch(() => ({}))).versions || [];
const versionsStatus = async (headers) => (await versMod.onRequest({ request: new Request(BASE + '/api/admin/versions', { headers }), env })).status;
const review = async (id, headers) => {
  const r = await changesMod.onRequest({
    request: new Request(BASE + `/api/admin/versions/${encodeURIComponent(id)}/changes?lang=en`, { headers }),
    env, params: { id },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, changes: (body && body.changes) || [], basis: (body && body.comparedTo) || '?' };
};
const activityStatus = async (headers) => (await actMod.onRequest({ request: new Request(BASE + '/api/admin/activity', { headers }), env })).status;

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-menus/menu-30-items.json'), 'utf8'));
let r = await put({ ...seed, version: 1 });
check('seed saves', r.status === 200);

const d2 = JSON.parse(JSON.stringify(r.doc));
d2.items[0].pricing.price += 5000;
r = await put(d2);
check('price save', r.status === 200);

const d3 = JSON.parse(JSON.stringify(r.doc));
d3.items.push({ ...d3.items[0], id: 'test-version-item', name: { en: 'Test Item', ar: 'صنف' } });
r = await put(d3);
check('add save', r.status === 200);

// No-op save must NOT mint an empty history row.
r = await put(JSON.parse(JSON.stringify(r.doc)));
check('noop save 200', r.status === 200);
// Owner-only gates: client sessions see nothing (their movements stay
// invisible to them); owner sees everything.
{
  const CH = { 'X-Requested-With': 'menu-admin', Cookie: CLIENT_COOKIE };
  check('client versions -> 403', (await versionsStatus(CH)) === 403);
  check('client activity -> 403', (await activityStatus(CH)) === 403);
  const someId = '2000-01-01T00:00:00.000Z-x';
  const rc = await changesMod.onRequest({
    request: new Request(BASE + `/api/admin/versions/${encodeURIComponent(someId)}/changes?lang=en`, { headers: CH }),
    env, params: { id: someId },
  });
  check('client review -> 403', rc.status === 403, `got ${rc.status}`);
  check('owner versions 200', (await versionsStatus(AH)) === 200);
  check('owner activity 200', (await activityStatus(AH)) === 200);
}
let rows = await versions(AH);
check('no empty rows', rows.length === 2 && rows.every((e) => (e.summary.added + e.summary.removed + e.summary.changed) > 0), `got ${rows.length}`);

// Every review matches its own badges (latest: vs live; older: vs neighbor).
let mismatch = 0;
let basisOk = true;
for (const e of rows) {
  const rv = await review(e.id, AH);
  const n = (k) => rv.changes.filter((c) => c.kind === k).length;
  if (n('added') !== e.summary.added || n('removed') !== e.summary.removed || n('changed') !== e.summary.changed) mismatch++;
  if (!['live', 'version'].includes(rv.basis)) basisOk = false;
}
check('review == badges on every row', mismatch === 0);
check('comparedTo basis present', basisOk);
{
  const payloads = [];
  for (const e of rows) payloads.push(JSON.stringify((await review(e.id, AH)).changes));
  check('no duplicated review payloads', new Set(payloads).size === payloads.length);
}

// Restore works; restoring twice mints no second row (identical docs).
// A stale base (double-click / moved menu) 409s with NO noise row.
{
  const oldest = rows[rows.length - 1];
  const call = (id, base) => restoreMod.onRequest({
    request: new Request(BASE + `/api/admin/versions/${encodeURIComponent(id)}/restore`, { method: 'POST', headers: H, body: JSON.stringify(base === undefined ? {} : { expectedVersion: base }) }),
    env, params: { id },
  });
  // live version for a fresh base:
  const menuNow = await (await menuMod.onRequest({ request: new Request(BASE + '/api/admin/menu', { headers: { 'X-Requested-With': 'menu-admin' } }), env })).json().catch(() => ({}));
  const base = menuNow && typeof menuNow.version === 'number' ? menuNow.version : 0;
  const r1 = await call(oldest.id, base);
  check('restore ok', r1.status === 200);
  const n1 = (await versions(AH)).length;
  const r2 = await call(oldest.id, base); // same stale base -> conflict
  check('stale-base restore -> 409', r2.status === 409, `got ${r2.status}`);
  const n2 = (await versions(AH)).length;
  check('conflict mints no row', n2 === n1, `before=${n1} after=${n2}`);
  const r3 = await call(oldest.id); // legacy no-base call still restores
  check('baseless restore ok', r3.status === 200);
}

if (fails) { console.error(`test-versions: ${fails} FAILURES`); process.exit(1); }
console.log('test-versions: all green');
