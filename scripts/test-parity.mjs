/**
 * Pricing parity test: frontend (src/utils/pricing*.ts) vs backend
 * (functions/_shared/pricing*.js) must stay behavior-identical.
 *
 * Run: npx tsx scripts/test-parity.mjs  (or: npm run test:parity)
 * tsx is already a devDependency (see package.json) and resolves the
 * `@/` alias via tsconfig paths — no build step needed.
 *
 * Rule: edit src/utils/pricing*.ts FIRST (source of truth), mirror the
 * logic into functions/_shared/pricing*.js, then run this test.
 * Any MISMATCH fails the run (exit 1) — wire it into CI.
 *
 * Scope: money paths + qty grids + variant/add-on resolution + menu
 * normalization (money-relevant subset) + smart badges. Display-only
 * helpers (priceLabel/lineMathText, TS-only) and the server's intentional
 * settings-subset in normalizeMenu are documented in docs/PRICING.md and
 * NOT compared here. status.ts is already single-sourced (imports the
 * server implementation) so it needs no parity test.
 */
import * as FE from '../src/utils/pricing.ts';
import * as BE from '../functions/_shared/pricing.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`${name}${extra ? ` — ${extra}` : ''}`); console.error('MISMATCH', name, extra); }
}
// Order-independent deep compare (both sides build literals in the same
// order today, but key order must never be load-bearing).
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
}
const same = (a, b) => stable(a) === stable(b);
function throwsSame(feFn, beFn, name) {
  let feMsg = null, beMsg = null;
  try { feFn(); } catch (e) { feMsg = String((e && e.message) || e); }
  try { beFn(); } catch (e) { beMsg = String((e && e.message) || e); }
  ok(feMsg !== null && feMsg === beMsg, name, `FE threw ${feMsg}, BE threw ${beMsg}`);
}

// ---------- shared fixtures ----------
const plain = { id: 'p1', pricing: { unit: 'pc', price: 100, minQty: 1, step: 1, maxQty: 50, showUnit: false } };
const sized = {
  id: 's1',
  pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 10, showUnit: false },
  variants: [{ featureId: 'v-s', price: 80 }, { featureId: 'v-l', price: 120 }],
  defaultVariant: 'v-l',
};
const withAddons = {
  id: 'a1',
  pricing: { unit: 'pc', price: 50, minQty: 1, step: 1, maxQty: 20, showUnit: false },
  addons: [{ featureId: 'x-cheese', price: 10 }, { featureId: 'x-free', price: 0 }],
};
const menuBase = {
  version: 1, schemaVersion: 2, updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    featureGroups: [
      { id: 'sizes', name: { en: 'Sizes', ar: 'أحجام' } },
      { id: 'addons', name: { en: 'Add-ons', ar: 'إضافات' } },
    ],
    featureDefs: [
      { id: 'v-s', groupId: 'sizes', name: { en: 'Small', ar: 'صغير' } },
      { id: 'v-l', groupId: 'sizes', name: { en: 'Large', ar: 'كبير' } },
      { id: 'x-cheese', groupId: 'addons', name: { en: 'Cheese', ar: 'جبن' } },
    ],
    ordering: { minOrder: 0, deliveryFee: 0 },
    badges: { newDays: 14, topDays: 30, topCount: 6 },
  },
  categories: [],
  items: [plain, sized, withAddons],
};

// ---------- 1. round2 ----------
for (const [input, label] of [[0.1 + 0.2, '0.1+0.2 dust'], [10.005, 'half-up-ish'], [80, 'int'], [-3.456, 'neg'], [0, 'zero']]) {
  ok(FE.round2(input) === BE.round2(input), `round2 ${label}`, `FE=${FE.round2(input)} BE=${BE.round2(input)}`);
}

