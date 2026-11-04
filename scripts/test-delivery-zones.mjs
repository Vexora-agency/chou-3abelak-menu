/**
 * Delivery-zones test: frontend (src/utils/deliveryZones.ts) vs backend
 * (functions/_shared/delivery-zones.js) must stay behavior-identical,
 * plus settings validation and the server-side order gate.
 * Run: npx tsx scripts/test-delivery-zones.mjs (or: npm run test:delivery-zones)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as FE from '../src/utils/deliveryZones.ts';
import * as BE from '../functions/_shared/delivery-zones.js';
import { validateMenu } from '../functions/_shared/validate.js';
import { validateOrderInput } from '../functions/_shared/orders.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; /* console.log('PASS', name); */ }
  else { fail++; console.log('FAIL', name, extra); }
};
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'undefined';
};
const same = (a, b, name) => ok(stable(a) === stable(b), `parity: ${name}`, `\nFE=${stable(a)}\nBE=${stable(b)}`);

// ---- geodata files exist and look right ----
const countries = JSON.parse(readFileSync(join(ROOT, 'src/data/geo/countries.json'), 'utf8'));
ok(Array.isArray(countries) && countries.length >= 240 && countries.every((c) => /^[A-Z]{2}$/.test(c.cc)) && countries.every((c) => typeof c.en === 'string' && c.en), 'countries.json: 240+ entries with cc+en');
ok(countries.filter((c) => typeof c.ar === 'string' && c.ar).length >= 240, 'countries.json: Arabic names throughout');
const lb = JSON.parse(readFileSync(join(ROOT, 'public/geo/subdivisions/LB.json'), 'utf8'));
ok(Array.isArray(lb) && lb.length === 9 && lb.every((s) => typeof s.code === 'string' && s.code.startsWith('LB-')), 'LB subdivisions: 9 governorates with codes');
ok(lb.every((s) => typeof s.ar === 'string' && s.ar), 'LB subdivisions: bilingual');
const kj = lb.find((s) => s.code === 'LB-KJ');
ok(!!kj && Array.isArray(kj.aliases) && kj.aliases.includes('jounieh') === false && kj.aliases.includes('jbeil'), 'LB-KJ has name aliases (no city aliases)');

// ---- normalize twins agree ----
const normCases = [
  [undefined, 'empty'],
  [{ mode: 'everywhere' }, 'bad mode defaults'],
  [{ mode: 'selected', maxKm: 'x', countries: [{ cc: 'lb' }] }, 'lowercase cc uppercased'],
  [{ mode: 'selected', maxKm: 0, countries: [{ cc: 'LB', subdivisions: [] }] }, 'empty subdivisions dropped'],
  [{ mode: 'selected', maxKm: 5000, countries: [{ cc: 'XX' }, { cc: 'LB', subdivisions: 'ALL' }, { cc: 'LB' }] }, 'unknown cc dropped, dupes merged'],
  [{ mode: 'selected', maxKm: 50, countries: [{ cc: 'EG', subdivisions: ['eg-alx', 'BAD CODE!!', 'EG-ASN', 'eg-alx'] }] }, 'subdivisions cleaned+deduped'],
];
for (const [input, name] of normCases) {
  same(FE.normalizeDeliveryZones(input), BE.normalizeDeliveryZones(input), `normalize ${name}`);
}
ok(FE.normalizeDeliveryZones({ mode: 'selected', countries: [{ cc: 'LB', subdivisions: 'ALL' }] }).maxKm === 100, 'default maxKm 100');
ok(FE.normalizeDeliveryZones({ mode: 'selected', maxKm: -5 }).maxKm === 100, 'bad maxKm falls back');

