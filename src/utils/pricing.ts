/**
 * Shared pricing engine (client copy).
 * MUST stay behavior-identical to functions/_shared/pricing.js.
 */
import type { FeatureDef, FeatureGroup, MenuData, MenuItem, ItemVariant, ItemAddon, PricingUnit } from '../types/menu';

export const UNITS: PricingUnit[] = ['pc', 'portion', 'dozen', 'box', 'bottle', 'glass', 'kg'];

const DEFAULT_PRICING = { unit: 'portion', minQty: 1, step: 1, maxQty: 50, showUnit: false } as const;

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

/** Money: finite number (decimals allowed, rounded to 2 downstream). */
function isMoney(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Bank-safe rounding to 2 decimals (kills 0.1 + 0.2 style float dust). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function cleanInt(v: unknown, fallback: number): number {
  return isInt(v) ? v : fallback;
}

export interface NormalizedPricing {
  unit: PricingUnit;
  price?: number;
  minQty: number;
  step: number;
  maxQty: number;
  showUnit: boolean;
}

export interface LineSelection {
  variantId?: string;
  addonIds?: string[];
  qty: number;
}

/** Normalize one item's pricing block (legacy numeric `price` converts). Never throws. */
export function normalizePricing(item: Pick<MenuItem, 'pricing'> & { price?: unknown }): NormalizedPricing {
  const raw = (item && typeof item === 'object' ? (item as { pricing?: unknown }).pricing : null) as Record<string, unknown> | null;
  const legacyPrice =
    item && typeof (item as { price?: unknown }).price === 'number' && Number.isFinite((item as { price?: unknown }).price as number)
      ? Math.max(0, round2((item as { price?: number }).price as number))
      : null;
  const base = raw && typeof raw === 'object' ? raw : {};
  const unit: PricingUnit = UNITS.includes(base.unit as PricingUnit) ? (base.unit as PricingUnit) : 'portion';
  let price: number | undefined;
  if (isMoney(base.price) && (base.price as number) >= 0) price = round2(base.price as number);
  else if (legacyPrice !== null) price = legacyPrice;
  const minQtyRaw = cleanInt(base.minQty, 1);
  const minQty = minQtyRaw >= 1 ? minQtyRaw : 1;
  const stepRaw = cleanInt(base.step, 1);
  const step = stepRaw >= 1 ? stepRaw : 1;
  let maxQty = cleanInt(base.maxQty, 50);
  if (maxQty < minQty) maxQty = minQty;
  const showUnit = base.showUnit === true;
  const out: NormalizedPricing = { unit, minQty, step, maxQty, showUnit };
  if (price !== undefined) out.price = price;
  return out;
}

/** Normalize a whole menu document (backward compatible). Never throws for bad input. */
export function normalizeMenu<T>(menu: T): T {
  if (!menu || typeof menu !== 'object' || Array.isArray(menu)) return menu;
  const m = menu as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...m };
  out.schemaVersion =
    Number.isInteger(m.schemaVersion) && (m.schemaVersion as number) >= 2 ? m.schemaVersion : 2;
  // Feature library lives in settings (pure names-in-folders; whether a
  // feature is used as a size or an add-on is decided per item row).
  // Migrated from old shapes when needed. Never throws.
  const settingsFirst = (m.settings && typeof m.settings === 'object'
    ? m.settings
    : {}) as Record<string, unknown>;
  const groups: Record<string, unknown>[] = [];
  const groupById = new Map<string, Record<string, unknown>>();
  const ensureGroup = (id: unknown, name: unknown) => {
    if (typeof id !== 'string' || !id || groupById.has(id)) return (groupById.get(id as string) || null) as Record<string, unknown> | null;
    const nm = name && typeof name === 'object'
      ? {
          en: typeof (name as Record<string, unknown>).en === 'string' ? (name as Record<string, unknown>).en as string : '',
          ar: typeof (name as Record<string, unknown>).ar === 'string' ? (name as Record<string, unknown>).ar as string : '',
        }
      : { en: id, ar: id };
    const g: Record<string, unknown> = { id, name: nm };
    groups.push(g);
    groupById.set(id, g);
    return g;
  };
  for (const g of Array.isArray(settingsFirst.featureGroups) ? (settingsFirst.featureGroups as unknown[]) : []) {
    if (g && typeof g === 'object') {
      const gg = g as Record<string, unknown>;
      ensureGroup(gg.id, gg.name);
    }
  }
  // Default buckets (by id convention) for migrating kind-carrying old data
  const defaultGroupFor = (kind: string) => {
    const id = kind === 'addon' ? 'addons' : 'sizes';
    if (!groupById.has(id)) {
      ensureGroup(id, kind === 'addon' ? { en: 'Add-ons', ar: 'إضافات' } : { en: 'Sizes', ar: 'أحجام' });
    }
    return groupById.get(id);
  };
  const defs: Record<string, unknown>[] = [];
  const defById = new Map<string, Record<string, unknown>>();
  const ensureDef = (id: unknown, name: unknown, groupId?: unknown, fallbackKind?: string) => {
    if (typeof id !== 'string' || !id || defById.has(id)) return;
    const nm = name && typeof name === 'object'
      ? {
          en: typeof (name as Record<string, unknown>).en === 'string' ? (name as Record<string, unknown>).en as string : '',
          ar: typeof (name as Record<string, unknown>).ar === 'string' ? (name as Record<string, unknown>).ar as string : '',
        }
      : { en: id, ar: id };
    const g = (typeof groupId === 'string' && groupById.has(groupId))
      ? groupById.get(groupId)
      : defaultGroupFor(fallbackKind === 'addon' ? 'addon' : 'size');
    const def = { id, groupId: g ? (g.id as string) : 'sizes', name: nm };
    defs.push(def);
    defById.set(id, def);
  };
  for (const d of Array.isArray(settingsFirst.featureDefs) ? (settingsFirst.featureDefs as unknown[]) : []) {
    if (!d || typeof d !== 'object') continue;
    const dd = d as Record<string, unknown>;
    if (typeof dd.id !== 'string' || !dd.id) continue;
    const gid = (typeof dd.groupId === 'string' && groupById.has(dd.groupId)) ? (dd.groupId as string) : null;
    const legacyKind = (dd.kind === 'size' || dd.kind === 'addon') ? (dd.kind as string) : null;
    if (!gid && !legacyKind) {
      // Unplaceable legacy row without any hint — keep it under sizes
      ensureDef(dd.id, dd.name, null, 'size');
      continue;
    }
    if (!gid && legacyKind) {
      // Old kind-carrying feature without a section → default bucket of its kind
      ensureDef(dd.id, dd.name, null, legacyKind);
      continue;
    }
    ensureDef(dd.id, dd.name, gid);
  }
  if (Array.isArray(m.items)) {
    out.items = (m.items as unknown[]).map((item) => {
      if (!item || typeof item !== 'object') return item;
      const pricing = normalizePricing(item as MenuItem);
      const copy = { ...(item as Record<string, unknown>), pricing } as Record<string, unknown>;
      delete copy.price; // single source of truth from here on
      // Old variants {id, name, price} -> {featureId, price} + library def
      if (Array.isArray(copy.variants)) {
        copy.variants = (copy.variants as unknown[])
          .filter((v) => v && typeof v === 'object')
          .map((v) => {
            const vv = v as Record<string, unknown>;
            if (typeof vv.featureId === 'string' && vv.featureId) {
              return { featureId: vv.featureId, price: vv.price };
            }
            if (typeof vv.id === 'string' && vv.id) {
              ensureDef(vv.id, vv.name, (vv as Record<string, unknown>).groupId, 'size');
              return { featureId: vv.id, price: vv.price };
            }
            return null;
          })
          .filter(Boolean);
      }
      // New per-item add-ons pass through (drop malformed rows)
      if (Array.isArray(copy.addons)) {
        copy.addons = (copy.addons as unknown[])
          .filter((a) => a && typeof a === 'object' && typeof (a as Record<string, unknown>).featureId === 'string' && (a as Record<string, unknown>).featureId)
          .map((a) => {
            const aa = a as Record<string, unknown>;
            return { featureId: aa.featureId, price: aa.price };
          });
      }
      // Explicit default survives only when it points at a size
      if (typeof copy.defaultVariant === 'string' && copy.defaultVariant) {
        const okDef = Array.isArray(copy.variants) && (copy.variants as Record<string, unknown>[]).some((v) => v && v.featureId === copy.defaultVariant);
        if (!okDef) delete copy.defaultVariant;
      } else {
        delete copy.defaultVariant;
      }
      return copy;
    });
    // Old category-scoped addonGroups expand into per-item add-ons
    for (const g of Array.isArray((m as Record<string, unknown>).addonGroups) ? ((m as Record<string, unknown>).addonGroups as unknown[]) : []) {
      if (!g || typeof g !== 'object') continue;
      const gg = g as Record<string, unknown>;
      if (typeof gg.id !== 'string' || !gg.id) continue;
      ensureDef(gg.id, gg.name, gg.groupId, 'addon');
      const cats = Array.isArray(gg.categoryIds) ? (gg.categoryIds as unknown[]) : [];
      for (const item of out.items as Record<string, unknown>[]) {
        if (!item || typeof item !== 'object' || !cats.includes(item.categoryId)) continue;
        if (!Array.isArray(item.addons)) item.addons = [];
        const list = item.addons as Record<string, unknown>[];
        if (!list.some((a) => a && a.featureId === gg.id)) {
          list.push({ featureId: gg.id, price: gg.price });
        }
      }
    }
  }
  delete out.addonGroups; // replaced by settings.featureDefs + per-item addons
  const settings = m.settings && typeof m.settings === 'object' ? (m.settings as Record<string, unknown>) : {};
  const ordRaw = settings.ordering && typeof settings.ordering === 'object' ? (settings.ordering as Record<string, unknown>) : {};
  const minOrder = typeof ordRaw.minOrder === 'number' && Number.isFinite(ordRaw.minOrder) ? ordRaw.minOrder : 0;
  const deliveryFee = typeof ordRaw.deliveryFee === 'number' && Number.isFinite(ordRaw.deliveryFee) ? ordRaw.deliveryFee : 0;
  const bRaw = (settings.badges && typeof settings.badges === 'object' ? settings.badges : {}) as Record<string, unknown>;
  const intOr = (v: unknown, fb: number, min: number, max: number) =>
    isInt(v) && (v as number) >= min && (v as number) <= max ? (v as number) : fb;
  out.settings = {
    ...settings,
    ordering: {
      ...ordRaw,
      minOrder,
      deliveryFee,
      minOrderEnabled: typeof ordRaw.minOrderEnabled === 'boolean' ? ordRaw.minOrderEnabled : minOrder > 0,
      deliveryFeeEnabled:
        typeof ordRaw.deliveryFeeEnabled === 'boolean' ? ordRaw.deliveryFeeEnabled : deliveryFee > 0,
    },
    badges: {
      newDays: intOr(bRaw.newDays, 14, 1, 365),
      topDays: intOr(bRaw.topDays, 30, 1, 365),
      topCount: intOr(bRaw.topCount, 6, 1, 50),
    },
    featureDefs: defs,
    featureGroups: groups,
  };
  return out as unknown as T;
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
    if (!isMoney(v.price) || v.price <= 0) throw new Error('unknown_variant');
    return v.price;
  }
  const p = normalizePricing(item);
  if (!isMoney(p.price)) throw new Error('no_price');
  return p.price as number;
}

