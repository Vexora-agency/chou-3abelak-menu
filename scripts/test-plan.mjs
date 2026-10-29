// Plan tiers + feature gates: starter (menu display) < pro (full ordering).
// Covers: getPlan/hasFeature matrix, save-scrub, and every gated endpoint
// answering 404 on starter while staying open on pro. Safety endpoints
// (trash POST delete-with-undo, trash restore-by-id) must stay open on ALL
// plans — asserted behaviorally, not just by status code.
// Run: node scripts/test-plan.mjs
import { FEATURES, PLANS, applyPlanToSettings, getPlan, hasFeature } from '../functions/_shared/plan.js';
import { onRequest as menuReq } from '../functions/api/admin/menu.js';
import { onRequest as exportReq } from '../functions/api/admin/backup/export.js';
import { onRequest as csvReq } from '../functions/api/admin/backup/csv.js';
import { onRequest as printReq } from '../functions/api/admin/backup/print.js';
import { onRequest as autoReq } from '../functions/api/admin/backup/auto.js';
import { onRequest as analyzeReq } from '../functions/api/admin/import/analyze.js';
import { onRequest as applyReq } from '../functions/api/admin/import/apply.js';
import { onRequest as versionsReq } from '../functions/api/admin/versions.js';
import { onRequest as changesReq } from '../functions/api/admin/versions/[id]/changes.js';
import { onRequest as restoreReq } from '../functions/api/admin/versions/[id]/restore.js';
import { onRequest as trashReq } from '../functions/api/admin/trash.js';
import { onRequest as trashDeleteReq } from '../functions/api/admin/trash/[id].js';
import { onRequest as trashRestoreReq } from '../functions/api/admin/trash/[id]/restore.js';
import { onRequest as activityReq } from '../functions/api/admin/activity.js';
import { onRequest as ordersReq } from '../functions/api/admin/orders.js';
import { onRequest as orderPatchReq } from '../functions/api/admin/orders/[id].js';
import { createAsserts, makeKV, makeReq as req, readJson as json } from './_helpers/shared.mjs';
import { makeMenu } from './_helpers/backup-fixture.mjs';

const { ok, summary } = createAsserts();
const J = { headers: { 'Content-Type': 'application/json' } };

/* ---------------- 1. Tier matrix ---------------- */

ok(JSON.stringify(PLANS) === JSON.stringify(['starter', 'pro']), 'tiers are starter/pro in order');
ok(getPlan({}) === 'starter', 'missing env defaults to starter');
ok(getPlan({ SITE_PLAN: 'enterprise' }) === 'starter', 'unknown plan fails closed to starter');
ok(getPlan({ SITE_PLAN: 'plus' }) === 'pro', 'retired plus aliases to pro (no flag day)');
ok(getPlan({ SITE_PLAN: 'signature' }) === 'pro', 'retired signature aliases to pro');
ok(getPlan({ SITE_PLAN: '  PRO ' }) === 'pro', 'plan is trimmed + lowercased');

for (const f of Object.keys(FEATURES)) {
  ok(hasFeature({ SITE_PLAN: 'starter' }, f) === false, `${f} off on starter`);
  ok(hasFeature({ SITE_PLAN: 'pro' }, f) === true, `${f} on pro`);
}
ok(hasFeature({ SITE_PLAN: 'plus' }, 'monthlyReports') === true, 'retired plus keeps working (alias)');
ok(hasFeature({ SITE_PLAN: 'plus' }, 'nope') === false, 'unknown feature fails closed');

/* ---------------- 2. Save scrub ---------------- */