// ---- matcher twins agree (with and without subdivision data) ----
const zonesLB = { mode: 'selected', maxKm: 100, countries: [{ cc: 'LB', subdivisions: ['LB-BA', 'LB-JL'] }] };
const zonesAllLB = { mode: 'selected', maxKm: 100, countries: [{ cc: 'LB', subdivisions: 'ALL' }] };
const matchCases = [
  [zonesLB, 'LB', { code: 'LB-BA', name: 'Beirut' }, 'beirut by code'],
  [zonesLB, 'lb', { code: 'lb-jl', name: 'x' }, 'case-insensitive code'],
  [zonesLB, 'LB', { code: null, name: 'جبل لبنان' }, 'arabic name match'],
  [zonesLB, 'LB', { code: 'LB-AS', name: 'Tripoli' }, 'unserved governorate blocked'],
  [zonesLB, 'EG', null, 'unlisted country blocked'],
  [zonesAllLB, 'LB', { code: 'LB-AK', name: null }, 'ALL covers subdivisions'],
  [zonesAllLB, 'SY', { code: null, name: 'Damascus' }, 'ALL still country-scoped'],
  [{ mode: 'all', maxKm: 100, countries: [] }, 'JP', { code: null, name: null }, 'open mode serves everywhere'],
];
for (const [z, cc, sub, name] of matchCases) {
  const a = FE.matchZone(z, cc, sub, lb);
  const b = BE.matchZone(z, cc, sub, lb);
  ok(a === b, `matcher agrees (${name})`, `FE=${a} BE=${b}`);
}
// Jounieh special: BDC may return Mount Lebanon for it — matches JL when served.
ok(FE.matchZone(zonesLB, 'LB', { code: null, name: 'Jounieh' }, lb) === false, 'jounieh city name alone does not match (needs JL via code)');
// Keserwan-Jbeil (no ISO code): name + alias matching works.
const zonesKJ = { mode: 'selected', maxKm: 100, countries: [{ cc: 'LB', subdivisions: ['LB-KJ'] }] };
ok(FE.matchZone(zonesKJ, 'LB', { code: null, name: 'Keserwan' }, lb) === true, 'KJ matched by alias');
ok(BE.matchZone(zonesKJ, 'LB', { code: null, name: 'كسروان' }, lb) === true, 'KJ matched by arabic alias (BE twin)');
ok(FE.matchZone(zonesKJ, 'LB', { code: null, name: 'Beirut' }, lb) === false, 'KJ zone rejects Beirut');
// Unknown subdivision with no data loaded: country-level approval (documented fail-open).
ok(FE.matchZone(zonesLB, 'LB', { code: null, name: 'Mystery' }, null) === true, 'no subdiv data -> country-level approval');
// isDeliveryBlocked gates on delivery only.
ok(FE.isDeliveryBlocked(zonesLB, 'delivery', 'FR', null, lb) === true, 'blocked: delivery to unserved country');
ok(FE.isDeliveryBlocked(zonesLB, 'pickup', 'FR', null, lb) === false, 'pickup never zone-blocked');

// ---- settings validation (server) ----
const baseDoc = () => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  settings: {
    name: { en: 'T', ar: 'ت' }, tagline: { en: '', ar: '' }, logoText: 'T',
    phone: '+96170123456', whatsapp: '96170123456', mapUrl: '', address: { en: '', ar: '' },
    hoursText: { en: '', ar: '' }, statusMode: 'auto', openTime: '12:00', closeTime: '00:00',
    workingDays: ['sat'], timezone: 'Asia/Beirut',
    social: {}, socialEnabled: { instagram: true, facebook: true, whatsapp: true },
    socialOrder: ['instagram', 'facebook', 'whatsapp'],
    currency: { en: 'LBP', ar: '' }, about: { en: '', ar: '' },
    defaultTheme: 'dark', defaultLang: 'en', featuredAutoplay: true, featuredAutoplayInterval: 4,
    sounds: { kitchen: 'classic', customer: 'classic' }, badges: { newDays: 1, topDays: 1, topCount: 1 },
    showMore: { initial: 12, batch: 8 },
    featureGroups: [], featureDefs: [],
    ordering: { enabled: true, types: ['delivery'], minOrder: 0, deliveryFee: 0, note: { en: '', ar: '' } },
    announcement: { enabled: false, text: { en: '', ar: '' }, startsAt: null, expiresAt: null },
    privacy: { extra: { en: '', ar: '' }, reviewed: false },
    notifications: { senderName: '', replyTo: '', events: { placed: true, confirmed: true, completed: true, cancelled: true, receipt_check: true } },
  },
  categories: [{ id: 'c', name: { en: 'C', ar: 'س' }, visible: true }],
  items: [{ id: 'i', categoryId: 'c', name: { en: 'I', ar: 'ص' }, description: { en: '', ar: '' }, pricing: { unit: 'pc', price: 100, minQty: 1, step: 1, maxQty: 50, showUnit: false }, badges: [], featured: false, available: true }],
});
{
  const bad = baseDoc();
  bad.settings.ordering.deliveryZones = { mode: 'selected', maxKm: 3, countries: [{ cc: 'LB', subdivisions: 'ALL' }] };
  const r = validateMenu(bad);
  ok(r.ok && r.value.settings.ordering.deliveryZones.maxKm === 3, 'valid zones persist');
}
{
  const bad = baseDoc();
  bad.settings.ordering.deliveryZones = { mode: 'whatever', maxKm: -5, countries: [{ cc: 'XX' }, { cc: 'lb', subdivisions: [] }] };
  const r = validateMenu(bad);
  ok(!r.ok && r.errors.some((e) => e.includes('maxKm')) && r.errors.some((e) => e.includes('XX')), 'bad zone config rejected loudly');
}