/** Lowest variant price (for "From X" labels). Throws when unpriced. */
export function minVariantPrice(item: MenuItem): number {
  if (!hasVariants(item)) return unitPrice(item);
  let min = Infinity;
  for (const v of item.variants || []) {
    if (v && isMoney(v.price) && v.price > 0 && v.price < min) min = v.price;
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
  return round2((qty as number) * (unit + addons));
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
  if ((qty as number) < p.minQty || (qty as number) > p.maxQty) return false;
  return ((qty as number) - p.minQty) % p.step === 0;
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

/* ---------- Smart badges ---------- */

export interface TopSellerOptions {
  days?: number;
  count?: number;
  nowMs?: number;
}

export interface RankedItem {
  id: string;
  qty: number;
}

function badgeSettings(menu: MenuData): { newDays: number; topDays: number; topCount: number } {
  const raw = (menu && (menu.settings as { badges?: unknown }).badges && typeof (menu.settings as { badges?: unknown }).badges === 'object'
    ? (menu.settings as unknown as { badges: Record<string, unknown> }).badges
    : {}) as Record<string, unknown>;
  return {
    newDays: isInt(raw.newDays) && (raw.newDays as number) > 0 ? (raw.newDays as number) : 14,
    topDays: isInt(raw.topDays) && (raw.topDays as number) > 0 ? (raw.topDays as number) : 30,
    topCount: isInt(raw.topCount) && (raw.topCount as number) > 0 ? (raw.topCount as number) : 6,
  };
}

/** True while the item is within its NEW window (addedAt + newDays). */
export function isNewItem(menu: MenuData, item: MenuItem, nowMs?: number): boolean {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const { newDays } = badgeSettings(menu);
  if (!item || typeof item.addedAt !== 'string') return false;
  const t = Date.parse(item.addedAt);
  if (!Number.isFinite(t) || t > now) return false;
  return now - t <= newDays * 86400000;
}

/** Stored badges plus the automatic NEW badge (deduped). */
export function effectiveBadges(menu: MenuData, item: MenuItem, nowMs?: number): string[] {
  const set = new Set<string>(Array.isArray(item && item.badges) ? (item.badges as string[]) : []);
  if (isNewItem(menu, item, nowMs)) set.add('new');
  return [...set];
}

/**
 * Rank items by quantity sold in the window (cancelled excluded).
 * Returns [{ id, qty }] sorted by qty desc (ties by id).
 */
export function topSellers(
  orders: { createdAt: string; status: string; items: { id: string; qty: number }[] }[],
  menu: MenuData,
  opts?: TopSellerOptions
): RankedItem[] {
  const o = opts || {};
  const now = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
  const { topDays, topCount } = badgeSettings(menu);
  const days = isInt(o.days) && (o.days as number) > 0 ? (o.days as number) : topDays;
  const count = isInt(o.count) && (o.count as number) > 0 ? (o.count as number) : topCount;
  const start = now - days * 86400000;
  const map = new Map<string, number>();
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || order.status === 'cancelled') continue;
    const t = Date.parse(order.createdAt);
    if (!Number.isFinite(t) || t < start || t > now) continue;
    for (const it of Array.isArray(order.items) ? order.items : []) {
      if (!it || typeof it.id !== 'string' || !isInt(it.qty) || it.qty <= 0) continue;
      map.set(it.id, (map.get(it.id) || 0) + it.qty);
    }
  }
  return [...map.entries()]
    .map(([id, qty]) => ({ id, qty }))
    .sort((a, b) => (b.qty - a.qty) || (a.id < b.id ? -1 : 1))
    .slice(0, count);
}

