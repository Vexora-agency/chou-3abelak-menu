/**
 * Pricing engine tests (no dependencies).
 * Run: node scripts/test-pricing.mjs
 * Covers: variant price, per-item add-ons (paid + free), qty grids,
 * dozen, maxQty, step/min rules, unknown variant + invalid add-on
 * rejection, feature library, legacy migration, smart badges,
 * plus the real-menu scenario totals from the task brief.
 */
import {
  unitPrice, lineTotal, isValidQty, formatPrice, unitLabel, round2,
  normalizeMenu, normalizePricing, minVariantPrice, cartLineKey,
  effectiveBadges, isNewItem, topSellers,
  featureDef, featureName, itemAddons, hasOptions,
  perUnitPrice, featuresByGroup,
  addonSum, validatePicks,
} from '../functions/_shared/pricing.js';

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra); }
};
const throwsCode = (fn, code, name) => {
  try { fn(); ok(false, name, 'did not throw'); }
  catch (e) { ok(String((e && e.message) || e) === code, name, 'threw ' + String((e && e.message) || e)); }
};

const menu = {
  settings: {
    featureGroups: [
      { id: 'sizes', name: { en: 'Sizes', ar: 'أحجام' } },
      { id: 'addons', name: { en: 'Add-ons', ar: 'إضافات' } },
    ],
    featureDefs: [
      { id: 'regular', groupId: 'sizes', name: { en: 'Regular', ar: 'عادي' } },
      { id: 'mashrouha', groupId: 'sizes', name: { en: 'Mashrouha', ar: 'مشروحة' } },
      { id: 'extra-veg', groupId: 'addons', name: { en: 'Extra vegetables', ar: 'خضرة' } },
    ],
  },
  items: [],
};
const manousheh = {
  id: 'm1', categoryId: 'manakish',
  pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
  variants: [
    { featureId: 'regular', price: 80000 },
    { featureId: 'mashrouha', price: 120000 },
  ],
  addons: [{ featureId: 'extra-veg', price: 30000 }],
};
const pastry = {
  id: 'p1', categoryId: 'pastries',
  pricing: { unit: 'dozen', price: 600000, minQty: 1, step: 1, maxQty: 20, showUnit: true },
};
const step2 = {
  id: 's1', categoryId: 'manakish',
  pricing: { unit: 'pc', price: 50000, minQty: 1, step: 2, maxQty: 10, showUnit: false },
};
const min2 = {
  id: 's2', categoryId: 'manakish',
  pricing: { unit: 'pc', price: 50000, minQty: 2, step: 1, maxQty: 10, showUnit: false },
};

// variant price (explicit + default first)
ok(unitPrice(manousheh, 'mashrouha') === 120000, 'variant price mashrouha');
ok(unitPrice(manousheh, 'regular') === 80000, 'variant price regular');
ok(unitPrice(manousheh) === 80000, 'default variant is the first');
ok(unitPrice({ ...manousheh, defaultVariant: 'mashrouha' }) === 120000, 'explicit default wins without reorder');
ok(unitPrice({ ...manousheh, defaultVariant: 'ghost' }) === 80000, 'invalid default falls back to first');
// star round-trip: star stays in place, order untouched, default respected
{
  const starred = normalizeMenu({ items: [{ ...manousheh, id: 'm9', defaultVariant: 'mashrouha' }], settings: { ordering: {} } });
  const it = starred.items[0];
  ok(it.variants[0].featureId === 'regular' && it.variants[1].featureId === 'mashrouha', 'star does not reorder');
  ok(it.defaultVariant === 'mashrouha', 'default survives normalize');
  ok(unitPrice(it) === 120000, 'priced by the starred default');
}
ok(unitPrice(pastry) === 600000, 'plain pricing.price');
throwsCode(() => unitPrice(manousheh, 'nope'), 'unknown_variant', 'unknown variant rejected');
throwsCode(() => unitPrice({ ...manousheh, variants: [] }), 'no_price', 'missing price throws');

