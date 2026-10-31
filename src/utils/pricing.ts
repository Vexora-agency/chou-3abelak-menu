/**
 * Shared pricing engine (client copy).
 * MUST stay behavior-identical to functions/_shared/pricing.js.
 * Split: menu normalization lives in ./pricing-menu.ts, smart badges in
 * ./pricing-badges.ts. This file re-exports them so existing importers keep
 * working with identical export names.
 */
import type { FeatureDef, ItemAddon, ItemVariant, MenuData, MenuItem } from '@/src/types/menu';
import { normalizePricing, round2 } from '@/src/utils/pricing-menu';

export { UNITS, normalizeMenu, normalizePricing, round2 } from '@/src/utils/pricing-menu';
export type { NormalizedPricing } from '@/src/utils/pricing-menu';
export { effectiveBadges, isNewItem, topSellers } from '@/src/utils/pricing-badges';
export type { RankedItem, TopSellerOptions } from '@/src/utils/pricing-badges';

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

/** Money: finite number (decimals allowed, rounded to 2 downstream). */
function isMoney(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export interface LineSelection {
  variantId?: string;
  addonIds?: string[];
  qty: number;
}

/** Find a variant by its feature id (explicit default, else first). Never reorders. */
export function getVariant(item: MenuItem, variantId?: string): ItemVariant | null {
  const list = item && Array.isArray(item.variants) ? item.variants : [];
  if (!variantId) {
    if (list.length === 0) return null;
    if (typeof item.defaultVariant === 'string' && item.defaultVariant) {
      const d = list.find((v) => v && v.featureId === item.defaultVariant);
      if (d) return d;
    }
    return list[0];
  }
  return list.find((v) => v && v.featureId === variantId) || null;
}

export function hasVariants(item: MenuItem): boolean {
  return !!(item && Array.isArray(item.variants) && item.variants.length > 0);
}

/** Feature library lookup (null when missing). */
export function featureDef(menu: MenuData, featureId: string): FeatureDef | null {
  const s = menu && (menu.settings as unknown) && typeof (menu.settings as unknown) === 'object'
    ? (menu.settings as unknown as { featureDefs?: unknown }).featureDefs
    : undefined;
  const defs = Array.isArray(s) ? (s as FeatureDef[]) : [];
  return defs.find((d) => d && d.id === featureId) || null;
}

export interface FeatureGroupView {
  group: { id: string; name: { en: string; ar: string } };
  features: FeatureDef[];
}

/**
 * Library grouped for display: groups in order, plus a trailing bucket
 * for features with an unknown group.
 */
export function featuresByGroup(menu: MenuData): FeatureGroupView[] {
  const st = menu && (menu.settings as unknown) && typeof (menu.settings as unknown) === 'object'
    ? (menu.settings as unknown as { featureGroups?: unknown; featureDefs?: unknown })
    : {};
  const allGroups = (Array.isArray(st.featureGroups) ? (st.featureGroups as FeatureDef[]) : []).filter(
    (g) => g && typeof (g as unknown as { id?: unknown }).id === 'string'
  ) as { id: string; name: { en: string; ar: string } }[];
  const defs = (Array.isArray(st.featureDefs) ? (st.featureDefs as FeatureDef[]) : []).filter(
    (d) => d && typeof d.id === 'string'
  );
  const out: FeatureGroupView[] = allGroups.map((g) => ({
    group: g,
    features: defs.filter((d) => d.groupId === g.id),
  }));
  const rest = defs.filter((d) => !allGroups.some((g) => g.id === d.groupId));
  if (rest.length) out.push({ group: { id: '', name: { en: 'Other', ar: 'أخرى' } }, features: rest });
  return out;
}

/** Display name of a feature in one language (falls back to the id). */
export function featureName(menu: MenuData, featureId: string, lang: 'en' | 'ar'): string {
  const d = featureDef(menu, featureId);
  if (!d || !d.name || typeof d.name !== 'object') return typeof featureId === 'string' ? featureId : '';
  const primary = lang === 'ar' ? d.name.ar : d.name.en;
  if (typeof primary === 'string' && primary.trim()) return primary;
  const other = lang === 'ar' ? d.name.en : d.name.ar;
  return typeof other === 'string' && other ? other : String(featureId || '');
}

/** Add-ons enabled on this very item. */
export function itemAddons(item: MenuItem): ItemAddon[] {
  return item && Array.isArray(item.addons) ? item.addons : [];
}

export function hasOptions(item: MenuItem): boolean {
  return hasVariants(item) || itemAddons(item).length > 0;
}

/** Per-unit base price: variant price (first = default) or pricing.price. Throws when unresolvable. */
export function unitPrice(item: MenuItem, variantId?: string): number {
  if (hasVariants(item)) {
    const v = getVariant(item, variantId);
    if (!v) throw new Error('unknown_variant');
    if (!isMoney(v.price) || v.price < 0) throw new Error('unknown_variant');
    return v.price;
  }
  const p = normalizePricing(item);
  if (!isMoney(p.price)) throw new Error('no_price');
  return p.price;
}

/** Lowest variant price (for "From X" labels). Throws when unpriced. */
export function minVariantPrice(item: MenuItem): number {
  if (!hasVariants(item)) return unitPrice(item);
  let min = Infinity;
  for (const v of item.variants || []) {
    if (v && isMoney(v.price) && v.price >= 0 && v.price < min) min = v.price;
  }
  if (!Number.isFinite(min)) throw new Error('no_price');
  return min;
}

/** Full line total: qty * (unitPrice + enabled add-ons). Throws 'invalid_addon' / 'invalid_qty'. */
export function lineTotal(item: MenuItem, sel: LineSelection): number {
  const { variantId, addonIds, qty } = sel || ({} as LineSelection);
  const unit = unitPrice(item, variantId);
  const addons = addonSum(item, addonIds);
  if (!isInt(qty)) throw new Error('invalid_qty');
  return round2((qty) * (unit + addons));
}

/** Per-unit price including enabled add-ons. */
export function perUnitPrice(item: MenuItem, sel: { variantId?: string; addonIds?: string[] }): number {
  return round2(unitPrice(item, sel?.variantId) + addonSum(item, sel?.addonIds));
}

function addonSum(item: MenuItem, addonIds?: string[]): number {
  let sum = 0;
  const ids = Array.isArray(addonIds) ? addonIds : [];
  const seen = new Set<string>();
  const enabled = itemAddons(item);
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) throw new Error('invalid_addon');
    seen.add(id);
    const found = enabled.find((a) => a && a.featureId === id);
    if (!found || !isMoney(found.price) || found.price < 0) throw new Error('invalid_addon');
    sum += found.price;
  }
  return sum;
}