const withAnn = () => {
  const m = makeMenu();
  m.settings.announcement = { enabled: true, text: { en: 'Sale!', ar: 'تخفيض!' }, startsAt: null, expiresAt: null };
  return m;
};
const INERT = { enabled: false, text: { en: '', ar: '' }, startsAt: null, expiresAt: null };
{
  // Starter with no stored announcement: inert block (nothing to show).
  const s = applyPlanToSettings({ SITE_PLAN: 'starter' }, withAnn().settings, null);
  ok(s.announcement && s.announcement.enabled === false, 'starter scrub disables announcement');
  ok(s.announcement.text.en === '' && s.announcement.text.ar === '', 'starter scrub empties announcement text');
  ok(s.phone === '70123456' && s.ordering.enabled === false, 'starter scrub preserves everything else');
  // Starter WITH a stored (Pro-era) announcement: frozen byte-identical, not wiped.
  const live = { enabled: true, text: { en: 'Sale!', ar: 'تخفيض!' }, startsAt: null, expiresAt: null };
  const f = applyPlanToSettings({ SITE_PLAN: 'starter' }, withAnn().settings, live);
  ok(f.announcement === live, 'starter save freezes (not wipes) the stored announcement');
  // Starter cannot smuggle a NEW announcement past the hidden UI.
  const smuggle = applyPlanToSettings(
    { SITE_PLAN: 'starter' },
    { ...withAnn().settings, announcement: { enabled: true, text: { en: 'HACK', ar: '' }, startsAt: null, expiresAt: null } },
    { enabled: false, text: { en: '', ar: '' }, startsAt: null, expiresAt: null }
  );
  ok(smuggle.announcement.enabled === false && smuggle.announcement.text.en === '', 'starter save cannot enable announcements');
  const kept = applyPlanToSettings({ SITE_PLAN: 'pro' }, withAnn().settings, null);
  ok(kept.announcement.enabled === true, 'pro save keeps announcement');
  ok(applyPlanToSettings({ SITE_PLAN: 'starter' }, null, null) === null, 'scrub is null-safe');
}

/* ---------------- 3. Endpoint gates ---------------- */

const kvWithMenu = () => {
  const kv = makeKV();
  return { kv, seed: () => kv.put('menu', JSON.stringify(makeMenu())) };
};

async function expect404(fn, label) {
  const r = await fn({ SITE_PLAN: 'starter', MENU_KV: makeKV() });
  const d = await json(r);
  ok(r.status === 404 && !!d && d.error === 'not_found', `${label} 404s on starter`);
}

async function expectOpen(fn, label) {
  const { kv, seed } = kvWithMenu();
  await seed();
  const r = await fn({ SITE_PLAN: 'pro', MENU_KV: kv });
  ok(r.status !== 404, `${label} stays open on pro (got ${r.status})`);
}

// backups feature
await expect404((env) => exportReq({ request: req('GET', 'https://x/api/admin/backup/export'), env }), 'backup export');
await expect404((env) => csvReq({ request: req('GET', 'https://x/api/admin/backup/csv'), env }), 'backup csv');
await expect404((env) => printReq({ request: req('GET', 'https://x/api/admin/backup/print?lang=en'), env }), 'backup print');
await expect404((env) => autoReq({ request: req('PUT', 'https://x/api/admin/backup/auto', { ...J, body: JSON.stringify({ enabled: true }) }), env }), 'backup auto switch');
await expect404((env) => analyzeReq({ request: req('POST', 'https://x/api/admin/import/analyze?lang=en', { ...J, body: '{}' }), env }), 'import analyze');
await expect404((env) => applyReq({ request: req('POST', 'https://x/api/admin/import/apply', { ...J, body: JSON.stringify({ token: '0'.repeat(32) }) }), env }), 'import apply');
await expect404((env) => versionsReq({ request: req('GET', 'https://x/api/admin/versions'), env }), 'versions list');
await expect404((env) => changesReq({ request: req('GET', 'https://x/api/admin/versions/abc/changes?lang=en'), env, params: { id: 'abc' } }), 'version changes');
await expect404((env) => restoreReq({ request: req('POST', 'https://x/api/admin/versions/abc/restore', { ...J, body: '{}' }), env, params: { id: 'abc' } }), 'version restore');
await expect404((env) => trashReq({ request: req('GET', 'https://x/api/admin/trash'), env }), 'trash list');
await expect404((env) => trashDeleteReq({ request: req('DELETE', 'https://x/api/admin/trash/abc'), env, params: { id: 'abc' } }), 'trash delete-forever');
await expect404((env) => activityReq({ request: req('GET', 'https://x/api/admin/activity'), env }), 'activity feed');
// orderLogging feature
await expect404((env) => ordersReq({ request: req('GET', 'https://x/api/admin/orders?limit=1'), env }), 'admin orders list');
await expect404((env) => orderPatchReq({ request: req('PATCH', 'https://x/api/admin/orders/abc', { ...J, body: JSON.stringify({ status: 'confirmed' }) }), env, params: { id: 'abc' } }), 'admin order status');