// feature library (pure names-in-folders; kind decided per item row)
ok(featureDef(menu, 'mashrouha').groupId === 'sizes', 'feature lookup');
ok(featureDef(menu, 'ghost') === null, 'missing feature -> null');
ok(featureName(menu, 'mashrouha', 'ar') === 'مشروحة', 'feature name AR');
ok(featureName(menu, 'ghost', 'en') === 'ghost', 'feature name falls back to id');
ok(itemAddons(manousheh).length === 1 && itemAddons(pastry).length === 0, 'per-item addons');
ok(hasOptions(manousheh) === true && hasOptions(pastry) === false, 'hasOptions per item');

// add-on per unit + qty 1/3/7 (price lives on the ITEM, name in the library)
ok(lineTotal(manousheh, { variantId: 'mashrouha', addonIds: ['extra-veg'], qty: 1 }) === 150000, 'addon per unit x1');
ok(lineTotal(manousheh, { variantId: 'mashrouha', addonIds: ['extra-veg'], qty: 3 }) === 450000, 'addon per unit x3');
ok(lineTotal(manousheh, { variantId: 'mashrouha', addonIds: ['extra-veg'], qty: 7 }) === 1050000, 'addon per unit x7');
ok(lineTotal(manousheh, { variantId: 'regular', qty: 2 }) === 160000, 'no addons x2');
ok(perUnitPrice(manousheh, { variantId: 'mashrouha', addonIds: ['extra-veg'] }) === 150000, 'per-unit with addon');

// dozen
ok(lineTotal(pastry, { qty: 3 }) === 1800000, '3 dozen x 600,000 = 1,800,000');

// invalid add-on: not enabled on the item / unknown / duplicate
throwsCode(() => lineTotal(pastry, { addonIds: ['extra-veg'], qty: 1 }), 'invalid_addon', 'unenabled addon rejected');
throwsCode(() => lineTotal(manousheh, { addonIds: ['ghost'], qty: 1 }), 'invalid_addon', 'unknown addon rejected');
throwsCode(() => lineTotal(manousheh, { addonIds: ['extra-veg', 'extra-veg'], qty: 1 }), 'invalid_addon', 'duplicate addon rejected');

// qty rules
ok(isValidQty(pastry, 20) === true, 'maxQty boundary valid');
ok(isValidQty(pastry, 21) === false, 'over maxQty rejected');
ok(isValidQty(pastry, 0) === false, 'zero rejected');
ok(isValidQty(step2, 1) && isValidQty(step2, 3) && isValidQty(step2, 9), 'step 2 grid valid');
ok(isValidQty(step2, 2) === false && isValidQty(step2, 4) === false, 'step 2 off-grid rejected');
ok(isValidQty(min2, 1) === false && isValidQty(min2, 2) === true, 'minQty 2 enforced');
ok(isValidQty(pastry, 1.5) === false && isValidQty(pastry, '3') === false, 'non-integers rejected');

// formatPrice
ok(formatPrice(80000, 'LBP') === '80,000 LBP', 'thousands separators');
ok(formatPrice(1200000, 'ل.ل') === '1,200,000 ل.ل', 'arabic currency code');
ok(formatPrice(480, undefined) === '480', 'no currency');
ok(formatPrice(1234.5, { code: 'USD', decimals: 2 }) === '1,234.50 USD', 'decimals honored');
ok(formatPrice(10.5, 'LBP') === '10.5 LBP', 'decimals shown only when needed');
ok(formatPrice(10.50, undefined) === '10.5', 'trailing zero trimmed');
ok(formatPrice(80000, 'LBP') === '80,000 LBP', 'integers unchanged');
ok(formatPrice(1234567.89, 'LBP') === '1,234,567.89 LBP', 'big decimals grouped');