// ---- server order gate ----
const menuFor = (zones) => {
  const m = baseDoc();
  m.settings.mapUrl = 'https://www.google.com/maps/search/?api=1&query=33.8938,35.5018';
  m.settings.ordering.deliveryZones = zones;
  return m;
};
const bodyFor = (lat, lng, zone) => ({
  type: 'delivery',
  customer: { name: 'AB', phone: '+96170123456', address: 'Beirut st 1' },
  items: [{ id: 'i', qty: 1 }],
  location: { lat, lng },
  ...(zone ? { zone } : {}),
  notes: '', website: '',
});
{
  // Beirut pin, LB served → ok
  const r = validateOrderInput(bodyFor(33.89, 35.50, { cc: 'LB', subCode: 'LB-BA', subName: 'Beirut' }), menuFor({ mode: 'selected', maxKm: 100, countries: [{ cc: 'LB', subdivisions: 'ALL' }] }));
  ok(r.ok, 'served pin accepted', JSON.stringify(r.errors));
}
{
  // Beirut pin honestly resolved as LB, but only Cyprus is served → rejected
  const r = validateOrderInput(bodyFor(33.89, 35.50, { cc: 'LB', subCode: 'LB-BA', subName: 'Beirut' }), menuFor({ mode: 'selected', maxKm: 100, countries: [{ cc: 'CY', subdivisions: 'ALL' }] }));
  ok(!r.ok && r.errors.includes('out_of_zone'), 'unserved country rejected');
}
{
  // Cyprus pin claimed for Cyprus, but only Lebanon is served → rejected
  // (country allow-list, before any distance math).
  const r = validateOrderInput(bodyFor(35.17, 33.36, { cc: 'CY', subCode: null, subName: null }), menuFor({ mode: 'selected', maxKm: 2000, countries: [{ cc: 'LB', subdivisions: 'ALL' }] }));
  ok(!r.ok && r.errors.includes('out_of_zone'), 'served-list mismatch rejected even in radius');
}
{
  // Cairo pin, LB-only zones → rejected by radius even with honest claim
  const r = validateOrderInput(bodyFor(30.04, 31.23, { cc: 'EG', subCode: 'EG-C', subName: 'Cairo' }), menuFor({ mode: 'selected', maxKm: 100, countries: [{ cc: 'EG', subdivisions: 'ALL' }] }));
  ok(!r.ok && r.errors.includes('out_of_zone'), 'far pin rejected by maxKm backstop');
}
{
  // No claim at all + in-radius pin → accepted (distance only)
  const r = validateOrderInput(bodyFor(33.89, 35.50), menuFor({ mode: 'selected', maxKm: 100, countries: [{ cc: 'LB', subdivisions: 'ALL' }] }));
  ok(r.ok, 'missing claim falls back to distance check', JSON.stringify(r.errors));
}
{
  // mode all → no gate at all, even far away (legacy behavior preserved)
  const r = validateOrderInput(bodyFor(40.71, -74.0, { cc: 'US', subCode: null, subName: 'x' }), menuFor({ mode: 'all', maxKm: 100, countries: [] }));
  ok(r.ok, 'open mode never zone-blocks', JSON.stringify(r.errors));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
