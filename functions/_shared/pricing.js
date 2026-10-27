/**
 * Shared pricing engine (server copy).
 * MUST stay behavior-identical to src/utils/pricing.ts.
 * Pure functions only — no dependencies, works in Cloudflare Workers and Node.
 * Split: menu normalization lives in ./pricing-menu.js, smart badges in
 * ./pricing-badges.js. This file re-exports them so existing importers keep
 * working with identical export names.
 */

import { normalizePricing, round2 } from './pricing-menu.js';

export { UNITS, normalizeMenu, normalizePricing, round2 } from './pricing-menu.js';
export { effectiveBadges, isNewItem, topSellers } from './pricing-badges.js';

function isInt(n) {
  return typeof n === 'number' && Number.isInteger(n);
}

/** Money: finite number (decimals allowed, rounded to 2 downstream). */
function isMoney(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function cleanInt(v, fallback) {
  return isInt(v) ? v : fallback;
}

/** Find a variant by its feature id (explicit default, else first). Never reorders. */
export function getVariant(item, variantId) {
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

export function hasVariants(item) {
  return !!(item && Array.isArray(item.variants) && item.variants.length > 0);
}

/** Feature library lookup (null when missing). */
export function featureDef(menu, featureId) {
  const s = menu && menu.settings && typeof menu.settings === 'object' ? menu.settings : {};
  const defs = Array.isArray(s.featureDefs) ? s.featureDefs : [];
  return defs.find((d) => d && d.id === featureId) || null;
}

/**
 * Library grouped for display: [{ group: {id, name}, features: [...] }]
 * in group order. Features with an unknown group go to a trailing bucket.
 */
export function featuresByGroup(menu) {
  const s = menu && menu.settings && typeof menu.settings === 'object' ? menu.settings : {};
  const allGroups = Array.isArray(s.featureGroups) ? s.featureGroups.filter((g) => g && typeof g.id === 'string') : [];
  const defs = Array.isArray(s.featureDefs) ? s.featureDefs.filter((d) => d && typeof d.id === 'string') : [];
  const out = allGroups.map((g) => ({ group: g, features: defs.filter((d) => d.groupId === g.id) }));
  const rest = defs.filter((d) => !allGroups.some((g) => g.id === d.groupId));
  if (rest.length) out.push({ group: { id: '', name: { en: 'Other', ar: 'أخرى' } }, features: rest });
  return out;
}

/** Display name of a feature in one language (falls back to the id). */export function featureName(menu, featureId, lang) {
  const d = featureDef(menu, featureId);
  if (!d || !d.name || typeof d.name !== 'object') return typeof featureId === 'string' ? featureId : '';
  const primary = lang === 'ar' ? d.name.ar : d.name.en;
  if (typeof primary === 'string' && primary.trim()) return primary;
  const other = lang === 'ar' ? d.name.en : d.name.ar;
  return typeof other === 'string' && other ? other : String(featureId || '');
}

/** Add-ons enabled on this very item. */
export function itemAddons(item) {
  return item && Array.isArray(item.addons) ? item.addons : [];
}

export function hasOptions(item) {
  return hasVariants(item) || itemAddons(item).length > 0;
}

/**
 * Per-unit base price: the variant price (default = first variant) when the
 * item has variants, otherwise pricing.price. Throws on unknown variant or
 * when no price exists at all.
 */
export function unitPrice(item, variantId) {
  if (hasVariants(item)) {
    const v = getVariant(item, variantId);
    if (!v) throw new Error('unknown_variant');
    if (!isMoney(v.price) || v.price < 0) throw new Error('unknown_variant');
    return v.price;
  }
  const p = item && item.pricing ? normalizePricing(item) : normalizePricing(item);
  if (!isMoney(p.price)) throw new Error('no_price');
  return p.price;
}

/** Lowest variant price (for "From X" labels). Throws when unpriced. */
export function minVariantPrice(item) {
  if (!hasVariants(item)) return unitPrice(item);
  let min = Infinity;
  for (const v of item.variants) {
    if (v && isMoney(v.price) && v.price >= 0 && v.price < min) min = v.price;
  }
  if (!Number.isFinite(min)) throw new Error('no_price');
  return min;
}

/**
 * Full line total: qty * (unitPrice + enabled add-on prices).
 * Every add-on must be enabled on the item itself. Throws 'invalid_addon'
 * otherwise (unknown variant throws via unitPrice).
 */
export function lineTotal(item, sel) {
  const { variantId, addonIds, qty } = sel || {};
  const unit = unitPrice(item, variantId);
  const addons = addonSum(item, addonIds);
  const q = cleanInt(qty, NaN);
  if (!isInt(q)) throw new Error('invalid_qty');
  return round2(q * (unit + addons));
}

/** Per-unit price including enabled add-ons. */
export function perUnitPrice(item, sel) {
  const { variantId, addonIds } = sel || {};
  return round2(unitPrice(item, variantId) + addonSum(item, addonIds));
}

function addonSum(item, addonIds) {
  let sum = 0;
  const ids = Array.isArray(addonIds) ? addonIds : [];
  const seen = new Set();
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
export function isValidQty(item, qty) {
  if (!isInt(qty)) return false;
  const p = normalizePricing(item);
  if (qty < p.minQty || qty > p.maxQty) return false;
  return (qty - p.minQty) % p.step === 0;
}

/** Snap a quantity to the nearest valid value on the item's grid. */
export function clampQty(item, qty) {
  const p = normalizePricing(item);
  let q = Math.round(Number(qty));
  if (!Number.isFinite(q)) q = p.minQty;
  q = Math.max(p.minQty, Math.min(p.maxQty, q));
  const steps = Math.round((q - p.minQty) / p.step);
  return p.minQty + steps * p.step;
}

/** Deterministic cart-line key: id + variantId + sorted addonIds. */
export function cartLineKey(id, variantId, addonIds) {
  const ids = Array.isArray(addonIds) ? [...addonIds].sort() : [];
  return `${id}|${variantId || ''}|${ids.join(',')}`;
}

/**
 * Thousands separators; up to 2 decimals shown only when needed
 * (10.5 -> "10.5", 80,000 stays "80,000"), unless currency.decimals says so.
 * currency may be a plain code string ('LBP') or { code, decimals }.
 */
export function formatPrice(n, currency) {
  let code = '';
  let decimals = 0;
  if (typeof currency === 'string') code = currency;
  else if (currency && typeof currency === 'object') {
    code = typeof currency.code === 'string' ? currency.code : '';
    decimals = isInt(currency.decimals) && currency.decimals > 0 ? Math.min(currency.decimals, 4) : 0;
  }
  let v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  let formatted;
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

function arabicCount(qty, one, two, few) {
  if (qty === 1) return one;
  if (qty === 2) return two;
  if (qty >= 3 && qty <= 10) return few;
  return one;
}

/** Localized unit word for a quantity. Unknown units echo back. */
export function unitLabel(unit, qty, lang) {
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