// ---------- 2. normalizePricing ----------
const pricingCases = {
  'empty item': {},
  'legacy numeric price': { price: 99.999 },
  'legacy negative clamps to 0': { price: -5 },
  'custom short unit kept': { pricing: { unit: 'plate', price: 10, minQty: 1, step: 1, maxQty: 5, showUnit: true } },
  'long unit falls back': { pricing: { unit: 'x'.repeat(25), price: 10, minQty: 1, step: 1, maxQty: 5, showUnit: false } },
  'control-char unit falls back': { pricing: { unit: 'a\nb', price: 10, minQty: 1, step: 1, maxQty: 5, showUnit: false } },
  'bad grid defaults': { pricing: { unit: 'kg', price: 7, minQty: 0, step: 0, maxQty: -2, showUnit: false } },
  'max below min snaps': { pricing: { unit: 'pc', price: 7, minQty: 5, step: 2, maxQty: 3, showUnit: false } },
  'known dozen unit': { pricing: { unit: 'dozen', price: 30, minQty: 1, step: 1, maxQty: 10, showUnit: true } },
};
for (const [name, item] of Object.entries(pricingCases)) {
  ok(same(FE.normalizePricing(item), BE.normalizePricing(item)), `normalizePricing: ${name}`,
    `FE=${stable(FE.normalizePricing(item))} BE=${stable(BE.normalizePricing(item))}`);
}

// ---------- 3. getVariant / hasVariants ----------
ok(same(FE.getVariant(sized), BE.getVariant(sized)), 'getVariant explicit default (v-l)');
ok(same(FE.getVariant(sized, 'v-s'), BE.getVariant(sized, 'v-s')), 'getVariant explicit pick');
ok(same(FE.getVariant(sized, 'nope'), BE.getVariant(sized, 'nope')), 'getVariant unknown → null');
ok(same(FE.getVariant(plain), BE.getVariant(plain)), 'getVariant no-variants → null');
ok(FE.hasVariants(sized) === BE.hasVariants(sized) && FE.hasVariants(plain) === BE.hasVariants(plain), 'hasVariants');

// ---------- 4. unitPrice / lineTotal / perUnitPrice / minVariantPrice ----------
const moneyCalls = [
  ['unitPrice plain', (m) => m.unitPrice(plain)],
  ['unitPrice default variant', (m) => m.unitPrice(sized)],
  ['unitPrice explicit variant', (m) => m.unitPrice(sized, 'v-s')],
  ['minVariantPrice', (m) => m.minVariantPrice(sized)],
  ['lineTotal plain x3', (m) => m.lineTotal(plain, { qty: 3 })],
  ['lineTotal variant+paid addon x2', (m) => m.lineTotal({ ...sized, addons: withAddons.addons }, { variantId: 'v-s', addonIds: ['x-cheese'], qty: 2 })],
  ['lineTotal free addon', (m) => m.lineTotal(withAddons, { addonIds: ['x-free'], qty: 4 })],
  ['perUnitPrice with addons', (m) => m.perUnitPrice(withAddons, { addonIds: ['x-cheese', 'x-free'] })],
  ['zero variant price accepted (both)', (m) => m.unitPrice({ ...sized, variants: [{ featureId: 'v1', price: 0 }] }, 'v1')],
];
for (const [name, call] of moneyCalls) {
  ok(call(FE) === call(BE), name, `FE=${call(FE)} BE=${call(BE)}`);
}
throwsSame(() => FE.unitPrice(sized, 'nope'), () => BE.unitPrice(sized, 'nope'), 'unitPrice unknown variant throws');
throwsSame(() => FE.unitPrice({ id: 'x', pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 5, showUnit: false } }), () => BE.unitPrice({ id: 'x', pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 5, showUnit: false } }), 'unitPrice no price throws');
throwsSame(() => FE.lineTotal(withAddons, { addonIds: ['ghost'], qty: 1 }), () => BE.lineTotal(withAddons, { addonIds: ['ghost'], qty: 1 }), 'lineTotal unknown addon throws');
throwsSame(() => FE.lineTotal(withAddons, { addonIds: ['x-cheese', 'x-cheese'], qty: 1 }), () => BE.lineTotal(withAddons, { addonIds: ['x-cheese', 'x-cheese'], qty: 1 }), 'lineTotal dup addon throws');
throwsSame(() => FE.lineTotal(plain, { qty: 1.5 }), () => BE.lineTotal(plain, { qty: 1.5 }), 'lineTotal non-int qty throws');

