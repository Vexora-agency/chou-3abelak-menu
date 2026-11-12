// Unit tests for priceLabel + requiredExtrasMin (src/utils/pricing.ts).
// Guards the menu-card price: an item with base price 0 but a REQUIRED
// priced flavor (mango/orange/…) must read the cheapest required flavor,
// never FREE. Optional-only extras keep FREE. Run: npx tsx scripts/test-price-label.ts
import { priceLabel, requiredExtrasMin } from '../src/utils/pricing';
import type { MenuData, MenuItem } from '../src/types/menu';

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string): void {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

const baseMenu = (settings: unknown): MenuData => ({
  version: 2,
  schemaVersion: 2,
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: settings as unknown as MenuData['settings'],
  categories: [],
  items: [],
});

const flavorMenu = baseMenu({
  featureGroups: [
    { id: 'flavors', name: { en: 'Flavors', ar: 'نكهات' } },
    { id: 'addons', name: { en: 'Add-ons', ar: 'إضافات' } },
  ],
  featureDefs: [
    { id: 'mango', groupId: 'flavors', name: { en: 'Mango', ar: 'مانجا' } },
    { id: 'orange', groupId: 'flavors', name: { en: 'Orange', ar: 'برتقال' } },
    { id: 'extra-shot', groupId: 'addons', name: { en: 'Extra', ar: 'إضافة' } },
  ],
});

const freeBase = { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 0 };

// 1. The juice case: base 0 + REQUIRED priced flavors -> cheapest flavor, not FREE.
const juice: MenuItem = {
  id: 'drink-juice',
  categoryId: 'drinks',
  name: { en: 'Juice', ar: 'عصير' },
  description: { en: '', ar: '' },
  pricing: { ...freeBase },
  badges: [],
  featured: false,
  available: true,
  addons: [
    { featureId: 'mango', price: 50000 },
    { featureId: 'orange', price: 60000 },
  ],
  requiredGroups: ['flavors'],
} as unknown as MenuItem;
ok(requiredExtrasMin(juice, flavorMenu) === 50000, 'required extras = cheapest flavor');
ok(priceLabel(juice, 'en', 'LBP', flavorMenu) !== 'FREE', 'juice card never FREE with menu');
ok(priceLabel(juice, 'en', 'LBP', flavorMenu).includes('50,000'), 'juice card reads cheapest flavor');
ok(priceLabel(juice, 'ar', 'ل.ل', flavorMenu).includes('50,000'), 'juice card ar reads cheapest flavor');
// Legacy 3-arg callers keep the old behavior (extras read as 0).
ok(priceLabel(juice, 'en', 'LBP') === 'FREE', 'menu-less callers keep legacy FREE');

// 2. Plain free item (base 0, optional extras only) stays FREE.
const plainFree: MenuItem = {
  ...juice,
  id: 'plain',
  addons: [{ featureId: 'extra-shot', price: 10000 }],
  requiredGroups: [],
} as unknown as MenuItem;
ok(requiredExtrasMin(plainFree, flavorMenu) === 0, 'optional-only extras add nothing');
ok(priceLabel(plainFree, 'en', 'LBP', flavorMenu) === 'FREE', 'optional-only extras stay FREE');

// 3. Required group with no enabled option is skipped (same rule as validation).
const emptyReq: MenuItem = {
  ...juice,
  id: 'empty-req',
  addons: [{ featureId: 'extra-shot', price: 10000 }],
  requiredGroups: ['flavors'],
} as unknown as MenuItem;
ok(requiredExtrasMin(emptyReq, flavorMenu) === 0, 'uncovered required group skipped');
ok(priceLabel(emptyReq, 'en', 'LBP', flavorMenu) === 'FREE', 'uncovered required group stays FREE');

// 4. Variants + required group: cheapest variant + cheapest required flavor.
const sized: MenuItem = {
  ...juice,
  id: 'sized',
  pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
  variants: [
    { featureId: 'regular', price: 80000 },
    { featureId: 'large', price: 120000 },
  ],
} as unknown as MenuItem;
ok(priceLabel(sized, 'en', 'LBP', flavorMenu).includes('130,000'), 'variants add required extras (80k + 50k)');

// 5. Unpriced base + required priced group reads the required minimum, not '—'.
const unpriced: MenuItem = {
  ...juice,
  id: 'unpriced',
  pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
} as unknown as MenuItem;
ok(priceLabel(unpriced, 'en', 'LBP', flavorMenu).includes('50,000'), 'unpriced base + required group reads required min');

// 6. Badged-spicy with free heat stays FREE (heat adds 0).
const spicyFree: MenuItem = {
  ...juice,
  id: 'spicy-free',
  badges: ['spicy'],
  addons: [
    { featureId: 'spicy-mild', price: 0 },
    { featureId: 'spicy-medium', price: 0 },
    { featureId: 'spicy-hot', price: 0 },
  ],
  requiredGroups: [],
} as unknown as MenuItem;
ok(requiredExtrasMin(spicyFree, flavorMenu) === 0, 'free heat adds nothing');
ok(priceLabel(spicyFree, 'en', 'LBP', flavorMenu) === 'FREE', 'spicy with free heat stays FREE');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