/** qty integer on the min/step/max grid. */
export function isValidQty(item: MenuItem, qty: unknown): boolean {
  if (!isInt(qty)) return false;
  const p = normalizePricing(item);
  if ((qty) < p.minQty || (qty) > p.maxQty) return false;
  return ((qty) - p.minQty) % p.step === 0;
}

/** Snap a quantity to the nearest valid value on the item's grid. */
export function clampQty(item: MenuItem, qty: unknown): number {
  const p = normalizePricing(item);
  let q = Math.round(Number(qty));
  if (!Number.isFinite(q)) q = p.minQty;
  q = Math.max(p.minQty, Math.min(p.maxQty, q));
  const steps = Math.round((q - p.minQty) / p.step);
  return p.minQty + steps * p.step;
}

/** Deterministic cart-line key: id + variantId + sorted addonIds. */
export function cartLineKey(id: string, variantId?: string, addonIds?: string[]): string {
  const ids = Array.isArray(addonIds) ? [...addonIds].sort() : [];
  return `${id}|${variantId || ''}|${ids.join(',')}`;
}

/** Thousands separators; up to 2 decimals shown only when needed
 *  (10.5 -> "10.5", 80,000 stays "80,000"), unless currency.decimals says so. */
export function formatPrice(n: number, currency?: string | { code?: string; decimals?: number }): string {
  let code = '';
  let decimals = 0;
  if (typeof currency === 'string') code = currency;
  else if (currency && typeof currency === 'object') {
    code = typeof currency.code === 'string' ? currency.code : '';
    decimals = isInt(currency.decimals) && (currency.decimals) > 0 ? Math.min(currency.decimals, 4) : 0;
  }
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  let formatted: string;
  if (decimals > 0) {
    formatted = v.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  } else {
    const r = round2(v);
    if (Number.isInteger(r)) {
      formatted = r.toLocaleString('en-US');
    } else {
      const parts = String(r).split('.');
      formatted = `${Number(parts[0]).toLocaleString('en-US')}.${parts[1]}`;
    }
  }
  return code ? `${formatted} ${code}` : formatted;
}

