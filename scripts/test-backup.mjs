// Unit + route tests for Backup & History: diffMenus, signatures, CSV round
// trip (Arabic), import token single-use/expiry, restore safety snapshot,
// trash restore, autosave coalescing, unsigned-can-never-touch-WhatsApp.
// Run: node scripts/test-backup.mjs
import { diffMenus, summarizeChanges } from '../functions/_shared/diff.js';
import {
  applyCSVToMenu,
  backupEnvelope,
  buildMenuCSV,
  buildPrintHTML,
  getSiteId,
  parseCSV,
  signPayload,
  verifyPayload,
} from '../functions/_shared/versions.js';
import { validateMenu } from '../functions/_shared/validate.js';
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

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

/* ---------------- Fake KV ---------------- */

function makeKV() {
  const store = new Map(); // key -> { value, metadata, expiresAt }
  return {
    __store: store,
    __expire(key) {
      const e = store.get(key);
      if (e) e.expiresAt = Date.now() - 1;
    },
    async get(key, opts) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt && Date.now() > e.expiresAt) {
        store.delete(key);
        return null;
      }
      if (opts && opts.type === 'json') {
        try {
          return JSON.parse(e.value);
        } catch {
          return null;
        }
      }
      return e.value;
    },
    async put(key, value, opts) {
      const o = opts || {};
      store.set(key, {
        value: typeof value === 'string' ? value : String(value),
        metadata: o.metadata,
        expiresAt: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0,
      });
    },
    async delete(key) {
      store.delete(key);
    },
    async list(opts) {
      const prefix = (opts && opts.prefix) || '';
      const limit = (opts && opts.limit) || 1000;
      const keys = [];
      for (const [name, e] of store) {
        if (!name.startsWith(prefix)) continue;
        if (e.expiresAt && Date.now() > e.expiresAt) continue;
        keys.push({ name, metadata: e.metadata });
        if (keys.length >= limit) break;
      }
      return { keys };
    },
  };
}

const H = { 'X-Requested-With': 'menu-admin', Origin: 'https://x' };
function req(method, url, { headers, body } = {}) {
  return new Request(url, {
    method,
    headers: { ...H, ...(headers || {}) },
    body: body === undefined ? undefined : body,
  });
}
async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/* ---------------- Fixture menu (must validate) ---------------- */

function bi(en, ar) {
  return { en, ar };
}
function makeMenu() {
  return {
    version: 1,
    schemaVersion: 2,
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      name: bi('Chou 3abelak', 'شو عبالك'),
      tagline: bi('Fresh', 'طازج'),
      address: bi('', ''),
      hoursText: bi('Daily', 'يومي'),
      currency: bi('LBP', 'ل.ل'),
      logoText: 'C',
      phone: '70123456',
      whatsapp: '96170123456',
      mapUrl: '',
      statusMode: 'auto',
      openTime: '12:00',
      closeTime: '00:00',
      workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'],
      timezone: 'Asia/Beirut',
      social: {},
      socialEnabled: {},
      about: bi('', ''),
      ordering: { enabled: false, types: ['delivery'], minOrder: 0, minOrderEnabled: false, deliveryFee: 0, deliveryFeeEnabled: false, note: bi('', '') },
      featureGroups: [{ id: 'sizes', name: bi('Sizes', 'الأحجام') }],
      featureDefs: [
        { id: 'small', groupId: 'sizes', name: bi('Small', 'صغير') },
        { id: 'large', groupId: 'sizes', name: bi('Large', 'كبير') },
      ],
      badges: { newDays: 14, topDays: 30, topCount: 6 },
    },
    categories: [
      { id: 'c1', name: bi('Pies', 'فطائر'), visible: true },
      { id: 'c2', name: bi('Drinks', 'مشروبات'), visible: true },
    ],
    items: [
      {
        id: 'zaatar', categoryId: 'c1', name: bi('Plain Zaatar', 'زعتر سادة'), description: bi('', ''),
        pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 150000 },
        addons: [], badges: [], featured: false, available: true,
      },
      {
        id: 'mash', categoryId: 'c1', name: bi('Mashrouha, "Special"', 'مشروحة'), description: bi('', ''),
        pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
        variants: [{ featureId: 'small', price: 200000 }, { featureId: 'large', price: 350000 }],
        addons: [], badges: [], featured: false, available: true,
      },
      {
        id: 'pepsi', categoryId: 'c2', name: bi('Pepsi', 'بيبسي'), description: bi('', ''),
        pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 30000 },
        addons: [], badges: [], featured: false, available: true,
      },
    ],
    addonGroups: [],
  };
}

const ENV = () => ({ MENU_KV: makeKV(), BACKUP_SECRET: 'test-backup-secret-1234567890' });

/* ---------------- 1. diffMenus ---------------- */

