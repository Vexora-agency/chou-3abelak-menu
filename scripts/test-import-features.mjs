// Flexible custom features: auto-create/alias/bare-reject + analyze visibility.
// Real validate.js + analyze.js, fake KV. Usage: node scripts/test-import-features.mjs
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
    if (opts && opts.type === 'json') { try { return JSON.parse(e); } catch { return null; } }
    return e;
  },
  put: async (k, v) => { store.set(k, typeof v === 'string' ? v : String(v)); },
  delete: async (k) => { store.delete(k); },
};
const env = { MENU_KV: KV, SITE_PLAN: 'pro', ALLOW_LOCAL_DEV: '1' };
const { validateMenu } = await mod('functions/_shared/validate.js');
const analyzeMod = await mod('functions/api/admin/import/analyze.js');

let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { fails++; console.error(`  FAIL ${name} ${extra}`); }
  else console.log(`  ok ${name}`);
};
const S = (en, ar) => ({ en, ar });
const libDoc = (items, groups, defs) => ({
  version: 1, updatedAt: new Date().toISOString(),
  settings: {
    name: S('T', 'م'), tagline: S('', ''), logoText: 'R', phone: '', whatsapp: '', mapUrl: '',
    address: S('', ''), hoursText: S('Daily', 'يومي'), statusMode: 'auto', openTime: '12:00', closeTime: '00:00',
    workingDays: ['sat'], timezone: 'Asia/Beirut', social: {}, socialEnabled: {}, socialOrder: [],
    about: S('', ''), currency: { en: 'LBP', ar: 'ل' }, defaultTheme: 'dark', defaultLang: 'en',
    featuredAutoplay: false, featuredAutoplayInterval: 4, badges: { newDays: 14, topDays: 30, topCount: 6 },
    ordering: { enabled: false, types: ['delivery'] }, announcement: { enabled: false, text: S('', '') }, privacy: {},
    featureGroups: groups, featureDefs: defs,
  },
  categories: [{ id: 'drinks', name: S('Drinks', 'مرطبات'), visible: true, layout: 'cards' }],
  items,
});
const item = (id, variants, addons) => ({
  id, categoryId: 'drinks', name: S('Pepsi', 'بيبسي'), description: S('', ''),
  pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 100000 },
  ...(variants ? { variants } : {}), ...(addons ? { addons } : {}),
  badges: [], featured: false, available: true,
});
const LIB = {
  groups: [
    { id: 'sizes', name: S('Sizes', 'أحجام') },
    { id: 'choice', name: S('Choice', 'الاختيار') },
    { id: 'addons', name: S('Add-ons', 'إضافات') },
  ],
  defs: [
    { id: 'regular', groupId: 'choice', name: S('Regular', 'عادي') },
    { id: 'diet', groupId: 'choice', name: S('Diet', 'دايت') },
  ],
};