// ---------- 5. qty grids ----------
const gridItem = { id: 'g', pricing: { unit: 'pc', price: 10, minQty: 2, step: 3, maxQty: 20, showUnit: false } };
for (const q of [1, 2, 3, 5, 8, 20, 21, 0, -4]) {
  ok(FE.isValidQty(gridItem, q) === BE.isValidQty(gridItem, q), `isValidQty q=${q}`);
  ok(FE.clampQty(gridItem, q) === BE.clampQty(gridItem, q), `clampQty q=${q}`);
}

// ---------- 6. cartLineKey ----------
ok(FE.cartLineKey('i', 'v', ['b', 'a']) === BE.cartLineKey('i', 'v', ['b', 'a']), 'cartLineKey sorted');
ok(FE.cartLineKey('i', 'v', ['a', 'b']) === BE.cartLineKey('i', 'v', ['b', 'a']), 'cartLineKey order-independent');
ok(FE.cartLineKey('i') === BE.cartLineKey('i'), 'cartLineKey bare');

// ---------- 7. formatPrice / unitLabel ----------
for (const [n, c] of [[80000, 'LBP'], [10.5, 'LBP'], [10.555, { code: 'USD', decimals: 2 }], [0, '']]) {
  ok(FE.formatPrice(n, c) === BE.formatPrice(n, c), `formatPrice ${JSON.stringify(n)}`);
}
for (const [u, q, l] of [['pc', 1, 'en'], ['pc', 2, 'ar'], ['dozen', 5, 'ar'], ['kg', 3, 'en'], ['mystery', 2, 'en']]) {
  ok(FE.unitLabel(u, q, l) === BE.unitLabel(u, q, l), `unitLabel ${u}/${q}/${l}`);
}

// ---------- 8. feature library ----------
ok(same(FE.featureDef(menuBase, 'v-s'), BE.featureDef(menuBase, 'v-s')), 'featureDef hit');
ok(same(FE.featureDef(menuBase, 'ghost'), BE.featureDef(menuBase, 'ghost')), 'featureDef miss → null');
ok(FE.featureName(menuBase, 'v-s', 'ar') === BE.featureName(menuBase, 'v-s', 'ar'), 'featureName ar');
ok(FE.featureName(menuBase, 'ghost', 'en') === BE.featureName(menuBase, 'ghost', 'en'), 'featureName fallback id');
ok(same(FE.featuresByGroup(menuBase), BE.featuresByGroup(menuBase)), 'featuresByGroup');
ok(same(FE.itemAddons(withAddons), BE.itemAddons(withAddons)), 'itemAddons');
ok(FE.hasOptions(withAddons) === BE.hasOptions(withAddons) && FE.hasOptions(plain) === BE.hasOptions(plain), 'hasOptions');

// ---------- 9. normalizeMenu (money-relevant subset) ----------
const legacyMenu = {
  version: 1, updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    featureGroups: [{ id: 'sizes', name: { en: 'Sizes', ar: 'أحجام' } }],
    featureDefs: [],
    ordering: { minOrder: 50000, deliveryFee: 15000 },
    badges: { newDays: 7, topDays: 10, topCount: 2 },
  },
  categories: [{ id: 'c1', name: { en: 'Cat', ar: 'صنف' }, visible: true }],
  items: [
    { id: 'leg', categoryId: 'c1', price: 42.5, badges: [], featured: false, available: true },
    { id: 'oldvar', categoryId: 'c1', pricing: { unit: 'pc', price: 100, minQty: 1, step: 1, maxQty: 5, showUnit: false }, variants: [{ id: 'ov1', name: { en: 'Big', ar: 'كبير' }, price: 150 }], defaultVariant: 'ov1', badges: [], featured: false, available: true },
    { id: 'badv', categoryId: 'c1', pricing: { unit: 'pc', price: 10, minQty: 1, step: 1, maxQty: 5, showUnit: false }, variants: [{ featureId: 'zz', price: 20 }], defaultVariant: 'gone', badges: [], featured: false, available: true },
  ],
  addonGroups: [{ id: 'g-cheese', name: { en: 'Cheese', ar: 'جبن' }, categoryIds: ['c1'], price: 5 }],
};
const feN = FE.normalizeMenu(legacyMenu);
const beN = BE.normalizeMenu(legacyMenu);
ok(same(feN.items, beN.items), 'normalizeMenu items (legacy price, old variants, addonGroups, default pruning)',
  `\nFE=${stable(feN.items)}\nBE=${stable(beN.items)}`);
