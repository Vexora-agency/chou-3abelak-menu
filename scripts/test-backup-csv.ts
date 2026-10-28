// Backup CSV regression tests: round-trip fidelity, category matching,
// custom units, price tolerance, structural garbage, JSON safety.
// Fixture-based (no server needed). Run: npx tsx scripts/test-backup-csv.ts
import { buildMenuCSV, applyCSVToMenu } from '../functions/_shared/versions-csv.js';
import { validateMenu } from '../functions/_shared/validate.js';
import { assertSafeJSON } from '../functions/_shared/versions.js';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

const fixture: any = {
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    name: { en: 'T', ar: 'ت' },
    tagline: { en: '', ar: '' },
    about: { en: '', ar: '' },
    phone: '9611123456',
    whatsapp: '96170123456',
    mapUrl: '',
    address: { en: '', ar: '' },
    hoursText: { en: '', ar: '' },
    currency: { en: 'LBP', ar: 'ل.ل.' },
    defaultLang: 'en',
    defaultTheme: 'dark',
    timezone: 'Asia/Beirut',
    featuredAutoplay: true,
    featuredAutoplayInterval: 4,
    badges: [],
    featureGroups: [
      { id: 'sizes', name: { en: 'Sizes', ar: 'مقاسات' } },
      { id: 'addons', name: { en: 'Add-ons', ar: 'إضافات' } },
    ],
    featureDefs: [
      { id: 'regular', groupId: 'sizes', name: { en: 'Regular', ar: 'عادي' } },
      { id: 'large', groupId: 'sizes', name: { en: 'Large', ar: 'كبير' } },
      { id: 'extra-veg', groupId: 'addons', name: { en: 'Extra vegetables', ar: 'خضار إضافية' } },
    ],
    ordering: {
      enabled: true, types: ['delivery'], minOrder: 0, minOrderEnabled: false,
      deliveryFee: 0, deliveryFeeEnabled: false, note: { en: '', ar: '' },
      paused: false, pausedUntil: null, pausedAt: null,
      pausedMessage: { en: '', ar: '' }, acceptWhenClosed: false,
    },
    announcement: { enabled: false, text: { en: '', ar: '' }, startsAt: null, expiresAt: null, scroll: true, speed: 'normal' },
    privacy: { extra: { en: '', ar: '' }, reviewed: false },
  },
  categories: [{ id: 'drinks', name: { en: 'Drinks', ar: 'مشروبات' }, visible: true }],
  items: [
    {
      id: 'pepsi', categoryId: 'drinks', name: { en: 'Pepsi', ar: 'بيبسي' },
      description: { en: '', ar: '' },
      pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
      badges: [], featured: true, available: true,
      addons: [{ featureId: 'extra-veg', price: 30000 }],
      variants: [
        { featureId: 'regular', price: 100000 },
        { featureId: 'large', price: 150000 },
      ],
      defaultVariant: 'regular',
    },
  ],
};

const v0: any = validateMenu(JSON.parse(JSON.stringify(fixture)));
ok('fixture validates', v0.ok === true, JSON.stringify((v0.errors || []).slice(0, 2)));
if (!v0.ok) {
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(1);
}
const menu = v0.value;

// 1. Round-trip: BOM + identical prices after export -> import
const csv = buildMenuCSV(menu);
ok('csv has BOM', csv.charCodeAt(0) === 0xfeff);
const rt: any = applyCSVToMenu(menu, csv);
const vr: any = validateMenu(rt.menu);
ok('round-trip validates', vr.ok === true, JSON.stringify((vr.errors || []).slice(0, 2)));
if (vr.ok) {
  const got = (vr.value.items as any[]).find((i: any) => i.id === 'pepsi');
  ok('round-trip prices identical',
    got && got.variants.map((x: any) => x.price).join(',') === '100000,150000'
    && got.addons[0].price === 30000);
}

// 2. New item with the EXPORTED combined category name matches
const combo = 'Drinks / مشروبات';
const r2: any = applyCSVToMenu(menu, `category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available\n"${combo}",audit-new,New,جديد,,,,75000,pc,true`);
ok('combined category resolves', r2.added === 1 && r2.skipped === 0, JSON.stringify({ a: r2.added, s: r2.skipped }));