// decimal money math (float-dust proof)
const decItem = { id: 'd1', categoryId: 'c', pricing: { unit: 'pc', price: 10.1, minQty: 1, step: 1, maxQty: 50, showUnit: false } };
ok(lineTotal(decItem, { qty: 3 }) === 30.3, '10.1 x 3 = 30.3 exactly');
const decItem2 = { id: 'd2', categoryId: 'c', pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false }, variants: [{ featureId: 'v1', price: 333.33 }] };
ok(lineTotal(decItem2, { variantId: 'v1', qty: 3 }) === 999.99, '333.33 x 3 = 999.99');
ok(unitPrice({ ...decItem2, variants: [{ featureId: 'v1', price: 0 }] }, 'v1') === 0, 'zero variant price accepted as free (see docs/PRICING.md gap 3)');
ok(round2(0.1 + 0.2) === 0.3, 'round2 kills float dust');

// unitLabel
ok(unitLabel('pc', 1, 'en') === 'pc' && unitLabel('pc', 3, 'en') === 'pcs', 'EN pc/pcs');
ok(unitLabel('dozen', 1, 'en') === 'dozen' && unitLabel('dozen', 2, 'en') === 'dozens', 'EN dozen');
ok(unitLabel('dozen', 3, 'en') === 'dozens' && unitLabel('glass', 2, 'en') === 'glasses', 'EN plurals');
ok(unitLabel('kg', 5, 'en') === 'kg', 'kg invariable');
ok(unitLabel('pc', 1, 'ar') === 'قطعة' && unitLabel('pc', 2, 'ar') === 'قطعتين' && unitLabel('pc', 5, 'ar') === 'قطع' && unitLabel('pc', 11, 'ar') === 'قطعة', 'AR pc forms');
ok(unitLabel('dozen', 1, 'ar') === 'دستة' && unitLabel('dozen', 2, 'ar') === 'دستتين' && unitLabel('dozen', 4, 'ar') === 'دستات' && unitLabel('dozen', 12, 'ar') === 'دستة', 'AR dozen forms');
ok(unitLabel('portion', 2, 'ar') === 'حصتين' && unitLabel('portion', 5, 'ar') === 'حصص' && unitLabel('box', 2, 'ar') === 'علبتين' && unitLabel('box', 4, 'ar') === 'علب', 'AR portion/box forms');
ok(unitLabel('bottle', 2, 'ar') === 'زجاجتين' && unitLabel('glass', 2, 'ar') === 'كأسين' && unitLabel('glass', 5, 'ar') === 'كؤوس' && unitLabel('kg', 3, 'ar') === 'كغ', 'AR bottle/glass/kg forms');

// legacy normalization: old numeric price -> portion pricing
const legacy = normalizeMenu({ items: [{ id: 'x', categoryId: 'c', price: 250 }], settings: { ordering: {} } });
ok(legacy.items[0].pricing.unit === 'portion' && legacy.items[0].pricing.price === 250, 'legacy price -> portion pricing');
ok(legacy.items[0].price === undefined, 'legacy price field removed');
ok(legacy.schemaVersion === 2, 'schemaVersion stamped');
ok(Array.isArray(legacy.settings.featureDefs) && legacy.settings.featureDefs.length === 0, 'featureDefs default []');