ok(same(feN.settings.featureDefs, beN.settings.featureDefs), 'normalizeMenu featureDefs');
ok(same(feN.settings.featureGroups, beN.settings.featureGroups), 'normalizeMenu featureGroups');
ok(feN.settings.ordering.minOrderEnabled === beN.settings.ordering.minOrderEnabled
  && feN.settings.ordering.deliveryFeeEnabled === beN.settings.ordering.deliveryFeeEnabled
  && feN.settings.ordering.minOrder === beN.settings.ordering.minOrder
  && feN.settings.ordering.deliveryFee === beN.settings.ordering.deliveryFee, 'normalizeMenu ordering derivation');
ok(same(feN.settings.badges, beN.settings.badges), 'normalizeMenu badges');
ok(feN.schemaVersion === beN.schemaVersion && !('addonGroups' in feN) && !('addonGroups' in beN), 'normalizeMenu version + addonGroups dropped');
ok(same(FE.normalizeMenu(null), BE.normalizeMenu(null)) && same(FE.normalizeMenu([1]), BE.normalizeMenu([1])), 'normalizeMenu garbage passthrough');

// ---------- 10. smart badges ----------
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const newItem = { ...plain, addedAt: new Date(NOW - 3 * 86400000).toISOString() };
const oldItem = { ...plain, addedAt: new Date(NOW - 30 * 86400000).toISOString() };
ok(FE.isNewItem(menuBase, newItem, NOW) === BE.isNewItem(menuBase, newItem, NOW), 'isNewItem in-window');
ok(FE.isNewItem(menuBase, oldItem, NOW) === BE.isNewItem(menuBase, oldItem, NOW), 'isNewItem expired');
ok(FE.isNewItem(menuBase, plain, NOW) === BE.isNewItem(menuBase, plain, NOW), 'isNewItem missing addedAt');
ok(same(FE.effectiveBadges(menuBase, { ...newItem, badges: ['top', 'new'] }, NOW), BE.effectiveBadges(menuBase, { ...newItem, badges: ['top', 'new'] }, NOW)), 'effectiveBadges dedupe');
const orders = [
  { createdAt: new Date(NOW - 86400000).toISOString(), status: 'completed', items: [{ id: 'p1', qty: 5 }, { id: 's1', qty: 2 }] },
  { createdAt: new Date(NOW - 2 * 86400000).toISOString(), status: 'cancelled', items: [{ id: 'p1', qty: 99 }] },
  { createdAt: new Date(NOW - 60 * 86400000).toISOString(), status: 'completed', items: [{ id: 's1', qty: 99 }] },
  { createdAt: new Date(NOW - 86400000).toISOString(), status: 'completed', items: [{ id: 's1', qty: 5 }] },
];
ok(same(FE.topSellers(orders, menuBase, { nowMs: NOW }), BE.topSellers(orders, menuBase, { nowMs: NOW })), 'topSellers rank/exclude/window');

