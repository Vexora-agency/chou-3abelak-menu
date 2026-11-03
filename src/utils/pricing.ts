/**
 * Shared pricing engine (client copy).
 * MUST stay behavior-identical to functions/_shared/pricing.js.
 * Split: menu normalization lives in ./pricing-menu.ts, smart badges in
 * ./pricing-badges.ts. This file re-exports them so existing importers keep
 * working with identical export names.
 */
import type { FeatureDef, FeatureGroup, ItemAddon, ItemVariant, MenuData, MenuItem } from '@/src/types/menu';
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
  /** Split quantities: featureId → 0..qty. Absent = legacy (all units). */
  addonQty?: Record<string, number>;
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
  group: FeatureGroup;
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
  const allGroups = (Array.isArray(st.featureGroups) ? (st.featureGroups as FeatureGroup[]) : []).filter(
    (g) => g && typeof (g as unknown as { id?: unknown }).id === 'string'
  ) as FeatureGroup[];
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Group id for a feature (null when the library has no such feature). */
function featureGroupId(menu: MenuData, featureId: string): string | null {
  try {
    const s = menu && (menu.settings as unknown) && typeof (menu.settings as unknown) === 'object'
      ? (menu.settings as unknown as { featureDefs?: unknown }).featureDefs
      : undefined;
    const defs = Array.isArray(s) ? (s as FeatureDef[]) : [];
    const d = defs.find((x) => x && x.id === featureId);
    return d && typeof d.groupId === 'string' ? d.groupId : null;
  } catch {
    return null;
  }
}

/**
 * Add-on selection rule for a group: 'single' | 'multi'.
 * Defaults to 'multi' when the group/selection is missing or invalid.
 * The sizes-section group ('sizes') never constrains add-ons — it always
 * behaves as 'multi' (sizes stay single-required via variants as today).
 */
function groupSelection(menu: MenuData, groupId: string | null): 'single' | 'multi' {
  if (groupId === 'sizes') return 'multi';
  try {
    const st = menu && (menu.settings as unknown) && typeof (menu.settings as unknown) === 'object'
      ? (menu.settings as unknown as { featureGroups?: unknown })
      : {};
    const groups = Array.isArray(st.featureGroups) ? (st.featureGroups as FeatureGroup[]) : [];
    const g = groups.find((x) => x && x.id === groupId);
    if (g && g.selection === 'single') return 'single';
  } catch {}
  return 'multi';
}

/**
 * Validate split-quantity add-on picks. Throws 'invalid_addon' on ANY
 * violation (unknown/disabled id, dupes, non-int or out-of-range counts,
 * multi partial-count, single sum overflow). Legacy calls without addonQty
 * validate ids exactly as today. `qty` bounds counts (0..qty); when qty is
 * not an integer only id/shape checks run so the caller's qty validation
 * still reports 'invalid_qty'.
 */
export function validatePicks(
  menu: MenuData,
  item: MenuItem,
  addonIds?: string[],
  addonQty?: Record<string, number>,
  qty?: number,
): void {
  function idsOf(v: unknown): string[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new Error('invalid_addon');
    return v as string[];
  }
  const list = idsOf(addonIds);
  const seen = new Set<string>();
  const enabled = itemAddons(item);
  for (const id of list) {
    if (typeof id !== 'string' || seen.has(id)) throw new Error('invalid_addon');
    seen.add(id);
    const found = enabled.find((a) => a && a.featureId === id);
    if (!found || !isMoney(found.price) || found.price < 0) throw new Error('invalid_addon');
  }
  if (addonQty === undefined || addonQty === null) return;
  if (!isPlainObject(addonQty)) throw new Error('invalid_addon');
  for (const k of Object.keys(addonQty)) {
    if (!seen.has(k)) throw new Error('invalid_addon');
  }
  const qInt = isInt(qty) ? (qty as number) : null;
  for (const id of list) {
    if (!Object.prototype.hasOwnProperty.call(addonQty, id)) continue;
    const c: unknown = (addonQty as Record<string, unknown>)[id];
    if (!isInt(c) || (c as number) < 0) throw new Error('invalid_addon');
    if (qInt !== null && (c as number) > qInt) throw new Error('invalid_addon');
  }
  if (qInt === null) return;
  const resolved = new Map<string, number>();
  for (const id of list) {
    const c: unknown = Object.prototype.hasOwnProperty.call(addonQty, id)
      ? (addonQty as Record<string, unknown>)[id]
      : qInt;
    if (!isInt(c) || (c as number) < 0 || (c as number) > qInt) throw new Error('invalid_addon');
    resolved.set(id, c as number);
  }
  const byGroup = new Map<string | null, { sel: 'single' | 'multi'; sum: number }>();
  for (const [fid, c] of resolved) {
    const gid = featureGroupId(menu, fid);
    const sel = groupSelection(menu, gid);
    if (sel === 'multi') {
      if (c !== 0 && c !== qInt) throw new Error('invalid_addon');
    }
    if (!byGroup.has(gid)) byGroup.set(gid, { sel, sum: 0 });
    const g = byGroup.get(gid)!;
    g.sum += c;
  }
  for (const [, g] of byGroup) {
    if (g.sel === 'single' && g.sum > (qInt as number)) throw new Error('invalid_addon');
  }
}

/** Alias with an explicit name for UI/admin implementers. */
export const validateAddonPicks = validatePicks;