// legacy migration: inline variant names + category groups -> library + per-item
const oldDoc = normalizeMenu({
  items: [
    { id: 'm1', categoryId: 'manakish', pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
      variants: [{ id: 'regular', name: { en: 'Regular', ar: 'عادي' }, price: 80000 }] },
    { id: 'p1', categoryId: 'pastries', pricing: { unit: 'dozen', price: 600000, minQty: 1, step: 1, maxQty: 20, showUnit: true } },
  ],
  addonGroups: [{ id: 'extra-veg', name: { en: 'Extra vegetables', ar: 'خضرة' }, price: 30000, perUnit: true, categoryIds: ['manakish'] }],
  settings: { ordering: {} },
});
ok(oldDoc.settings.featureDefs.length === 2, 'library built from legacy names');
ok(oldDoc.items[0].variants[0].featureId === 'regular' && oldDoc.items[0].variants[0].name === undefined, 'variants converted');
ok(oldDoc.items[0].addons.length === 1 && oldDoc.items[0].addons[0].price === 30000, 'groups expanded to manakish item');
ok(!oldDoc.items[1].addons || oldDoc.items[1].addons.length === 0, 'pastry untouched by manakish group');
ok(oldDoc.addonGroups === undefined, 'addonGroups removed');
ok(lineTotal(oldDoc.items[0], { variantId: 'regular', addonIds: ['extra-veg'], qty: 2 }) === 220000, 'migrated math correct');

// feature groups: defaults created on migration, grouped view
const gids = (oldDoc.settings.featureGroups || []).map((g) => g.id).sort();
ok(JSON.stringify(gids) === JSON.stringify(['addons', 'sizes']), 'default groups created');
const grouped = featuresByGroup(oldDoc);
ok(grouped.length === 2 && grouped[0].features.length === 1 && grouped[1].features.length === 1, 'featuresByGroup buckets');
const custom = normalizeMenu({ items: [], settings: { ordering: {}, featureGroups: [{ id: 'cheese', name: { en: 'Cheese', ar: 'جبن' } }], featureDefs: [{ id: 'x', groupId: 'cheese', name: { en: 'X', ar: '' } }] } });
ok(custom.settings.featureGroups.length === 1 && custom.settings.featureDefs[0].groupId === 'cheese', 'custom section without kind kept');
ok(featuresByGroup(custom)[0].group.name.en === 'Cheese', 'group view keeps names');

// ordering flags default from values
const ord = normalizeMenu({ items: [], settings: { ordering: { minOrder: 350000, deliveryFee: 100000 } } }).settings.ordering;
ok(ord.minOrderEnabled === true && ord.deliveryFeeEnabled === true, 'missing flags default from values');
const ord2 = normalizeMenu({ items: [], settings: { ordering: { minOrder: 0, deliveryFee: 0 } } }).settings.ordering;
ok(ord2.minOrderEnabled === false && ord2.deliveryFeeEnabled === false, 'zero values stay disabled');
const ord3 = normalizeMenu({ items: [], settings: { ordering: { minOrder: 999, minOrderEnabled: false } } }).settings.ordering;
ok(ord3.minOrderEnabled === false, 'explicit flags preserved');

// helpers
ok(minVariantPrice(manousheh) === 80000, 'min variant price');
ok(cartLineKey('a', 'v', ['z', 'y']) === cartLineKey('a', 'v', ['y', 'z']), 'line key sorts addons');
ok(cartLineKey('a') !== cartLineKey('a', 'v'), 'line key differs by variant');
ok(normalizePricing({ pricing: { unit: 'dozen', price: 5, minQty: 0, step: 0, maxQty: 1 } }).minQty === 1, 'bad minQty/step repaired');

