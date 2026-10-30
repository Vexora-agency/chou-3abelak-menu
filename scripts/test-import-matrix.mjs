// Delete-group then re-import matrix (signed+settings / signed-off / unsigned).
// Real apply.js + signing modules, fake KV. Guards the import contract.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const BASE = 'http://127.0.0.1:8788';

const store = new Map();
const KV = {
  get: async (k, opts) => {
    const e = store.get(k);
    if (e === undefined) return null;
    if (opts && opts.type === 'json') { try { return JSON.parse(e.value); } catch { return null; } }
    return e.value;
  },
  put: async (k, v, opts) => { store.set(k, { value: String(v), metadata: (opts && opts.metadata) || null }); },
  delete: async (k) => { store.delete(k); },
  list: async (opts) => ({
    keys: [...store.entries()].filter(([k]) => k.startsWith((opts && opts.prefix) || '')).map(([name, e]) => ({ name, metadata: e.metadata })),
    list_complete: true, cursor: '',
  }),
};
const env = { MENU_KV: KV, SITE_PLAN: 'pro', BACKUP_SECRET: 'harness-secret-123', ALLOW_LOCAL_DEV: '1' };
const applyMod = await mod('functions/api/admin/import/apply.js');
const { signPayload, verifyPayload } = await mod('functions/_shared/versions-signing.js');

let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { fails++; console.error(`  FAIL ${name} ${extra}`); }
  else console.log(`  ok ${name}`);
};
const H = { 'X-Requested-With': 'menu-admin', Origin: BASE, 'Content-Type': 'application/json' };

// minimal valid doc: 1 item with variants + addon, library with 2 groups
const S = (en, ar) => ({ en, ar });
const baseDoc = (v) => ({
  version: v, updatedAt: new Date().toISOString(),
  settings: {
    name: S('T', 'م'), tagline: S('', ''), logoText: 'R', phone: '', whatsapp: '', mapUrl: '',
    address: S('', ''), hoursText: S('Daily', 'يومي'), statusMode: 'auto', openTime: '12:00', closeTime: '00:00',
    workingDays: ['sat'], timezone: 'Asia/Beirut', social: {}, socialEnabled: {}, socialOrder: [],
    about: S('', ''), currency: { en: 'LBP', ar: 'ل' }, defaultTheme: 'dark', defaultLang: 'en',
    featuredAutoplay: false, featuredAutoplayInterval: 4, badges: { newDays: 14, topDays: 30, topCount: 6 },
    ordering: { enabled: false, types: ['delivery'] },
    announcement: { enabled: false, text: S('', '') },
    privacy: {},
    featureGroups: [
      { id: 'sizes', name: S('Sizes', 'أحجام') },
      { id: 'addons', name: S('Add-ons', 'إضافات') },
    ],
    featureDefs: [
      { id: 'regular', groupId: 'sizes', name: S('Regular', 'عادي') },
      { id: 'mashrouha', groupId: 'sizes', name: S('Mashrouha', 'مشروحة') },
      { id: 'extra-veg', groupId: 'addons', name: S('Extra vegetables', 'إضافة خضرة') },
    ],
  },
  categories: [{ id: 'manakish', name: S('Manakish', 'مناقيش'), visible: true, layout: 'list' }],
  items: [{
    id: 'zaatar', categoryId: 'manakish', name: S('Zaatar', 'زعتر'), description: S('', ''),
    pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
    variants: [{ featureId: 'regular', price: 80000 }, { featureId: 'mashrouha', price: 120000 }],
    addons: [{ featureId: 'extra-veg', price: 30000 }],
    badges: [], featured: false, available: true,
  }],
});
await KV.put('menu', JSON.stringify(baseDoc(1)));

// signing round-trip (what makes an export "signed")
{
  const env2 = { menu: baseDoc(1), siteId: 'x', exportedAt: new Date().toISOString() };
  const { backupEnvelope } = await mod('functions/_shared/versions.js');
  const sig = await signPayload(env, backupEnvelope(env2));
  check('signature verifies', await verifyPayload(env, backupEnvelope(env2), sig));
  check('tampered fails', !(await verifyPayload(env, { ...backupEnvelope(env2), menu: baseDoc(2) }, sig)));
}