// pro stays open (gate passed; later stages may 401/503 without session — only 404 would mean over-blocking)
await expectOpen((env) => exportReq({ request: req('GET', 'https://x/api/admin/backup/export'), env }), 'backup export');
await expectOpen((env) => versionsReq({ request: req('GET', 'https://x/api/admin/versions'), env }), 'versions list');
await expectOpen((env) => trashReq({ request: req('GET', 'https://x/api/admin/trash'), env }), 'trash list');
await expectOpen((env) => activityReq({ request: req('GET', 'https://x/api/admin/activity'), env }), 'activity feed');

/* ---------------- 4. Safety stays open on starter ---------------- */

{
  // Trash POST (delete-with-undo) must work on starter: seed a menu, delete
  // an item, expect success — behaviorally, not just by status code.
  const kv = makeKV();
  await kv.put('menu', JSON.stringify(makeMenu()));
  const env = { SITE_PLAN: 'starter', MENU_KV: kv };
  const r = await trashReq({
    request: req('POST', 'https://x/api/admin/trash', { ...J, body: JSON.stringify({ kind: 'item', id: 'pepsi', baseVersion: 1 }) }),
    env,
  });
  const d = await json(r);
  ok(r.status === 200 && !!d && d.ok === true && typeof d.trashId === 'string', 'starter trash POST (undo safety) works');
  // ...and the undo path (restore-by-id) works too.
  const r2 = await trashRestoreReq({
    request: req('POST', `https://x/api/admin/trash/${d.trashId}/restore`, { ...J, body: JSON.stringify({ baseVersion: 2 }) }),
    env,
    params: { id: d.trashId },
  });
  const d2 = await json(r2);
  ok(r2.status === 200 && !!d2 && d2.ok === true, 'starter trash restore-by-id (undo) works');
}

/* ---------------- 5. Starter save scrubs announcements ---------------- */

{
  const kv = makeKV();
  await kv.put('menu', JSON.stringify(makeMenu()));
  const env = { SITE_PLAN: 'starter', MENU_KV: kv };
  const doc = withAnn();
  const r = await menuReq({
    request: req('PUT', 'https://x/api/admin/menu', { ...J, body: JSON.stringify(doc) }),
    env,
  });
  const d = await json(r);
  ok(r.status === 200 && !!d && !!d.settings && !!d.settings.announcement && d.settings.announcement.enabled === false, 'starter menu save forces announcement off');
  ok(!!d && !!d.settings && d.settings.phone === '70123456', 'starter menu save preserves the rest');
}

{
  // Downgrade freeze at PUT level: stored live announcement + starter save
  // (any edit) returns the SAME announcement object, byte-identical.
  const kv = makeKV();
  const stored = withAnn();
  await kv.put('menu', JSON.stringify(stored));
  const env = { SITE_PLAN: 'starter', MENU_KV: kv };
  const edit = withAnn();
  edit.items = [...edit.items];
  const r = await menuReq({
    request: req('PUT', 'https://x/api/admin/menu', { ...J, body: JSON.stringify(edit) }),
    env,
  });
  const d = await json(r);
  ok(
    r.status === 200 && !!d && !!d.settings &&
    d.settings.announcement.text.en === 'Sale!' && d.settings.announcement.enabled === true,
    'starter save freezes stored announcement (downgrade-safe)'
  );
}

summary();
