// Mirror test: the client pricing engine (src/utils/pricing.ts) must stay
// behavior-identical to the server copy (functions/_shared/pricing.js).
// Covers every function implemented on both sides with fixed fixtures.
// Deliberately EXCLUDED: normalizeMenu (the client intentionally extends the
// server defaults with render-safe settings blocks; the server validator
// remains the source of truth on write) and client-only display helpers
// (featureName, priceLabel, lineMathText have no server counterpart).
// Run: npx tsx scripts/test-client-pricing.ts
import * as client from '../src/utils/pricing';
import * as server from '../functions/_shared/pricing.js';

let pass = 0;
let fail = 0;

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k]))}}`;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return 'NaN';
  return JSON.stringify(v) ?? 'undefined';
}

function same(name: string, c: unknown, s: unknown): void {
  // Functions that throw on bad input must throw on BOTH sides.
  if (stable(c) === stable(s)) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}\n  client: ${stable(c).slice(0, 300)}\n  server: ${stable(s).slice(0, 300)}`);
  }
}

function both(name: string, fn: (p: Record<string, (...args: any[]) => unknown>) => unknown): void {
  let c: unknown;
  let s: unknown;
  try {
    c = fn(client as unknown as Record<string, (...args: any[]) => unknown>);
  } catch (e) {
    c = `throw:${e instanceof Error ? e.message : String(e)}`;
  }
  try {
    s = fn(server as unknown as Record<string, (...args: any[]) => unknown>);
  } catch (e) {
    s = `throw:${e instanceof Error ? e.message : String(e)}`;
  }
  same(name, c, s);
}

const NOW = 1720000000000;

const menu = {
  settings: {
    badges: { newDays: 14, topDays: 30, topCount: 6 },
    featureGroups: [
      { id: 'sizes', name: { en: 'Sizes', ar: 'أحجام' } },
      { id: 'addons', name: { en: 'Add-ons', ar: 'إضافات' } },
    ],
    featureDefs: [
      { id: 'regular', groupId: 'sizes', name: { en: 'Regular', ar: 'عادي' } },
      { id: 'large', groupId: 'sizes', name: { en: 'Large', ar: 'كبير' } },
      { id: 'veg', groupId: 'addons', name: { en: 'Veg', ar: 'خضار' } },
    ],
  },
};

const sized = {
  id: 'm1',
  pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
  variants: [
    { featureId: 'regular', price: 100 },
    { featureId: 'large', price: 180 },
  ],
  addons: [{ featureId: 'veg', price: 30 }],
  badges: ['top'],
  addedAt: new Date(NOW - 3 * 86400000).toISOString(),
};
const plain = {
  id: 'p1',
  pricing: { unit: 'dozen', price: 600, minQty: 1, step: 1, maxQty: 20, showUnit: true },
  badges: [] as string[],
};
const stepped = {
  id: 's1',
  pricing: { unit: 'box', price: 50, minQty: 2, step: 3, maxQty: 20, showUnit: false },
  badges: [] as string[],
};

both('round2 float dust', (p) => [p.round2(0.1 + 0.2), p.round2(10.005), p.round2(-3.456)]);
both('normalizePricing legacy price', (p) => [
  p.normalizePricing({ pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false }, price: 99.999 }),
  p.normalizePricing({ pricing: { unit: 'nope' } }),
]);
both('getVariant default/explicit/missing', (p) => [
  p.getVariant(sized),
  p.getVariant(sized, 'large'),
  p.getVariant(sized, 'nope'),
]);
both('hasVariants/hasOptions/itemAddons', (p) => [
  p.hasVariants(sized),
  p.hasVariants(plain),
  p.hasOptions(sized),
  p.hasOptions(plain),
  p.itemAddons(sized),
]);
both('unitPrice variants', (p) => [p.unitPrice(sized, undefined), p.unitPrice(sized, 'large')]);
both('unitPrice throws unknown variant', (p) => p.unitPrice(sized, 'ghost'));
both('unitPrice plain', (p) => p.unitPrice(plain, undefined));
both('minVariantPrice', (p) => p.minVariantPrice(sized));
both('lineTotal variant+addon x3', (p) => p.lineTotal(sized, { variantId: 'large', addonIds: ['veg'], qty: 3 }));
both('perUnitPrice', (p) => p.perUnitPrice(sized, { variantId: 'regular', addonIds: ['veg'] }));
both('lineTotal throws bad addon', (p) => p.lineTotal(sized, { addonIds: ['ghost'], qty: 1 }));
both('lineTotal throws bad qty', (p) => p.lineTotal(sized, { qty: 0 }));
both('isValidQty grid', (p) => [
  p.isValidQty(stepped, 2),
  p.isValidQty(stepped, 5),
  p.isValidQty(stepped, 3),
  p.isValidQty(stepped, 1.5),
]);
both('clampQty snaps', (p) => [p.clampQty(stepped, 4), p.clampQty(stepped, 99), p.clampQty(stepped, 0)]);
both('cartLineKey order', (p) => [
  p.cartLineKey('a', 'v1', ['x', 'y']),
  p.cartLineKey('a', 'v1', ['y', 'x']),
  p.cartLineKey('a'),
]);
both('featureDef/featureName', (p) => [
  p.featureDef(menu, 'large'),
  p.featureDef(menu, 'ghost'),
  (p.featuresByGroup(menu) as { group: { id: string }; features: unknown[] }[]).map((g) => [g.group.id, g.features.length]),
]);
both('isNewItem/effectiveBadges', (p) => [
  p.isNewItem(menu, sized, NOW),
  p.isNewItem(menu, { ...sized, addedAt: new Date(NOW - 60 * 86400000).toISOString() }, NOW),
  p.effectiveBadges(menu, sized, NOW),
]);
both('topSellers window+count', (p) =>
  p.topSellers(
    [
      { createdAt: new Date(NOW - 86400000).toISOString(), status: 'done', items: [{ id: 'm1', qty: 5 }] },
      { createdAt: new Date(NOW - 86400000).toISOString(), status: 'cancelled', items: [{ id: 'm1', qty: 99 }] },
      { createdAt: new Date(NOW - 200 * 86400000).toISOString(), status: 'done', items: [{ id: 'p1', qty: 7 }] },
    ],
    menu,
    { nowMs: NOW }
  )
);
both('formatPrice shapes', (p) => [
  p.formatPrice(80000, 'LBP'),
  p.formatPrice(10.5, 'LBP'),
  p.formatPrice(79999.9, { code: 'LBP', decimals: 2 }),
  p.formatPrice(NaN, 'LBP'),
]);
both('unitLabel en/ar', (p) => [
  p.unitLabel('pc', 1, 'en'),
  p.unitLabel('pc', 3, 'en'),
  p.unitLabel('pc', 2, 'ar'),
  p.unitLabel('dozen', 2, 'en'),
  p.unitLabel('mystery', 1, 'en'),
]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