// replicate FeaturesSection group-delete (addons): strip defs + refs
const stripAddonsGroup = (doc) => {
  const gone = new Set(doc.settings.featureDefs.filter((d) => d.groupId === 'addons').map((d) => d.id));
  const items = doc.items.map((it) => ({ ...it, addons: (it.addons || []).filter((a) => !gone.has(a.featureId)) }));
  return {
    ...doc,
    items: items.map((it) => ({ ...it, addons: it.addons.length ? it.addons : undefined })),
    settings: {
      ...doc.settings,
      featureGroups: doc.settings.featureGroups.filter((g) => g.id !== 'addons'),
      featureDefs: doc.settings.featureDefs.filter((d) => !gone.has(d.id)),
    },
  };
};
const apply = async (token, includeSettings) => {
  const r = await applyMod.onRequest({
    request: new Request(BASE + '/api/admin/import/apply', { method: 'POST', headers: H, body: JSON.stringify({ token, includeSettings }) }),
    env,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const stage = async (doc, signed) => {
  const token = 'a'.repeat(31) + Math.floor(Math.random() * 10);
  await KV.put(`import:${token}`, JSON.stringify({ kind: 'json', doc, signed, session: 'local', fileName: 'backup.json' }), { expirationTtl: 900 });
  return token;
};
const liveDoc = () => JSON.parse(store.get('menu').value);

// A) signed + settings checkbox -> EVERYTHING returns
{
  const exported = baseDoc(1); // full export as signed at export time
  const stripped = stripAddonsGroup(JSON.parse(JSON.stringify(exported)));
  stripped.version = 2;
  await KV.put('menu', JSON.stringify(stripped)); // owner deleted the section + saved
  const afterDel = liveDoc();
  check('group gone', !afterDel.settings.featureGroups.some((g) => g.id === 'addons'));
  check('addon stripped from item', !(afterDel.items[0].addons || []).length);
  const tok = await stage(exported, true);
  const r = await apply(tok, true);
  check('signed+settings 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  const now = liveDoc();
  check('group restored', now.settings.featureGroups.some((g) => g.id === 'addons'));
  check('def restored', now.settings.featureDefs.some((d) => d.id === 'extra-veg'));
  check('item addon restored', (now.items[0].addons || []).some((a) => a.featureId === 'extra-veg' && a.price === 30000));
}
// B) signed WITHOUT checkbox -> groups do NOT return (settings untouched)
{
  const exported = baseDoc(9);
  const stripped = stripAddonsGroup(JSON.parse(JSON.stringify(exported)));
  stripped.version = 10;
  await KV.put('menu', JSON.stringify(stripped));
  const tok = await stage(exported, true);
  const r = await apply(tok, false);
  console.log(`  info unsigned-equivalent apply: status=${r.status} body=${JSON.stringify(r.body).slice(0, 120)}`);
  const now = liveDoc();
  check('B: groups stay deleted', !now.settings.featureGroups.some((g) => g.id === 'addons'));
}
// C) unsigned file (signed:false) -> same as B
{
  const exported = baseDoc(20);
  const stripped = stripAddonsGroup(JSON.parse(JSON.stringify(exported)));
  stripped.version = 21;
  await KV.put('menu', JSON.stringify(stripped));
  const tok = await stage(exported, false);
  const r = await apply(tok, false);
  console.log(`  info unsigned apply: status=${r.status} body=${JSON.stringify(r.body).slice(0, 120)}`);
  const now = liveDoc();
  check('C: groups stay deleted', !now.settings.featureGroups.some((g) => g.id === 'addons'));
}

if (fails) { console.error(`import-matrix: ${fails} FAILURES`); process.exit(1); }
console.log('import-matrix: all green (real apply.js)');