// Arabic counted noun: 1 = singular, 2 = dual (oblique ين — the UI always
// renders the numeral before it, e.g. "2 قطعتين"), 3-10 = plural,
// 11+ = singular again (tamyiiz: "11 قطعة"). `one` doubles as the 11+
// form — intentional, do NOT "fix" to plural.
function arabicCount(qty: number, one: string, two: string, few: string): string {
  if (qty === 1) return one;
  if (qty === 2) return two;
  if (qty >= 3 && qty <= 10) return few;
  return one; // 11+ → singular, intentional
}

/** Localized unit word for a quantity. Unknown units echo back. */
export function unitLabel(unit: string, qty: number, lang: 'en' | 'ar'): string {
  const q = typeof qty === 'number' ? qty : 1;
  if (lang === 'ar') {
    switch (unit) {
      case 'pc': return arabicCount(q, 'قطعة', 'قطعتين', 'قطع');
      case 'portion': return arabicCount(q, 'حصة', 'حصتين', 'حصص');
      case 'dozen': return arabicCount(q, 'دستة', 'دستتين', 'دستات');
      case 'box': return arabicCount(q, 'علبة', 'علبتين', 'علب');
      case 'bottle': return arabicCount(q, 'زجاجة', 'زجاجتين', 'زجاجات');
      case 'glass': return arabicCount(q, 'كأس', 'كأسين', 'كؤوس');
      case 'kg': return 'كغ'; // abbreviation — invariant by design
      default: return typeof unit === 'string' ? unit : '';
    }
  }
  switch (unit) {
    case 'pc': return q === 1 ? 'pc' : 'pcs';
    case 'portion': return q === 1 ? 'portion' : 'portions';
    case 'dozen': return q === 1 ? 'dozen' : 'dozens';
    case 'box': return q === 1 ? 'box' : 'boxes';
    case 'bottle': return q === 1 ? 'bottle' : 'bottles';
    case 'glass': return q === 1 ? 'glass' : 'glasses';
    case 'kg': return 'kg';
    default: return typeof unit === 'string' ? unit : '';
  }
}

/** Card price label: "From 80,000 LBP" for variants, "FREE"/"مجاناً" when 0. */
export function priceLabel(item: MenuItem, lang: 'en' | 'ar', currency: string): string {
  const free = lang === 'ar' ? 'مجاناً' : 'FREE';
  const p = normalizePricing(item);
  if (hasVariants(item)) {
    if (minVariantPrice(item) === 0) return free;
    const from = lang === 'ar' ? 'من' : 'From';
    return `${from} ${formatPrice(minVariantPrice(item), currency)}`;
  }
  if (!isMoney(p.price)) return '—';
  if (p.price === 0) return free;
  const base = formatPrice(p.price, currency);
  if (p.showUnit) return `${base} / ${unitLabel(p.unit, 1, lang)}`;
  return base;
}

/** "3 × 120,000 = 360,000" (unit word inserted when showUnit). */
export function lineMathText(item: MenuItem, qty: number, unit: number, lang: 'en' | 'ar'): string {
  const p = normalizePricing(item);
  const total = qty * unit;
  const left = p.showUnit ? `${qty} ${unitLabel(p.unit, qty, lang)}` : `${qty}`;
  return `${left} × ${formatPrice(unit)} = ${formatPrice(total)}`;
}
