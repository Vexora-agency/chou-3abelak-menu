// Route tests for Backup & History: import token single-use/expiry,
// restore safety snapshot, trash restore, autosave coalescing,
// unsigned-can-never-touch-WhatsApp. Pure split of test-backup.mjs.
// Run: node scripts/test-backup-flows.mjs
import { getSiteId } from '../functions/_shared/versions.js';
import { onRequest as analyzeReq } from '../functions/api/admin/import/analyze.js';
import { onRequest as applyReq } from '../functions/api/admin/import/apply.js';
import { onRequest as versionsReq } from '../functions/api/admin/versions.js';
import { onRequest as changesReq } from '../functions/api/admin/versions/[id]/changes.js';
import { onRequest as restoreReq } from '../functions/api/admin/versions/[id]/restore.js';
import { onRequest as trashReq } from '../functions/api/admin/trash.js';
import { onRequest as trashRestoreReq } from '../functions/api/admin/trash/[id]/restore.js';
import { onRequest as trashDeleteReq } from '../functions/api/admin/trash/[id].js';
import { onRequest as exportReq } from '../functions/api/admin/backup/export.js';
import { onRequest as csvReq } from '../functions/api/admin/backup/csv.js';
import { onRequest as printReq } from '../functions/api/admin/backup/print.js';
import { onRequest as menuReq } from '../functions/api/admin/menu.js';
import { createAsserts, makeKV, makeReq, readJson } from './_helpers/shared.mjs';
import { makeMenu } from './_helpers/backup-fixture.mjs';

const { ok, summary } = createAsserts();
const req = makeReq;
const json = readJson;

const ENV = () => ({ MENU_KV: makeKV(), BACKUP_SECRET: 'test-backup-secret-1234567890', SITE_PLAN: 'pro' });

/* ---------------- 4. Import: signed apply, tamper, unsigned guard ---------------- */

async function analyze(env, body, contentType, lang = 'en') {
  const res = await analyzeReq({ request: req('POST', `https://x/api/admin/import/analyze?lang=${lang}`, { headers: { 'Content-Type': contentType }, body }), env });
  return { status: res.status, data: await json(res) };
}
async function apply(env, payload) {
  const res = await applyReq({ request: req('POST', 'https://x/api/admin/import/apply', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), env });
  return { status: res.status, data: await json(res) };
}
async function seedMenu(env, menu) {
  await env.MENU_KV.put('menu', JSON.stringify({ ...menu, version: 7 }));
}

{
  // signed envelope round trip
  const env = ENV();
  await seedMenu(env, makeMenu());
  const { backupEnvelope, signPayload } = await import('../functions/_shared/versions.js');
  const menu = makeMenu();
  menu.items[0].pricing.price = 180000;
  const payload = backupEnvelope({ menu, siteId: 'site1', exportedAt: '2026-02-01T00:00:00.000Z' });
  const sig = await signPayload(env, payload);
  const a = await analyze(env, JSON.stringify({ ...payload, sig }), 'application/json');
  ok(a.status === 200 && a.data.signed === true && typeof a.data.token === 'string', 'signed envelope analyzes');
  ok(a.data.changes.some((c) => c.detail === 'Price 150,000 → 180,000'), 'analysis shows price change');
  const ap = await apply(env, { token: a.data.token, includeSettings: false });
  ok(ap.status === 200 && ap.data.ok === true, 'signed apply works');
  const ap2 = await apply(env, { token: a.data.token, includeSettings: false });
  ok(ap2.status === 400, 'token single-use');
  const after = await env.MENU_KV.get('menu', { type: 'json' });
  ok(after.items.find((it) => it.id === 'zaatar').pricing.price === 180000, 'applied price persisted');
}
{
  // tampered file becomes unsigned; whatsapp can never change through it
  const env = ENV();
  await seedMenu(env, makeMenu());
  const { backupEnvelope, signPayload } = await import('../functions/_shared/versions.js');
  const menu = makeMenu();
  menu.settings.whatsapp = '96170000000';
  const payload = backupEnvelope({ menu, siteId: 'site1', exportedAt: '2026-02-01T00:00:00.000Z' });
  const sig = await signPayload(env, payload);
  const tampered = { ...payload, sig };
  tampered.menu = JSON.parse(JSON.stringify(menu));
  tampered.menu.items[0].pricing.price = 190000;
  const a = await analyze(env, JSON.stringify(tampered), 'application/json');
  ok(a.status === 200 && a.data.signed === false, 'tampered envelope is unsigned');
  const ap = await apply(env, { token: a.data.token, includeSettings: true });
  ok(ap.data.ok === true, 'unsigned apply works for items');
  const after = await env.MENU_KV.get('menu', { type: 'json' });
  ok(after.settings.whatsapp === '96170123456', 'UNSIGNED FILE CAN NEVER CHANGE WHATSAPP');
  ok(after.items.find((it) => it.id === 'zaatar').pricing.price === 190000, 'unsigned item change applies');
}
{
  // token expiry + session binding
  const env = ENV();
  await seedMenu(env, makeMenu());
  const { backupEnvelope, signPayload } = await import('../functions/_shared/versions.js');
  const payload = backupEnvelope({ menu: makeMenu(), siteId: 'site1', exportedAt: '2026-02-01T00:00:00.000Z' });
  const a = await analyze(env, JSON.stringify({ ...payload, sig: await signPayload(env, payload) }), 'application/json');
  env.MENU_KV.__expire(`import:${a.data.token}`);
  const ap = await apply(env, { token: a.data.token, includeSettings: false });
  ok(ap.status === 400, 'expired token rejected');
  // bad token shape
  const ap2 = await apply(env, { token: 'not-hex', includeSettings: false });
  ok(ap2.status === 400, 'malformed token rejected');
  // proto pollution + depth
  const evil = await analyze(env, '{"a":{"__proto__":{"x":1}}}', 'application/json');
  ok(evil.status === 400, '__proto__ rejected');
  let deep = '0';
  for (let i = 0; i < 12; i++) deep = `{"k":${deep}}`;
  const deepRes = await analyze(env, deep, 'application/json');
  ok(deepRes.status === 400, 'deep nesting rejected');
  // wrong content type
  const ct = await analyze(env, '{}', 'text/plain');
  ok(ct.status === 400, 'content-type enforced');
}

