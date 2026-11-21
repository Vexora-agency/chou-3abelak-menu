/**
 * Feature-library colors — contract checks.
 * Run: node scripts/test-feature-colors.mjs
 *
 * Colors are OPTIONAL admin metadata on a library section and on each
 * individual feature (size/add-on). They show in the admin Libraries tab;
 * the customer keeps one unified brand color and heat stays red.
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

/** One clean, de-duplicated palette — no Food colors row. */
const KEYS = ['gold', 'amber', 'orange', 'red', 'rose', 'violet', 'sky', 'emerald'];

/* ---------- server allowlist + normalizer ---------- */

check(
  'the server allows exactly the curated general colors',
  KEYS.every((key) => FEATURE_COLOR_IDS.has(key)) && FEATURE_COLOR_IDS.size === KEYS.length
);
check(
  'valid colors pass and anything else is dropped',
  KEYS.every((key) => normalizeFeatureColor(key) === key)
    && normalizeFeatureColor('vegetables') === undefined
    && normalizeFeatureColor('blue') === undefined
    && normalizeFeatureColor('') === undefined
    && normalizeFeatureColor(null) === undefined
);

const serverValidate = read('functions/_shared/validate-feature-library.js');
check(
  'menu validation keeps valid section and feature colors',
  has(serverValidate, 'normalizeFeatureColor(g.color)', 'if (color) grp.color = color')
    && has(serverValidate, 'normalizeFeatureColor(f.color)', 'if (fcolor) def.color = fcolor')
);
const serverPricing = read('functions/_shared/pricing-menu.js');
check(
  'server menu normalization keeps section and feature colors',
  has(serverPricing, 'normalizeFeatureColor(color)', 'if (colorId) g.color = colorId')
    && has(serverPricing, 'normalizeFeatureColor(color)', 'if (colorId) def.color = colorId')
    && has(serverPricing, 'ensureDef(d.id, d.name, gid, undefined, d.color)')
);

/* ---------- type + client palette + normalization ---------- */

const types = read('src/types/menu.ts');
const featureDefBlock = types.slice(
  types.indexOf('export interface FeatureDef'),
  types.indexOf('export interface ItemVariant'),
);
check(
  'FeatureGroup and FeatureDef carry an optional FeatureColorId',
  has(types, 'FeatureColorId =', 'color?: FeatureColorId')
    && featureDefBlock.includes('color?: FeatureColorId')
);
check(
  'the palette has no semantic food colors',
  !types.includes("'vegetables'") && !types.includes("'cheese'")
);
const colors = read('src/utils/featureColors.ts');
check(
  'the client palette defines every allowed color',
  KEYS.every((key) => colors.includes(`id: '${key}'`))
);
check(
  'the palette is one general list with no names or groups',
  !colors.includes("group:") && !colors.includes('label:')
    && !colors.includes('Food colors') && !colors.includes('vegetables')
);
check(
  'customer chips share one unified brand treatment',
  has(colors, 'UNIFIED_FEATURE_CHIP_ACTIVE', 'UNIFIED_FEATURE_CHIP_IDLE', 'bg-[var(--primary)] text-[#0A0A0A]', 'bg-[var(--primary)]/10')
);
const clientPricing = read('src/utils/pricing-menu.ts');
check(
  'client menu normalization keeps section and feature colors',
  has(clientPricing, 'isFeatureColorId(color)', 'g.color = color')
    && has(clientPricing, 'isFeatureColorId(color)', 'def.color = color')
    && has(clientPricing, 'ensureDef(dd.id, dd.name, gid, undefined, dd.color)')
);

/* ---------- admin UI ---------- */

const admin = read('src/features/admin/components/FeaturesSection.tsx');
const swatches = read('src/features/admin/components/features/FeatureColorSwatches.tsx');
const featureRow = read('src/features/admin/components/features/FeatureRow.tsx');
check(
  'the admin has an optional section color picker with a None choice',
  has(admin, 'SectionColorPicker', "isAr ? 'لون القسم (اختياري)' : 'Section color (optional)'", 'onChange={setColor}')
    && has(swatches, "isAr ? 'بدون' : 'None'")
);
check(
  'the picker shows only the General colors row',
  has(admin, 'General colors', 'FeatureColorSwatches')
    && !admin.includes('Food colors')
    && !admin.includes('FEATURE_COLOR_GROUPS')
);
check(
  'swatches carry no color names or tooltips',
  has(swatches, 'Color ${index + 1}', 'aria-label={label}')
    && !swatches.includes('title=')
    && !swatches.includes('color.label')
);
check(
  'every feature row can set its own optional color',
  has(featureRow, "isAr ? 'لون الميزة (اختياري)' : 'Feature color (optional)'", 'FeatureColorSwatches', 'setColor', 'featureDefs:')
);
check(
  'the chosen section color paints the header and feature-list edge',
  has(admin, 'colorDef.pill', 'borderInlineStartColor: colorDef.hex', '<Tag')
);
check(
  'the heat section is not locked and its old message is gone',
  !admin.includes('The heat section is fixed red — it cannot change.')
    && !admin.includes('قسم الحار ثابت باللون الأحمر — لا يتغيّر.')
    && !admin.includes('isSpicy={isSpicy}')
    && !admin.includes("featureColorDef('red')")
);
check(
  'the picker explains that the customer menu stays unified',
  has(admin, 'Admin organization only', 'the customer menu stays one unified color')
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
const addonPill = read('src/components/AddonPill.tsx');
const itemModal = read('src/features/menu/components/ItemDetailsModal.tsx');
check(
  'selected add-ons appear as unified pills in the item header',
  has(itemModal, 'AddonPill', '!isSpicyFeatureId')
    && has(addonPill, 'bg-[var(--primary)]/10', 'text-[#8a6d00]', 'Check')
);
check(
  'no admin color is read by the customer storefront',
  !variant.includes('featureColorDef') && !addon.includes('featureColorDef')
    && !addonPill.includes('featureColorDef') && !itemModal.includes('featureColorDef')
);

/* ---------- result ---------- */

if (fails > 0) {
  console.error(`\nFAIL — ${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nPASS — feature library colors contract holds');
