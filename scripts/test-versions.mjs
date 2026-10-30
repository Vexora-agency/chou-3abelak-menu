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

// Sessions: owner sees all (marked), each client sees only its own rows,
// no session sees nothing. The master layer never leaks downward.
const SECRET = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
env.SESSION_SECRET = Buffer.from(SECRET).toString('base64');
const cookieFor = async (sub) => `__Host-admin-session=${await createSessionToken(SECRET, sub, 3600)}`;
const OWNER_COOKIE = await cookieFor('admin');
const LAYALI_COOKIE = await cookieFor('client:layali');
const OMAR_COOKIE = await cookieFor('client:omar');
const AH = { 'X-Requested-With': 'menu-admin', Origin: BASE, 'Content-Type': 'application/json', Cookie: OWNER_COOKIE };
const LH = { 'X-Requested-With': 'menu-admin', Origin: BASE, 'Content-Type': 'application/json', Cookie: LAYALI_COOKIE };
const OH = { 'X-Requested-With': 'menu-admin', Origin: BASE, 'Content-Type': 'application/json', Cookie: OMAR_COOKIE };
const NH = { 'X-Requested-With': 'menu-admin' };

let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { fails++; console.error(`  FAIL ${name} ${extra}`); }
  else console.log(`  ok ${name}`);
};
const H = { 'X-Requested-With': 'menu-admin', Origin: BASE, 'Content-Type': 'application/json' };
const put = async (doc, source, headers) => {
  const r = await menuMod.onRequest({
    request: new Request(BASE + `/api/admin/menu${source ? `?source=${source}` : ''}`, { method: 'PUT', headers: headers || H, body: JSON.stringify(doc) }),
    env,
  });
  return { status: r.status, doc: await r.json().catch(() => ({})) };
};
const versionsFull = async (headers) => (await versMod.onRequest({ request: new Request(BASE + '/api/admin/versions', { headers }), env })).json().catch(() => ({}));
const versions = async (headers) => (await versionsFull(headers)).versions || [];
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

// Saves under different identities attribute rows: owner, layali, omar.
const d2 = JSON.parse(JSON.stringify(r.doc));
d2.items[0].pricing.price += 5000;
r = await put(d2, undefined, LH);
check('layali price save', r.status === 200);

const d3 = JSON.parse(JSON.stringify(r.doc));
d3.items.push({ ...d3.items[0], id: 'test-version-item', name: { en: 'Test Item', ar: 'صنف' } });
r = await put(d3, undefined, OH);
check('omar add save', r.status === 200);

// No-op save must NOT mint an empty history row.
r = await put(JSON.parse(JSON.stringify(r.doc)));
check('noop save 200', r.status === 200);
// One more owner-attributed change so all three actors own rows.
{
  const d = JSON.parse(JSON.stringify(r.doc));
  d.items[1].pricing.price += 1000;
  r = await put(d, undefined, AH);
  check('owner edit save', r.status === 200);
}
// Visibility: owner all+marked, each client only own, none nothing.
{
  const CH = { 'X-Requested-With': 'menu-admin', Cookie: (await cookieFor('client:nobody')) };
  check('no-session versions -> 403', (await versionsStatus(NH)) === 403);
  check('no-session activity -> 403', (await activityStatus(NH)) === 403);
  const noRev = await changesMod.onRequest({
    request: new Request(BASE + '/api/admin/versions/x/changes?lang=en', { headers: NH }), env, params: { id: 'x' },
  });
  check('no-session review -> 404', noRev.status === 404);
  const ow = await versionsFull(AH);
  check('owner sees all + isOwner', ow.isOwner === true && (ow.versions || []).length === 3, `got ${(ow.versions || []).length}`);
  check('owner actors mixed', new Set((ow.versions || []).map((e) => e.actor)).size >= 2);
  check('owner status hides nothing structurally', ow.status && typeof ow.status.autoWeekly === 'boolean');
  const ly = await versionsFull(LH);
  check('layali sees own only + not owner', ly.isOwner === false && (ly.versions || []).length === 1 && ly.versions[0].actor === 'client:layali', JSON.stringify((ly.versions || []).map((e) => e.actor)));
  const om = await versionsFull(OH);
  check('omar sees own only', (om.versions || []).length === 1 && om.versions[0].actor === 'client:omar');
  check('client status leaks no destination', !('destination' in ((await versionsFull(LH)).status || {})));
  const nobody = await versionsFull(CH);
  check('stranger sees zero rows', (nobody.versions || []).length === 0 && nobody.isOwner === false);
}
let rows = await versions(AH);
check('no empty rows', rows.length === 3 && rows.every((e) => (e.summary.added + e.summary.removed + e.summary.changed) > 0), `got ${rows.length}`);

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
// Per-actor review/restore scoping: own rows work, others' 404.
{
  const byActor = {};
  for (const e of rows) byActor[e.actor] = e;
  const ownL = await review(byActor['client:layali'].id, LH);
  check('layali reviews own row', ownL.status === 200 && ownL.changes.length > 0);
  const cross1 = await review(byActor['client:omar'].id, LH);
  check('layali blocked from omar row', cross1.status === 404, `got ${cross1.status}`);
  const cross2 = await review(byActor['admin'].id, LH);
  check('layali blocked from owner row', cross2.status === 404, `got ${cross2.status}`);
  const menuNow = await (await menuMod.onRequest({ request: new Request(BASE + '/api/admin/menu', { headers: AH }), env })).json().catch(() => ({}));
  const base = menuNow && typeof menuNow.version === 'number' ? menuNow.version : 0;
  const rOwn = await restoreMod.onRequest({
    request: new Request(BASE + `/api/admin/versions/${encodeURIComponent(byActor['client:layali'].id)}/restore`, { method: 'POST', headers: { ...LH, Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: base }) }),
    env, params: { id: byActor['client:layali'].id },
  });
  check('layali restores own row', rOwn.status === 200, `got ${rOwn.status}`);
  const rCross = await restoreMod.onRequest({
    request: new Request(BASE + `/api/admin/versions/${encodeURIComponent(byActor['client:omar'].id)}/restore`, { method: 'POST', headers: { ...LH, Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: base + 1 }) }),
    env, params: { id: byActor['client:omar'].id },
  });
  check('layali blocked from omar restore', rCross.status === 404, `got ${rCross.status}`);
}
// Activity is filtered the same way.
{
  const all = async (h) => (await (await actMod.onRequest({ request: new Request(BASE + '/api/admin/activity', { headers: h }), env })).json().catch(() => ({}))).activity || [];
  const oa = await all(AH);
  check('owner activity sees all actors', new Set(oa.map((e) => e.actor)).size >= 2, oa.map((e) => e.actor).join(','));
  const la = await all(LH);
  check('layali activity only own', la.length > 0 && la.every((e) => e.actor === 'client:layali'), la.map((e) => e.actor).join(','));
  const oa2 = await all(OH);
  check('omar activity only own', oa2.length > 0 && oa2.every((e) => e.actor === 'client:omar'));
}

// Restore works; restoring twice mints no second row (identical docs).
// A stale base (double-click / moved menu) 409s with NO noise row.
{
  const oldest = rows[rows.length - 1];
  const call = (id, base) => restoreMod.onRequest({
    request: new Request(BASE + `/api/admin/versions/${encodeURIComponent(id)}/restore`, { method: 'POST', headers: { ...H, Cookie: OWNER_COOKIE }, body: JSON.stringify(base === undefined ? {} : { expectedVersion: base }) }),
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