/* ---------------- 5. Versions, restore safety, trash ---------------- */

async function putMenu(env, menu, source) {
  const res = await menuReq({
    request: req('PUT', `https://x/api/admin/menu${source ? `?source=${source}` : ''}`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(menu),
    }),
    env,
  });
  return { status: res.status, data: await json(res) };
}

{
  const env = ENV();
  await seedMenu(env, makeMenu());
  // manual PUT snapshots previous
  const m2 = makeMenu();
  m2.items[0].pricing.price = 160000;
  m2.version = 7;
  const p1 = await putMenu(env, m2, undefined);
  ok(p1.status === 200, 'PUT works');
  let vl = await (await versionsReq({ request: req('GET', 'https://x/api/admin/versions'), env })).json();
  ok(vl.versions.length === 1 && vl.versions[0].source === 'manual', 'manual snapshot stored');
  ok(vl.versions[0].summary.prices === 1, 'snapshot summary counts prices');
  // autosave coalesces within 5 minutes
  const m3 = JSON.parse(JSON.stringify(m2));
  m3.version = 8;
  m3.items[0].pricing.price = 165000;
  await putMenu(env, m3, 'autosave');
  await putMenu(env, { ...m3, version: 9 }, 'autosave');
  vl = await (await versionsReq({ request: req('GET', 'https://x/api/admin/versions'), env })).json();
  ok(vl.versions.length === 2, `autosave coalesced (got ${vl.versions.length})`);
  // changes endpoint
  const oldest = vl.versions[vl.versions.length - 1];
  const chRes = await changesReq({ request: req('GET', `https://x/api/admin/versions/${encodeURIComponent(oldest.id)}/changes?lang=en`), env, params: { id: oldest.id } });
  const chd = await chRes.json();
  ok(chRes.status === 200 && chd.changes.length > 0, 'changes diff works');
  // restore creates a safety snapshot, then writes old doc with version+1
  const before = vl.versions.length;
  const rr = await restoreReq({ request: req('POST', `https://x/api/admin/versions/${encodeURIComponent(oldest.id)}/restore`, { headers: { 'Content-Type': 'application/json' }, body: '{}' }), env, params: { id: oldest.id } });
  const rd = await rr.json();
  ok(rr.status === 200 && rd.ok === true, 'restore works');
  vl = await (await versionsReq({ request: req('GET', 'https://x/api/admin/versions'), env })).json();
  ok(vl.versions.length === before + 1, 'restore safety snapshot stored');
  const cur = await env.MENU_KV.get('menu', { type: 'json' });
  ok(cur.items.find((it) => it.id === 'zaatar').pricing.price === 150000, 'restored doc written');
  // trash item -> restore -> delete forever
  const t1 = await trashReq({ request: req('POST', 'https://x/api/admin/trash', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'item', id: 'pepsi', baseVersion: cur.version }) }), env });
  const t1d = await t1.json();
  ok(t1.status === 200 && t1d.ok && typeof t1d.trashId === 'string', 'trash move returns id');
  const tl = await (await trashReq({ request: req('GET', 'https://x/api/admin/trash'), env })).json();
  ok(tl.trash.length === 1 && tl.trash[0].purgeInDays >= 29, 'trash lists entry with purge window');
  const cur2 = await env.MENU_KV.get('menu', { type: 'json' });
  ok(!cur2.items.some((it) => it.id === 'pepsi'), 'trashed item removed from menu');
  const tr = await trashRestoreReq({ request: req('POST', `https://x/api/admin/trash/${t1d.trashId}/restore`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: cur2.version }) }), env, params: { id: t1d.trashId } });
  ok((await tr.json()).ok === true, 'trash restore works');
  const cur3 = await env.MENU_KV.get('menu', { type: 'json' });
  ok(cur3.items.some((it) => it.id === 'pepsi'), 'restored item back in menu');
  // category with items
  const tc = await trashReq({ request: req('POST', 'https://x/api/admin/trash', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'category', id: 'c2', baseVersion: cur3.version }) }), env });
  const tcd = await tc.json();
  const cur4 = await env.MENU_KV.get('menu', { type: 'json' });
  ok(!cur4.categories.some((c) => c.id === 'c2') && !cur4.items.some((it) => it.id === 'pepsi'), 'category delete takes its items');
  const trc = await trashRestoreReq({ request: req('POST', `https://x/api/admin/trash/${tcd.trashId}/restore`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: cur4.version }) }), env, params: { id: tcd.trashId } });
  ok((await trc.json()).ok === true, 'category restore works');
  const cur5 = await env.MENU_KV.get('menu', { type: 'json' });
  ok(cur5.categories.some((c) => c.id === 'c2') && cur5.items.some((it) => it.id === 'pepsi'), 'category + items recreated');
  const t2 = await trashReq({ request: req('POST', 'https://x/api/admin/trash', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'item', id: 'zaatar', baseVersion: cur5.version }) }), env });
  const t2d = await t2.json();
  const del2 = await trashDeleteReq({ request: req('DELETE', `https://x/api/admin/trash/${t2d.trashId}`), env, params: { id: t2d.trashId } });
  ok((await del2.json()).ok === true, 'delete forever works');
  const tl2 = await (await trashReq({ request: req('GET', 'https://x/api/admin/trash'), env })).json();
  ok(!tl2.trash.some((x) => x.id === t2d.trashId), 'forever-deleted gone from list');
}

