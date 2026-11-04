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

/** Lowest variant price (shown bare on cards, no "From" prefix). Throws when unpriced. */
export function minVariantPrice(item) {
  if (!hasVariants(item)) return unitPrice(item);
  let min = Infinity;
  for (const v of item.variants) {
    if (v && isMoney(v.price) && v.price >= 0 && v.price < min) min = v.price;
  }
  if (!Number.isFinite(min)) throw new Error('no_price');
  return min;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Group id for a feature (null when the library has no such feature). */
function featureGroupId(menu, featureId) {
  try {
    const s = menu && menu.settings && typeof menu.settings === 'object' ? menu.settings : {};
    const defs = Array.isArray(s.featureDefs) ? s.featureDefs : [];
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
function groupSelection(menu, groupId) {
  if (groupId === 'sizes') return 'multi';
  // The locked spicy section is exactly one choice (mild/medium/extra-hot),
  // even if an old document stored another mode.
  if (groupId === 'spicy') return 'single';
  try {
    const s = menu && menu.settings && typeof menu.settings === 'object' ? menu.settings : {};
    const groups = Array.isArray(s.featureGroups) ? s.featureGroups : [];
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
export function validatePicks(menu, item, addonIds, addonQty, qty) {
  function idsOf(v) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new Error('invalid_addon');
    return v;
  }
  const list = idsOf(addonIds);
  const seen = new Set();
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
  const qInt = isInt(qty) ? qty : null;
  // Explicit counts must always be ints >= 0 (upper bound needs a valid qty).
  for (const id of list) {
    if (!Object.prototype.hasOwnProperty.call(addonQty, id)) continue;
    const c = addonQty[id];
    if (!isInt(c) || c < 0) throw new Error('invalid_addon');
    if (qInt !== null && c > qInt) throw new Error('invalid_addon');
  }
  if (qInt === null) return;
  // Resolved counts (missing = applies to all units) + group rules.
  const resolved = new Map();
  for (const id of list) {
    const c = Object.prototype.hasOwnProperty.call(addonQty, id) ? addonQty[id] : qInt;
    if (!isInt(c) || c < 0 || c > qInt) throw new Error('invalid_addon');
    resolved.set(id, c);
  }
  const byGroup = new Map();
  for (const [fid, c] of resolved) {
    const gid = featureGroupId(menu, fid);
    const sel = groupSelection(menu, gid);
    if (sel === 'multi') {
      if (c !== 0 && c !== qInt) throw new Error('invalid_addon');
    }
    if (!byGroup.has(gid)) byGroup.set(gid, { sel, sum: 0 });
    const g = byGroup.get(gid);
    // A group mixing rules cannot happen (one gid → one sel), keep first.
    g.sum += c;
  }
  for (const [, g] of byGroup) {
    if (g.sel === 'single' && g.sum > qInt) throw new Error('invalid_addon');
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
export function addonSum(item, addonIds, addonQty, qty) {
  const ids = Array.isArray(addonIds) ? addonIds : [];
  const seen = new Set();
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
      sum += found.price;
    }
    return sum;
  }
  if (!isPlainObject(addonQty)) throw new Error('invalid_addon');
  for (const k of Object.keys(addonQty)) {
    if (!seen.has(k)) throw new Error('invalid_addon');
  }
  const qInt = isInt(qty) ? qty : null;
  let total = 0;
  for (const id of ids) {
    const has = Object.prototype.hasOwnProperty.call(addonQty, id);
    if (!has && qInt === null) continue; // qty check reports invalid_qty downstream
    const c = has ? addonQty[id] : qInt;
    if (!isInt(c) || c < 0 || (qInt !== null && c > qInt)) throw new Error('invalid_addon');
    const found = enabled.find((a) => a && a.featureId === id);
    total += found.price * c;
  }
  return total;
}

/**
 * Full line total. Legacy (no addonQty): qty * (unit + per-unit add-ons),
 * byte-identical to today. Split: qty * unit + Σ price_o × count_o.
 * Throws 'invalid_addon' / 'invalid_qty' (unknown variant via unitPrice).
 */
export function lineTotal(item, sel) {
  const { variantId, addonIds, addonQty, qty } = sel || {};
  const unit = unitPrice(item, variantId);
  const addons = addonSum(item, addonIds, addonQty, qty);
  const q = cleanInt(qty, NaN);
  if (!isInt(q)) throw new Error('invalid_qty');
  if (addonQty === undefined || addonQty === null) {
    return round2(q * (unit + addons));
  }
  return round2(q * unit + addons);
}

/**
 * Per-unit price including add-ons. Legacy (no addonQty): unit + per-unit
 * add-ons, exactly as today. Split: unit + totalAddons / qty (average).
 * Split requires an integer qty > 0, else throws 'invalid_qty'.
 */
export function perUnitPrice(item, sel) {
  const { variantId, addonIds, addonQty, qty } = sel || {};
  const unit = unitPrice(item, variantId);
  if (addonQty === undefined || addonQty === null) {
    return round2(unit + addonSum(item, addonIds));
  }
  const q = cleanInt(qty, NaN);
  if (!isInt(q) || q <= 0) throw new Error('invalid_qty');
  return round2(unit + addonSum(item, addonIds, addonQty, qty) / q);
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

/**
 * Deterministic cart-line key.
 * Legacy (no addonQty): `id|variantId|sortedIds`, byte-identical to today.
 * Split (addonQty object): `id|variantId|sorted(fid:count)` using ONLY
 * nonzero counts; missing counts default to `qty` (pass qty when keys must
 * distinguish defaulted options). Zero counts are dropped. Never throws.
 */
export function cartLineKey(id, variantId, addonIds, addonQty, qty) {
  if (addonQty === undefined || addonQty === null) {
    const ids = Array.isArray(addonIds) ? [...addonIds].sort() : [];
    return `${id}|${variantId || ''}|${ids.join(',')}`;
  }
  if (!isPlainObject(addonQty)) {
    const ids = Array.isArray(addonIds) ? [...addonIds].sort() : [];
    return `${id}|${variantId || ''}|${ids.join(',')}`;
  }
  const qInt = isInt(qty) ? qty : null;
  const counts = new Map();
  const ids = Array.isArray(addonIds) ? addonIds : [];
  for (const fid of ids) {
    if (typeof fid !== 'string') continue;
    const has = Object.prototype.hasOwnProperty.call(addonQty, fid);
    const c = has ? addonQty[fid] : qInt;
    if (!isInt(c) || c === 0) continue;
    counts.set(fid, c);
  }
  for (const k of Object.keys(addonQty)) {
    if (counts.has(k)) continue;
    const c = addonQty[k];
    if (typeof k !== 'string' || !isInt(c) || c === 0) continue;
    counts.set(k, c);
  }
  const pairs = [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([fid, c]) => `${fid}:${c}`);
  return `${id}|${variantId || ''}|${pairs.join(',')}`;
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

// Mirror of the client's arabicCount — same grammar, same strings.
// 1 = singular, 2 = dual (oblique), 3-10 = plural, 11+ = singular
// (tamyiiz). Keep the two in sync.
function arabicCount(qty, one, two, few) {
  if (qty === 1) return one;
  if (qty === 2) return two;
  if (qty >= 3 && qty <= 10) return few;
  return one; // 11+ → singular, intentional
}

/** Localized unit word for a quantity. Unknown units echo back. */
export function unitLabel(unit, qty, lang) {
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