// ---------- 11. split quantities (addonQty) ----------
const splitItem = {
  id: 'd1',
  pricing: { unit: 'pc', price: 50, minQty: 1, step: 1, maxQty: 20, showUnit: false },
  addons: [{ featureId: 'x-cheese', price: 10 }, { featureId: 'x-free', price: 0 }],
};
const splitMenu = {
  version: 1, schemaVersion: 2, updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    featureGroups: [
      { id: 'sizes', name: { en: 'Sizes', ar: 'أحجام' }, selection: 'multi' },
      { id: 'addons', name: { en: 'Add-ons', ar: 'إضافات' }, selection: 'multi' },
      { id: 'choice', name: { en: 'Choice', ar: 'الاختيار' }, selection: 'single', prompt: { en: 'Pick', ar: 'اختر' } },
    ],
    featureDefs: [
      { id: 'x-cheese', groupId: 'addons', name: { en: 'Cheese', ar: 'جبن' } },
      { id: 'x-free', groupId: 'choice', name: { en: 'Free', ar: 'مجاني' } },
    ],
    ordering: { minOrder: 0, deliveryFee: 0 },
    badges: { newDays: 14, topDays: 30, topCount: 6 },
  },
  categories: [],
  items: [splitItem],
};
const splitCalls = [
  ['addonSum legacy (no counts)', (m) => m.addonSum(splitItem, ['x-cheese'])],
  ['addonSum split 2/4', (m) => m.addonSum(splitItem, ['x-cheese'], { 'x-cheese': 2 }, 4)],
  ['lineTotal split 2/4', (m) => m.lineTotal(splitItem, { addonIds: ['x-cheese'], addonQty: { 'x-cheese': 2 }, qty: 4 })],
  ['perUnitPrice split avg', (m) => m.perUnitPrice(splitItem, { addonIds: ['x-cheese'], addonQty: { 'x-cheese': 2 }, qty: 4 })],
  ['cartLineKey split', (m) => m.cartLineKey('i', 'v', ['x-cheese', 'x-free'], { 'x-cheese': 2, 'x-free': 0 }, 4)],
  ['cartLineKey legacy byte-identical', (m) => m.cartLineKey('i', 'v', ['x-free', 'x-cheese'])],
  ['validatePicks pass returns undefined', (m) => String(m.validatePicks(splitMenu, splitItem, ['x-cheese'], { 'x-cheese': 4 }, 4))],
];
for (const [name, call] of splitCalls) {
  ok(call(FE) === call(BE), name, `FE=${call(FE)} BE=${call(BE)}`);
}
throwsSame(() => FE.validatePicks(splitMenu, splitItem, ['x-cheese'], { 'x-cheese': 2 }, 4), () => BE.validatePicks(splitMenu, splitItem, ['x-cheese'], { 'x-cheese': 2 }, 4), 'validatePicks multi partial throws both');
throwsSame(() => FE.lineTotal(splitItem, { addonIds: ['ghost'], addonQty: { ghost: 1 }, qty: 2 }), () => BE.lineTotal(splitItem, { addonIds: ['ghost'], addonQty: { ghost: 1 }, qty: 2 }), 'lineTotal split unknown addon throws both');
throwsSame(() => FE.perUnitPrice(splitItem, { addonIds: ['x-cheese'], addonQty: { 'x-cheese': 2 } }), () => BE.perUnitPrice(splitItem, { addonIds: ['x-cheese'], addonQty: { 'x-cheese': 2 } }), 'perUnitPrice split missing qty throws both');
{
  const feS = FE.normalizeMenu(splitMenu);
  const beS = BE.normalizeMenu(splitMenu);
  ok(same(feS.settings.featureGroups, beS.settings.featureGroups), 'normalizeMenu featureGroups (selection+prompt)',
    `\nFE=${stable(feS.settings.featureGroups)}\nBE=${stable(beS.settings.featureGroups)}`);
  const ch = feS.settings.featureGroups.find((g) => g.id === 'choice');
  ok(ch && ch.selection === 'single' && ch.prompt && ch.prompt.en === 'Pick', 'normalizeMenu preserves selection+prompt');
}

// ---------- summary ----------
console.log(`\nparity: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('PARITY DRIFT DETECTED — fix the mirror side to match src/utils (source of truth). See docs/PRICING.md');
  process.exit(1);
}
console.log('Parity OK — FE and BE agree on all fixtures');