/* ---------------- 6. Export envelope + CSV route + site id ---------------- */

{
  const env = ENV();
  await seedMenu(env, makeMenu());
  const ex = await exportReq({ request: req('GET', 'https://x/api/admin/backup/export'), env });
  ok(ex.status === 200, 'export 200');
  ok((ex.headers.get('Content-Disposition') || '').startsWith('attachment; filename="chou3abelak-backup-'), 'export filename');
  const body = await ex.json();
  ok(body.format === 'chou-backup' && typeof body.sig === 'string', 'envelope shape');
  const { verifyPayload } = await import('../functions/_shared/versions.js');
  const { sig, ...payload } = body;
  ok((await verifyPayload(env, payload, sig)) === true, 'exported envelope verifies');
  ok(!JSON.stringify(body).includes('BACKUP_SECRET'), 'no secrets in envelope');
  const csv = await csvReq({ request: req('GET', 'https://x/api/admin/backup/csv'), env });
  const csvBuf = new Uint8Array(await csv.arrayBuffer());
  ok(csv.status === 200 && csvBuf[0] === 0xef && csvBuf[1] === 0xbb && csvBuf[2] === 0xbf, 'csv export BOM bytes');
  const pr = await printReq({ request: req('GET', 'https://x/api/admin/backup/print?lang=en'), env });
  const html = await pr.text();
  ok(pr.status === 200 && html.includes('<!doctype html>') && html.includes('Plain Zaatar'), 'print page renders');
  const sid1 = await getSiteId(env);
  const sid2 = await getSiteId(env);
  ok(typeof sid1 === 'string' && sid1.length > 0 && sid1 === sid2, 'stable site id');
}

summary();