// smart badges (fixed clock: 2026-10-24T12:00:00Z)
const NOW = Date.parse('2026-10-24T12:00:00Z');
const D = 86400000;
const bMenu = normalizeMenu({ items: [], settings: { ordering: {}, badges: { newDays: 14, topDays: 30, topCount: 6 } } });
const iso = (ms) => new Date(ms).toISOString();
ok(isNewItem(bMenu, { addedAt: iso(NOW - 5 * D) }, NOW) === true, 'new within window');
ok(isNewItem(bMenu, { addedAt: iso(NOW - 20 * D) }, NOW) === false, 'new expired after 14d');
ok(isNewItem(bMenu, { addedAt: iso(NOW + D) }, NOW) === false, 'future addedAt not new');
ok(isNewItem(bMenu, {}, NOW) === false, 'missing addedAt not new');
ok(isNewItem(bMenu, { addedAt: 'garbage' }, NOW) === false, 'bad addedAt not new');
const effNew = effectiveBadges(bMenu, { badges: ['spicy'], addedAt: iso(NOW - 2 * D) }, NOW);
ok(effNew.includes('new') && effNew.includes('spicy') && effNew.length === 2, 'effective = stored ∪ auto-new');
const effOld = effectiveBadges(bMenu, { badges: ['top'], addedAt: iso(NOW - 30 * D) }, NOW);
ok(effOld.length === 1 && effOld[0] === 'top', 'expired new drops, stored stays');
ok(JSON.stringify(bMenu.settings.badges) === JSON.stringify({ newDays: 14, topDays: 30, topCount: 6 }), 'badge settings kept');
const bMenu2 = normalizeMenu({ items: [], settings: { ordering: {} } });
ok(JSON.stringify(bMenu2.settings.badges) === JSON.stringify({ newDays: 14, topDays: 30, topCount: 6 }), 'badge defaults stamped');

// top sellers from real orders
const mkOrder = (id, daysAgo, status, qty) => ({ id, createdAt: iso(NOW - daysAgo * D), status, items: [{ id, qty }] });
const rankOrders = [
  mkOrder('a', 2, 'completed', 10),
  mkOrder('b', 2, 'completed', 25),
  mkOrder('c', 2, 'cancelled', 999),
  mkOrder('d', 60, 'completed', 500),
  mkOrder('e', 1, 'new', 25),
];
const top = topSellers(rankOrders, bMenu, { nowMs: NOW });
ok(top.length === 3 && top[0].id === 'b' && top[1].id === 'e' && top[2].id === 'a', 'ranked desc, cancelled+old excluded, tie by id');
ok(topSellers(rankOrders, bMenu, { nowMs: NOW, count: 2 }).length === 2, 'count cap respected');
ok(topSellers([], bMenu, { nowMs: NOW }).length === 0, 'no orders -> empty');

// free add-on (price 0) adds nothing but is accepted
const freeItem = { ...manousheh, addons: [{ featureId: 'extra-veg', price: 0 }] };
ok(lineTotal(freeItem, { variantId: 'regular', addonIds: ['extra-veg'], qty: 2 }) === 160000, 'free addon accepted, total unchanged');

// real-menu scenario totals (zaatar&labneh mashrouha 300k + veg 30k) x2 = 660,000
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = join(ROOT, 'public', 'menu.seed.json');
if (existsSync(seedPath)) {
  const seed = normalizeMenu(JSON.parse(readFileSync(seedPath, 'utf8')));
  const zl = seed.items.find((i) => i.id === 'manakish-zaatar-labneh');
  const soup = seed.items.find((i) => i.id === 'pastry-pizza');
  const pepsi = seed.items.find((i) => i.id === 'drink-pepsi');
  const pizza = seed.items.find((i) => i.id === 'pizza-veggie');
  ok(lineTotal(zl, { variantId: 'mashrouha', addonIds: ['extra-veg'], qty: 2 }) === 660000, 'seed: mashrouha + veg x2 = 660,000');
  ok(lineTotal(pizza, { variantId: 'large', qty: 1 }) === 700000, 'seed: pizza large = 700,000');
  ok(lineTotal(soup, { qty: 3 }) === 1800000, 'seed: 3 dozen pastry = 1,800,000');
  ok(lineTotal(pepsi, { variantId: 'diet', qty: 1 }) === 100000, 'seed: pepsi diet = 100,000');
  ok(seed.version === 2 && seed.schemaVersion === 2, 'seed keeps version, has schemaVersion');
} else {
  console.log('SKIP seed scenarios (public/menu.seed.json not installed yet)');
}