/** Thousands separators; up to 2 decimals shown only when needed
 *  (10.5 -> "10.5", 80,000 stays "80,000"), unless currency.decimals says so. */
export function formatPrice(n: number, currency?: string | { code?: string; decimals?: number }): string {
  let code = '';
  let decimals = 0;
  if (typeof currency === 'string') code = currency;
  else if (currency && typeof currency === 'object') {
    code = typeof currency.code === 'string' ? currency.code : '';
    decimals = isInt(currency.decimals) && (currency.decimals as number) > 0 ? Math.min(currency.decimals as number, 4) : 0;
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

function arabicCount(qty: number, one: string, two: string, few: string): string {
  if (qty === 1) return one;
  if (qty === 2) return two;
  if (qty >= 3 && qty <= 10) return few;
  return one;
}

/** Localized unit word for a quantity. Unknown units echo back. */
export function unitLabel(unit: string, qty: number, lang: 'en' | 'ar'): string {
  const q = typeof qty === 'number' ? qty : 1;
  if (lang === 'ar') {
    switch (unit) {
      case 'pc': return arabicCount(q, 'قطعة', 'قطعتان', 'قطع');
      case 'portion': return 'حصة';
      case 'dozen': return arabicCount(q, 'دزينة', 'دزينتان', 'دزينات');
      case 'box': return 'علبة';
      case 'bottle': return 'زجاجة';
      case 'glass': return 'كاسة';
      case 'kg': return 'كغ';
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

/** Card price label: "From 80,000 LBP" for variants, unit suffix only when showUnit. */
export function priceLabel(item: MenuItem, lang: 'en' | 'ar', currency: string): string {
  const p = normalizePricing(item);
  if (hasVariants(item)) {
    const from = lang === 'ar' ? 'من' : 'From';
    return `${from} ${formatPrice(minVariantPrice(item), currency)}`;
  }
  if (!isMoney(p.price)) return '—';
  const base = formatPrice(p.price as number, currency);
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