// 3. Units: known pass, custom short labels pass, junk falls back to pc
const r3: any = applyCSVToMenu(menu, `category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available\nDrinks,audit-u1,A1,أ1,,,,100,portion,true\nDrinks,audit-u2,A2,أ2,,,,100,bottle,true\nDrinks,audit-u3,A3,أ3,,,,100,glass,true\nDrinks,audit-u4,A4,أ4,,,,100,ربطة,true\nDrinks,audit-u5,A5,أ5,,,,100,this-unit-name-is-way-too-long-for-sure-12345,true`);
const umap = new Map((r3.menu.items as any[]).filter((i: any) => String(i.id).startsWith('audit-u')).map((i: any) => [i.id, i.pricing.unit] as const));
ok('portion kept', umap.get('audit-u1') === 'portion', String(umap.get('audit-u1')));
ok('bottle kept', umap.get('audit-u2') === 'bottle', String(umap.get('audit-u2')));
ok('glass kept', umap.get('audit-u3') === 'glass', String(umap.get('audit-u3')));
ok('custom arabic kept', umap.get('audit-u4') === 'ربطة', String(umap.get('audit-u4')));
ok('junk unit falls back to pc', umap.get('audit-u5') === 'pc', String(umap.get('audit-u5')));
const v3: any = validateMenu(r3.menu);
ok('merged menu validates', v3.ok === true, JSON.stringify((v3.errors || []).slice(0, 2)));

// 4. Price tolerance: thousands separators + Arabic-Indic digits
const r4: any = applyCSVToMenu(menu, `category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available\nDrinks,audit-n1,N1,ن1,,,,"1,000",pc,true\nDrinks,audit-n2,N2,ن2,,,,٣٠٠٠٠,pc,true\nDrinks,audit-n3,N3,ن3,,,,abc,pc,true`);
const pmap = new Map((r4.menu.items as any[]).filter((i: any) => String(i.id).startsWith('audit-n')).map((i: any) => [i.id, i.pricing.price] as const));
ok('thousands separator parsed', pmap.get('audit-n1') === 1000, String(pmap.get('audit-n1')));
ok('arabic-indic parsed', pmap.get('audit-n2') === 30000, String(pmap.get('audit-n2')));
ok('bad price row skipped', !pmap.has('audit-n3') && r4.skipped >= 1, JSON.stringify({ s: r4.skipped }));

// 5. Existing item unit edit applies via CSV
const r5: any = applyCSVToMenu(menu, `category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available\n,pepsi,,,,,,,ربطة,`);
ok('existing unit edited', (r5.menu.items as any[]).find((i: any) => i.id === 'pepsi').pricing.unit === 'ربطة');
const v5: any = validateMenu(r5.menu);
ok('edited menu validates', v5.ok === true, JSON.stringify((v5.errors || []).slice(0, 2)));

// 6. New item with a variant row is skipped (sizes need the library, not CSV)
const r6: any = applyCSVToMenu(menu, `category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available\nDrinks,audit-v1,V1,ف1,regular,,,100,pc,true`);
ok('new-with-variant skipped', r6.added === 0 && r6.skipped >= 1, JSON.stringify({ a: r6.added, s: r6.skipped }));

// 7. Structural garbage throws bad_csv
for (const [name, text] of [['empty', ''], ['no-item-id', 'a,b,c\n1,2,3'], ['unclosed-quote', 'item_id\n"abc']] as const) {
  try { applyCSVToMenu(menu, text); ok(`garbage ${name} throws`, false); }
  catch (e: any) { ok(`garbage ${name} throws`, e.message === 'bad_csv', e.message); }
}

// 8. JSON safety gates
try { assertSafeJSON(JSON.parse('{"a":1,"__proto__":{"x":1}}')); ok('proto rejected', false); }
catch (e: any) { ok('proto rejected', e.message === 'unsafe_key', e.message); }
const deep: any = { a: {} };
let cur = deep.a;
for (let i = 0; i < 20; i++) { cur.n = {}; cur = cur.n; }
try { assertSafeJSON(deep); ok('deep rejected', false); }
catch (e: any) { ok('deep rejected', e.message === 'too_deep', e.message); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