// ---- split quantities (addonQty): 2+2 pepsi math + group rules + keys ----
const splitMenu = {
  settings: {
    featureGroups: [
      { id: 'sizes', name: { en: 'Sizes', ar: 'أحجام' }, selection: 'multi' },
      { id: 'addons', name: { en: 'Add-ons', ar: 'إضافات' }, selection: 'multi' },
      { id: 'choice', name: { en: 'Choice', ar: 'الاختيار' }, selection: 'single' },
    ],
    featureDefs: [
      { id: 'extra-veg', groupId: 'addons', name: { en: 'Extra veg', ar: 'خضرة' } },
      { id: 'pepsi-a', groupId: 'choice', name: { en: 'Pepsi A', ar: 'بيبسي أ' } },
      { id: 'pepsi-b', groupId: 'choice', name: { en: 'Pepsi B', ar: 'بيبسي ب' } },
      { id: 'size-opt', groupId: 'sizes', name: { en: 'Size opt', ar: 'خيار حجم' } },
      { id: 'orphan-opt', groupId: 'missing-bucket', name: { en: 'Orphan', ar: 'يتيم' } },
    ],
  },
  items: [],
};
const drink = {
  id: 'drink', categoryId: 'drinks',
  pricing: { unit: 'pc', price: 50000, minQty: 1, step: 1, maxQty: 50, showUnit: false },
  addons: [
    { featureId: 'pepsi-a', price: 10000 },
    { featureId: 'pepsi-b', price: 10000 },
    { featureId: 'extra-veg', price: 30000 },
    { featureId: 'size-opt', price: 5000 },
    { featureId: 'orphan-opt', price: 7000 },
  ],
};
// 2+2 pepsi math (single group, sum 4 <= qty 4): 4*50k + 2*10k + 2*10k = 240,000
ok(lineTotal(drink, { addonIds: ['pepsi-a', 'pepsi-b'], addonQty: { 'pepsi-a': 2, 'pepsi-b': 2 }, qty: 4 }) === 240000, 'split 2+2 single-group total');
ok(addonSum(drink, ['pepsi-a', 'pepsi-b'], { 'pepsi-a': 2, 'pepsi-b': 2 }, 4) === 40000, 'split addonSum is qty-scaled total');
ok(perUnitPrice(drink, { addonIds: ['pepsi-a', 'pepsi-b'], addonQty: { 'pepsi-a': 2, 'pepsi-b': 2 }, qty: 4 }) === 60000, 'split per-unit average');
// legacy without counts is untouched (same ids, qty 4): 4*(50k+10k+10k) = 280,000
ok(lineTotal(drink, { addonIds: ['pepsi-a', 'pepsi-b'], qty: 4 }) === 280000, 'legacy without counts unchanged');
// full counts equal legacy money but keys differ textually (specified format)
ok(lineTotal(drink, { addonIds: ['pepsi-a', 'pepsi-b'], addonQty: { 'pepsi-a': 4, 'pepsi-b': 4 }, qty: 4 }) === 280000, 'full counts match legacy money');
ok(cartLineKey('a', 'v', ['y', 'z']) === 'a|v|y,z', 'legacy key byte-identical (no counts)');
ok(cartLineKey('a', 'v', ['z', 'y'], { z: 2, y: 2 }, 4) === 'a|v|y:2,z:2', 'split key sorted fid:count');
ok(cartLineKey('a', 'v', ['y', 'z'], { y: 4, z: 4 }, 4) === 'a|v|y:4,z:4', 'full-count key differs textually from legacy (specified)');
ok(cartLineKey('a', 'v', ['y', 'z'], { y: 0, z: 2 }, 4) === 'a|v|z:2', 'split key drops zero counts');
// single sum > qty throws (via validatePicks; lineTotal is pure math and
// does not enforce group rules without a menu — order-time validation does)
ok(lineTotal(drink, { addonIds: ['pepsi-a', 'pepsi-b'], addonQty: { 'pepsi-a': 3, 'pepsi-b': 2 }, qty: 4 }) === 250000, 'lineTotal pure math ignores groups (4*50k+3*10k+2*10k)');
throwsCode(() => validatePicks(splitMenu, drink, ['pepsi-a', 'pepsi-b'], { 'pepsi-a': 3, 'pepsi-b': 2 }, 4), 'invalid_addon', 'single sum>qty throws');
throwsCode(() => validatePicks(splitMenu, drink, ['extra-veg'], { 'extra-veg': 2 }, 4), 'invalid_addon', 'multi partial-count throws');
ok((() => { validatePicks(splitMenu, drink, ['extra-veg'], { 'extra-veg': 4 }, 4); return true; })(), 'multi full-count passes');
ok((() => { validatePicks(splitMenu, drink, ['pepsi-a', 'pepsi-b'], { 'pepsi-a': 2, 'pepsi-b': 2 }, 4); return true; })(), 'single 2+2 passes');
// orphan-group addons behave as multi
throwsCode(() => validatePicks(splitMenu, drink, ['orphan-opt'], { 'orphan-opt': 1 }, 4), 'invalid_addon', 'orphan partial-count throws (multi)');
ok((() => { validatePicks(splitMenu, drink, ['orphan-opt'], { 'orphan-opt': 4 }, 4); return true; })(), 'orphan full-count passes');
// sizes-section group never constrains addons (forced multi even though single would allow 2/4)
{
  const sizesSingle = JSON.parse(JSON.stringify(splitMenu));
  sizesSingle.settings.featureGroups.find((g) => g.id === 'sizes').selection = 'single';
  throwsCode(() => validatePicks(sizesSingle, drink, ['size-opt'], { 'size-opt': 2 }, 4), 'invalid_addon', 'sizes group forced multi for addons');
}
// bad shapes still throw invalid_addon
throwsCode(() => validatePicks(splitMenu, drink, ['pepsi-a', 'pepsi-a'], { 'pepsi-a': 4 }, 4), 'invalid_addon', 'dupes rejected');
throwsCode(() => validatePicks(splitMenu, drink, ['ghost'], { ghost: 1 }, 4), 'invalid_addon', 'unknown id rejected');
throwsCode(() => validatePicks(splitMenu, drink, ['pepsi-a'], { 'pepsi-a': 1.5 }, 4), 'invalid_addon', 'non-int count rejected');
throwsCode(() => validatePicks(splitMenu, drink, ['pepsi-a'], { 'pepsi-a': 5 }, 4), 'invalid_addon', 'count>qty rejected');
throwsCode(() => validatePicks(splitMenu, drink, ['pepsi-a'], 'nope', 4), 'invalid_addon', 'non-object addonQty rejected');
// normalizeMenu preserves selection + prompt round-trip
{
  const withGroups = normalizeMenu({
    items: [],
    settings: {
      ordering: {},
      featureGroups: [
        { id: 'choice', name: { en: 'Choice', ar: 'الاختيار' }, selection: 'single', prompt: { en: 'Pick one', ar: 'اختر واحدًا' } },
        { id: 'addons', name: { en: 'Add-ons', ar: 'إضافات' } },
      ],
      featureDefs: [],
    },
  });
  const choice = withGroups.settings.featureGroups.find((g) => g.id === 'choice');
  ok(choice && choice.selection === 'single', 'normalize preserves selection');
  ok(choice && choice.prompt && choice.prompt.en === 'Pick one' && choice.prompt.ar === 'اختر واحدًا', 'normalize preserves prompt');
  const addons = withGroups.settings.featureGroups.find((g) => g.id === 'addons');
  ok(addons && addons.selection === 'multi' && !('prompt' in addons), 'normalize defaults selection, absent prompt stays absent');
  const again = normalizeMenu(JSON.parse(JSON.stringify(withGroups)));
  ok(JSON.stringify(again.settings.featureGroups) === JSON.stringify(withGroups.settings.featureGroups), 'normalize round-trip stable');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