// 1) HIS exact file: nameless affix ids reuse library features (no 400).
{
  const doc = libDoc(
    [item('drink-pepsi', [{ featureId: 'drink-regular', price: 100000 }, { featureId: 'drink-diet', price: 100000 }])],
    LIB.groups, LIB.defs
  );
  const r = validateMenu(doc);
  const ids = r.ok ? r.value.items[0].variants.map((v) => v.featureId) : [];
  check('affix ids accepted+aliased', r.ok && ids[0] === 'regular' && ids[1] === 'diet', r.ok ? JSON.stringify(ids) : r.errors.join(' | ').slice(0, 160));
  check('no defs invented', r.ok && r.value.settings.featureDefs.length === 2);
}
// 1b) Truly unknown bare ids still fail LOUD (nothing silently invented).
{
  const doc = libDoc(
    [item('drink-pepsi', [{ featureId: 'fizzy-pop', price: 100000 }])],
    LIB.groups, LIB.defs
  );
  const r = validateMenu(doc);
  check('unknown bare ids rejected', !r.ok && r.errors.some((e) => e.includes('fizzy-pop') && e.includes('name:{en,ar}')), r.errors.join(' | ').slice(0, 160));
}
// 2) with NEW names + groups -> created in place (matching names alias instead)
{
  const doc = libDoc(
    [item('drink-pepsi', [
      { featureId: 'drink-jumbo', name: S('Jumbo', 'جامبو'), groupId: 'choice', price: 150000 },
      { featureId: 'drink-diet', name: S('Diet', 'دايت'), groupId: 'choice', price: 100000 },
    ])],
    LIB.groups, LIB.defs
  );
  const r = validateMenu(doc);
  const defs = r.ok ? r.value.settings.featureDefs : [];
  const ids = r.ok ? r.value.items[0].variants.map((v) => v.featureId) : [];
  check('named customs created', r.ok && defs.some((d) => d.id === 'drink-jumbo' && d.groupId === 'choice'), r.errors.join(' | ').slice(0, 160));
  check('matching name still aliased', r.ok && ids[1] === 'diet', JSON.stringify(ids));
}
// 3) name matching existing def -> aliased (no duplicate def)
{
  const doc = libDoc(
    [item('drink-pepsi', [
      { featureId: 'pepsi-reg', name: S('Regular', 'عادي'), price: 100000 },
      { featureId: 'diet', price: 100000 },
    ])],
    LIB.groups, LIB.defs
  );
  const r = validateMenu(doc);
  const ids = r.ok ? r.value.items[0].variants.map((v) => v.featureId) : [];
  const defCount = r.ok ? r.value.settings.featureDefs.length : -1;
  check('name match aliases to canonical', r.ok && ids[0] === 'regular' && defCount === 2, JSON.stringify(ids));
}
// 4) bogus group -> loud 400 (never silently miscategorized)
{
  const doc = libDoc(
    [item('drink-pepsi', [{ featureId: 'fizzy', name: S('Fizzy', 'فوّار'), groupId: 'nope', price: 100000 }])],
    LIB.groups, LIB.defs
  );
  const r = validateMenu(doc);
  check('bogus group rejected', !r.ok && r.errors.some((e) => e.includes('nope') && e.includes('does not exist')), r.errors.join(' | ').slice(0, 140));
}
// 5) addons: same contract (create + alias + bare-reject)
{
  const mk = (addons) => libDoc([item('zaatar', undefined, addons)], LIB.groups, LIB.defs);
  let r = validateMenu(mk([{ featureId: 'extra-hot', name: S('Extra hot', 'حار زيادة'), groupId: 'addons', price: 5000 }]));
  check('addon created', r.ok && r.value.settings.featureDefs.some((d) => d.id === 'extra-hot' && d.groupId === 'addons'), r.errors.join(' | ').slice(0, 140));
  r = validateMenu(mk([{ featureId: 'mystery', price: 5000 }]));
  check('addon bare rejected', !r.ok && r.errors.some((e) => e.includes('mystery') && e.includes('name:{en,ar}')), r.errors.join(' | ').slice(0, 140));
  r = validateMenu(mk([{ featureId: 'reg2', name: S('Regular', 'عادي'), price: 0 }]));
  check('addon aliased', r.ok && r.value.items[0].addons[0].featureId === 'regular', JSON.stringify(r.value.items[0].addons));
}
// 6) defaultVariant through alias
{
  const doc = libDoc(
    [{ ...item('drink-pepsi', [{ featureId: 'pepsi-d', name: S('Diet', 'دايت'), price: 100000 }]), defaultVariant: 'pepsi-d' }],
    LIB.groups, LIB.defs
  );
  const r = validateMenu(doc);
  check('defaultVariant follows alias', r.ok && r.value.items[0].defaultVariant === 'diet', r.errors.join(' | ').slice(0, 140));
}
// 7) analyze surfaces creations + aliases as warnings
{
  await KV.put('menu', JSON.stringify(libDoc([], LIB.groups, LIB.defs)));
  const fileDoc = libDoc(
    [item('drink-pepsi', [
      { featureId: 'brand-new-size', name: S('Jumbo', 'جامبو'), groupId: 'choice', price: 150000 },
      { featureId: 'pepsi-r', name: S('Regular', 'عادي'), price: 100000 },
    ])],
    LIB.groups, LIB.defs
  );
  const r = await analyzeMod.onRequest({
    request: new Request(BASE + '/api/admin/import/analyze?lang=en', {
      method: 'POST',
      headers: { 'X-Requested-With': 'menu-admin', Origin: BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify(fileDoc),
    }),
    env,
  });
  const j = await r.json().catch(() => ({}));
  const warns = Array.isArray(j.warnings) ? j.warnings.join(' | ') : '';
  check('analyze 200 + token', r.status === 200 && !!j.token, `got ${r.status}`);
  check('created warning names the feature', warns.includes('brand-new-size'), warns.slice(0, 200));
  check('aliased warning maps ids', warns.includes('pepsi-r') && warns.includes('regular'), warns.slice(0, 200));
}
// 8) affix guardrails: ambiguous / infix-only / single-token stay rejected.
{
  const mk = (fid) => libDoc([item('drink-pepsi', [{ featureId: fid, price: 100000 }, { featureId: 'diet', price: 100000 }])], LIB.groups, LIB.defs);
  let r = validateMenu(mk('regular-diet'));
  check('two affix matches -> ambiguous 400', !r.ok && r.errors.some((e) => e.includes('regular-diet')), r.errors.join(' | ').slice(0, 140));
  r = validateMenu(mk('super-regular-plus'));
  check('middle token never matches', !r.ok && r.errors.some((e) => e.includes('super-regular-plus')));
  r = validateMenu(mk('fizzy'));
  check('single unknown token rejected', !r.ok && r.errors.some((e) => e.includes('fizzy')));
}
// 9) prefix + underscore affix forms reuse too.
{
  const doc = libDoc(
    [item('drink-mirinda', [{ featureId: 'mirinda-regular', price: 100000 }]),
     item('drink-7up', [{ featureId: 'x7up_diet', price: 100000 }])],
    LIB.groups, LIB.defs
  );
  const r = validateMenu(doc);
  const got = (id) => (r.ok ? r.value.items.find((x) => x.id === id).variants.map((v) => v.featureId) : []);
  check('prefix form aliases', r.ok && got('drink-mirinda')[0] === 'regular', JSON.stringify(got('drink-mirinda')));
  check('underscore form aliases', r.ok && got('drink-7up')[0] === 'diet', JSON.stringify(got('drink-7up')));
}

if (fails) { console.error(`import-features: ${fails} FAILURES`); process.exit(1); }
console.log('import-features: all green');