/**
 * Add-on money. Legacy (no addonQty): per-unit sum of enabled prices,
 * exactly as today. Split (addonQty object): TOTAL for the line,
 * Σ price_o × count_o where count_o = addonQty[o] ?? qty.
 * Throws 'invalid_addon' on unknown/disabled ids, dupes, or bad counts.
 */
export function addonSum(
  item: MenuItem,
  addonIds?: string[],
  addonQty?: Record<string, number>,
  qty?: number,
): number {
  const ids = Array.isArray(addonIds) ? addonIds : [];
  const seen = new Set<string>();
  const enabled = itemAddons(item);
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) throw new Error('invalid_addon');
    seen.add(id);
    const found = enabled.find((a) => a && a.featureId === id);
    if (!found || !isMoney(found.price) || found.price < 0) throw new Error('invalid_addon');
  }
  if (addonQty === undefined || addonQty === null) {
    let sum = 0;
    for (const id of ids) {
      const found = enabled.find((a) => a && a.featureId === id);
      sum += (found as ItemAddon).price;
    }
    return sum;
  }
  if (!isPlainObject(addonQty)) throw new Error('invalid_addon');
  for (const k of Object.keys(addonQty)) {
    if (!seen.has(k)) throw new Error('invalid_addon');
  }
  const qInt = isInt(qty) ? (qty as number) : null;
  let total = 0;
  for (const id of ids) {
    const has = Object.prototype.hasOwnProperty.call(addonQty, id);
    if (!has && qInt === null) continue; // qty check reports invalid_qty downstream
    const c: unknown = has ? (addonQty as Record<string, unknown>)[id] : qInt;
    if (!isInt(c) || (c as number) < 0 || (qInt !== null && (c as number) > qInt)) throw new Error('invalid_addon');
    const found = enabled.find((a) => a && a.featureId === id);
    total += (found as ItemAddon).price * (c as number);
  }
  return total;
}

/**
 * Full line total. Legacy (no addonQty): qty * (unit + per-unit add-ons),
 * byte-identical to today. Split: qty * unit + Σ price_o × count_o.
 * Throws 'invalid_addon' / 'invalid_qty' (unknown variant via unitPrice).
 */
export function lineTotal(item: MenuItem, sel: LineSelection): number {
  const { variantId, addonIds, addonQty, qty } = sel || ({} as LineSelection);
  const unit = unitPrice(item, variantId);
  const addons = addonSum(item, addonIds, addonQty, qty);
  if (!isInt(qty)) throw new Error('invalid_qty');
  if (addonQty === undefined || addonQty === null) {
    return round2((qty as number) * (unit + addons));
  }
  return round2((qty as number) * unit + addons);
}

/** Per-unit price including add-ons. Legacy (no addonQty) exactly as today;
 *  split (addonQty) returns the average: unit + totalAddons / qty. */
export function perUnitPrice(
  item: MenuItem,
  sel: { variantId?: string; addonIds?: string[]; addonQty?: Record<string, number>; qty?: number },
): number {
  const unit = unitPrice(item, sel?.variantId);
  if (sel?.addonQty === undefined || sel?.addonQty === null) {
    return round2(unit + addonSum(item, sel?.addonIds));
  }
  const q: unknown = sel?.qty;
  if (!isInt(q) || (q as number) <= 0) throw new Error('invalid_qty');
  return round2(unit + addonSum(item, sel?.addonIds, sel?.addonQty, q as number) / (q as number));
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

/**
 * Deterministic cart-line key.
 * Legacy (no addonQty): `id|variantId|sortedIds`, byte-identical to today.
 * Split (addonQty object): `id|variantId|sorted(fid:count)` using ONLY
 * nonzero counts; missing counts default to `qty` (pass qty when keys must
 * distinguish defaulted options). Zero counts are dropped. Never throws.
 */
export function cartLineKey(
  id: string,
  variantId?: string,
  addonIds?: string[],
  addonQty?: Record<string, number>,
  qty?: number,
): string {
  if (addonQty === undefined || addonQty === null || !isPlainObject(addonQty)) {
    const ids = Array.isArray(addonIds) ? [...addonIds].sort() : [];
    return `${id}|${variantId || ''}|${ids.join(',')}`;
  }
  const qInt = isInt(qty) ? (qty as number) : null;
  const counts = new Map<string, number>();
  const ids = Array.isArray(addonIds) ? addonIds : [];
  for (const fid of ids) {
    if (typeof fid !== 'string') continue;
    const has = Object.prototype.hasOwnProperty.call(addonQty, fid);
    const c: unknown = has ? (addonQty as Record<string, unknown>)[fid] : qInt;
    if (!isInt(c) || (c as number) === 0) continue;
    counts.set(fid, c as number);
  }
  for (const k of Object.keys(addonQty)) {
    if (counts.has(k)) continue;
    const c: unknown = (addonQty as Record<string, unknown>)[k];
    if (typeof k !== 'string' || !isInt(c) || (c as number) === 0) continue;
    counts.set(k, c as number);
  }
  const pairs = [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([fid, c]) => `${fid}:${c}`);
  return `${id}|${variantId || ''}|${pairs.join(',')}`;
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

/** Card price label: lowest variant price ("80,000 LBP"), "FREE"/"مجاناً" when 0. */
export function priceLabel(item: MenuItem, lang: 'en' | 'ar', currency: string): string {
  const free = lang === 'ar' ? 'مجاناً' : 'FREE';
  const p = normalizePricing(item);
  if (hasVariants(item)) {
    if (minVariantPrice(item) === 0) return free;
    return formatPrice(minVariantPrice(item), currency);
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