{
  const a = makeMenu();
  const b = JSON.parse(JSON.stringify(a));
  ok(diffMenus(a, JSON.parse(JSON.stringify(a)), 'en').length === 0, 'identical menus: no changes');
  // price change
  b.items[0].pricing.price = 160000;
  let ch = diffMenus(a, b, 'en');
  ok(ch.length === 1 && ch[0].kind === 'changed' && ch[0].detail === 'Price 150,000 → 160,000', `price detail (${ch[0] && ch[0].detail})`);
  // arabic detail prefix enables price counting
  const chAr = diffMenus(a, b, 'ar');
  ok(chAr[0].detail.startsWith('السعر'), 'arabic price prefix');
  ok(summarizeChanges(ch).prices === 1 && summarizeChanges(chAr).prices === 1, 'price counting both languages');
  // availability + category move + rename + variant price
  b.items[2].available = false;
  b.items[2].categoryId = 'c1';
  b.items[1].name.en = 'Mashrouha Special';
  b.items[1].variants[0].price = 210000;
  ch = diffMenus(a, b, 'en');
  ok(ch.some((c) => c.detail === 'Availability: Available → Hidden'), 'availability detail');
  ok(ch.some((c) => c.detail === 'Category: Drinks → Pies'), 'category move detail');
  ok(ch.some((c) => c.detail === 'Name: Mashrouha, "Special" → Mashrouha Special'), 'rename detail');
  ok(ch.some((c) => c.scope === 'item' && c.detail.startsWith('Variants:')), 'variant change detail');
  // removed item + added category + renamed category
  const c = JSON.parse(JSON.stringify(a));
  c.items = c.items.filter((it) => it.id !== 'pepsi');
  c.categories.push({ id: 'c3', name: bi('Desserts', 'حلويات'), visible: true });
  c.categories[0].name.en = 'Pies!';
  ch = diffMenus(a, c, 'en');
  ok(ch.some((x) => x.kind === 'removed' && x.label === 'Pepsi'), 'removed item');
  ok(ch.some((x) => x.kind === 'added' && x.scope === 'category' && x.label === 'Desserts'), 'added category');
  ok(ch.some((x) => x.detail === 'Name: Pies → Pies!'), 'renamed category');
  // sensitive settings
  const d = JSON.parse(JSON.stringify(a));
  d.settings.whatsapp = '96170999999';
  d.settings.ordering.enabled = true;
  d.settings.timezone = 'UTC';
  ch = diffMenus(a, d, 'en');
  ok(ch.some((x) => x.label === 'WhatsApp number' && x.sensitive), 'whatsapp sensitive');
  ok(ch.some((x) => x.label === 'Online ordering' && x.sensitive), 'ordering sensitive');
  ok(ch.some((x) => x.label === 'Timezone' && x.sensitive), 'timezone sensitive');
  // cap at 500
  const big = JSON.parse(JSON.stringify(a));
  for (let i = 0; i < 600; i++) {
    big.items.push({ ...JSON.parse(JSON.stringify(a.items[0])), id: `x${i}`, categoryId: 'c1' });
  }
  ok(diffMenus(a, big, 'en').length === 500, 'changes capped at 500');
}

/* ---------------- 2. Signatures ---------------- */

{
  const { backupEnvelope, signPayload, verifyPayload } = await import('../functions/_shared/versions.js');
  const env2 = { BACKUP_SECRET: 'test-backup-secret-1234567890' };
  const menu = makeMenu();
  const payload = backupEnvelope({ menu, siteId: 'site1', exportedAt: '2026-01-01T00:00:00.000Z' });
  const sig = await signPayload(env2, payload);
  ok(/^[0-9a-f]{64}$/.test(sig), 'sig shape');
  ok((await verifyPayload(env2, payload, sig)) === true, 'valid sig verifies');
  const tampered = { ...payload, menu: { ...menu, items: [] } };
  ok((await verifyPayload(env2, tampered, sig)) === false, 'tampered file fails verification');
  ok((await verifyPayload({ BACKUP_SECRET: 'other-secret-12345678901234' }, payload, sig)) === false, 'wrong secret fails');
  ok((await verifyPayload(env2, payload, null)) === false, 'missing sig is unsigned');
}

/* ---------------- 3. CSV round trip + print XSS ---------------- */

{
  const menu = makeMenu();
  const csv = buildMenuCSV(menu);
  ok(csv.charCodeAt(0) === 0xfeff, 'menu CSV BOM');
  const noBom = csv.replace(/^﻿/, '');
  ok(noBom.split('\n')[0] === 'category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available', 'menu CSV header');
  ok(csv.includes('مشروحة') && csv.includes('"Mashrouha, ""Special""'), 'CSV Arabic + quoting');
  // change a price, drop a row (must NOT delete), add unknown id (skipped)
  const lines = noBom.trim().split('\n');
  const body = lines.slice(1).filter((l) => !l.includes(',pepsi,'));
  const tweaked = [lines[0], ...body.map((l) => (l.includes(',zaatar,') ? l.replace(',150000,', ',170000,') : l)), 'Pies,ghost,Ghost,شبح,,,,50000,pc,true', 'Nope,ghost2,Ghost2,شبح2,,,,50000,pc,true'].join('\n');
  const applied = applyCSVToMenu(menu, tweaked);
  const v = validateMenu(applied.menu);
  ok(v.ok, 'merged CSV menu validates');
  ok(v.value.items.find((it) => it.id === 'zaatar').pricing.price === 170000, 'CSV price update applies');
  ok(v.value.items.some((it) => it.id === 'pepsi'), 'dropped CSV row never deletes');
  ok(applied.added === 1 && applied.skipped === 1, 'known-category adds, unknown-category skips');
  // print page escapes everything
  const evil = makeMenu();
  evil.items[0].name.en = '<script>alert(1)</script>';
  const html = buildPrintHTML(evil, 'en');
  ok(!html.includes('<script>alert'), 'print escapes item names');
  ok(html.includes('&lt;script&gt;'), 'print shows escaped text');
  ok(html.includes('A4') && html.includes('Chou 3abelak'), 'print has A4 + brand');
}

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
