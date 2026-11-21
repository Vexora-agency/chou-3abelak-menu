/**
 * Feature-section colors — contract checks.
 * Run: node scripts/test-feature-colors.mjs
 *
 * Colors are OPTIONAL admin metadata on a feature-library section. They show
 * in the admin Libraries tab; the customer keeps one unified brand color and
 * the heat section stays red.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FEATURE_COLOR_IDS,
  normalizeFeatureColor,
} from '../functions/_shared/feature-colors.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const has = (source, ...needles) => needles.every((needle) => source.includes(needle));

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

const KEYS = [
  'gold',
  'amber',
  'orange',
  'red',
  'rose',
  'violet',
  'sky',
  'emerald',
  'vegetables',
  'cheese',
  'meat',
  'chicken',
  'seafood',
  'sauce',
  'bread',
  'drinks',
  'dessert',
  'vegan',
  'mushroom',
  'olive',
];
/** Semantic food shortcuts — the part the admin asked for: vegetables green,
 *  cheese yellow, meat/chicken/seafood/sauce/bread/drinks/dessert/vegan/
 *  mushroom/olive. They stay optional and admin-only. */
const FOOD_KEYS = KEYS.slice(8);

/* ---------- server allowlist + normalizer ---------- */

check(
  'the server allows exactly the curated section colors',
  KEYS.every((key) => FEATURE_COLOR_IDS.has(key)) && FEATURE_COLOR_IDS.size === KEYS.length
);
check(
  'valid colors pass and anything else is dropped',
  KEYS.every((key) => normalizeFeatureColor(key) === key)
    && normalizeFeatureColor('blue') === undefined
    && normalizeFeatureColor('') === undefined
    && normalizeFeatureColor(null) === undefined
);

const serverValidate = read('functions/_shared/validate-feature-library.js');
check(
  'menu validation keeps a valid section color',
  has(serverValidate, 'normalizeFeatureColor(g.color)', 'if (color) grp.color = color')
);
const serverPricing = read('functions/_shared/pricing-menu.js');
check(
  'server menu normalization keeps a valid section color',
  has(serverPricing, 'normalizeFeatureColor(color)', 'if (colorId) g.color = colorId')
);

/* ---------- type + client palette + normalization ---------- */

const types = read('src/types/menu.ts');
check(
  'FeatureGroup carries an optional FeatureColorId',
  has(types, 'FeatureColorId =', 'color?: FeatureColorId')
);
const colors = read('src/utils/featureColors.ts');
check(
  'the client palette defines every allowed color',
  KEYS.every((key) => colors.includes(`id: '${key}'`))
);
check(
  'the palette is split into General and Food groups',
  has(colors, "id: 'general'", "id: 'food'", 'featureColorsInGroup')
    && KEYS.every((key) => colors.includes(`id: '${key}'`))
    && colors.includes(`group: 'general'`)
    && colors.includes(`group: 'food'`)
);
check(
  'famous add-ons have professional semantic colors',
  FOOD_KEYS.every((key) => colors.includes(`id: '${key}'`))
    && has(colors, "id: 'vegetables'", "swatch: 'bg-green-600'")
    && has(colors, "id: 'cheese'", "swatch: 'bg-yellow-400'")
    && has(colors, "id: 'meat'", "swatch: 'bg-red-700'")
    && has(colors, "id: 'chicken'", "swatch: 'bg-orange-400'")
    && has(colors, "id: 'seafood'", "swatch: 'bg-cyan-500'")
    && has(colors, "id: 'sauce'", "swatch: 'bg-rose-600'")
    && has(colors, "id: 'bread'", "swatch: 'bg-amber-700'")
    && has(colors, "id: 'drinks'", "swatch: 'bg-blue-500'")
    && has(colors, "id: 'dessert'", "swatch: 'bg-pink-400'")
    && has(colors, "id: 'vegan'", "swatch: 'bg-lime-500'")
    && has(colors, "id: 'mushroom'", "swatch: 'bg-stone-500'")
    && has(colors, "id: 'olive'", "swatch: 'bg-lime-700'")
);
check(
  'customer chips share one unified brand treatment',
  has(colors, 'UNIFIED_FEATURE_CHIP_ACTIVE', 'UNIFIED_FEATURE_CHIP_IDLE', 'bg-[var(--primary)] text-[#0A0A0A]', 'bg-[var(--primary)]/10')
);
const clientPricing = read('src/utils/pricing-menu.ts');
check(
  'client menu normalization keeps a valid section color',
  has(clientPricing, 'isFeatureColorId(color)', 'g.color = color')
);

/* ---------- admin UI ---------- */

const admin = read('src/features/admin/components/FeaturesSection.tsx');
check(
  'the admin has an optional section color picker with a None choice',
  has(admin, 'SectionColorPicker', "isAr ? 'لون القسم (اختياري)' : 'Section color (optional)'", 'setColor(undefined)')
);
check(
  'the picker shows General and Food color rows',
  has(admin, 'FEATURE_COLOR_GROUPS.map', 'featureColorsInGroup(groupDef.id)', 'groupDef.label')
);
check(
  'the chosen color paints the section header and feature-list edge',
  has(admin, 'colorDef.pill', 'borderInlineStartColor: colorDef.hex', '<Tag', '<Flame')
);
check(
  'the heat section is locked red and has no color picker',
  has(admin, "isAr ? 'قسم الحار ثابت باللون الأحمر — لا يتغيّر.' : 'The heat section is fixed red — it cannot change.'", 'if (isSpicy)')
);
check(
  'the picker explains that the customer menu stays unified',
  has(admin, 'Admin organization only', 'the customer menu stays one unified color, and heat stays red')
);

/* ---------- customer storefront ---------- */

const variant = read('src/features/menu/components/item-view/VariantPicker.tsx');
const addon = read('src/features/menu/components/item-view/AddonPicker.tsx');
check(
  'customer size/add-on pills use the unified gold treatment',
  has(variant, 'UNIFIED_FEATURE_CHIP_ACTIVE', 'UNIFIED_FEATURE_CHIP_IDLE')
    && has(addon, 'UNIFIED_FEATURE_CHIP_ACTIVE', 'UNIFIED_FEATURE_CHIP_IDLE')
);
const spicy = read('src/features/menu/components/item-view/SpicySlider.tsx');
check(
  'the heat chip and slider stay red',
  has(spicy, 'bg-red-600/10 text-red-600 border-red-600/25', 'text-red-500', 'bg-red-500')
);
check(
  'no custom section color is read by the customer pickers',
  !variant.includes('featureColorDef') && !addon.includes('featureColorDef')
);

/* ---------- result ---------- */

if (fails > 0) {
  console.error(`\nFAIL — ${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nPASS — feature section colors contract holds');
