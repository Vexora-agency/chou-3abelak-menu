/**
 * Shared pricing engine (server copy).
 * MUST stay behavior-identical to src/utils/pricing.ts.
 * Pure functions only — no dependencies, works in Cloudflare Workers and Node.
 */

export const UNITS = ['pc', 'portion', 'dozen', 'box', 'bottle', 'glass', 'kg'];

const DEFAULT_PRICING = { unit: 'portion', minQty: 1, step: 1, maxQty: 50, showUnit: false };

function isInt(n) {
  return typeof n === 'number' && Number.isInteger(n);
}

/** Money: finite number (decimals allowed, rounded to 2 downstream). */
function isMoney(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Bank-safe rounding to 2 decimals (kills 0.1 + 0.2 style float dust). */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function cleanInt(v, fallback) {
  return isInt(v) ? v : fallback;
}

/**
 * Normalize one item's pricing block. Legacy numeric `price` becomes
 * pricing { unit:'portion', price, minQty:1, step:1, maxQty:50, showUnit:false }.
 * Never throws — returns best-effort defaults for garbage input.
 */
export function normalizePricing(item) {
  const raw = item && typeof item === 'object' ? item.pricing : null;
  const legacy = item && typeof item.price === 'number' && Number.isFinite(item.price) ? Math.max(0, round2(item.price)) : null;
  const base = raw && typeof raw === 'object' ? raw : {};
  const unit = UNITS.includes(base.unit) ? base.unit : 'portion';
  let price;
  if (isMoney(base.price) && base.price >= 0) price = round2(base.price);
  else if (legacy !== null) price = legacy;
  const minQty = cleanInt(base.minQty, 1) >= 1 ? cleanInt(base.minQty, 1) : 1;
  const step = cleanInt(base.step, 1) >= 1 ? cleanInt(base.step, 1) : 1;
  let maxQty = cleanInt(base.maxQty, 50);
  if (maxQty < minQty) maxQty = minQty;
  const showUnit = base.showUnit === true;
  const out = { unit, minQty, step, maxQty, showUnit };
  if (price !== undefined) out.price = price;
  return out;
}

/**
 * Normalize a whole menu document (backward compatible):
 * old numeric prices convert, missing ordering flags default from values
 * (minOrder > 0 / deliveryFee > 0 mean enabled), schemaVersion stamped.
 * Old shapes migrate too: inline variant names become featureDefs, and
 * category-scoped addonGroups expand into per-item add-ons.
 * Never throws for bad input — returns the input when it is not an object.
 */
export function normalizeMenu(menu) {
  if (!menu || typeof menu !== 'object' || Array.isArray(menu)) return menu;
  const out = { ...menu };
  out.schemaVersion = Number.isInteger(menu.schemaVersion) && menu.schemaVersion >= 2 ? menu.schemaVersion : 2;

  // Feature library lives in settings (pure names-in-folders; whether a
  // feature is used as a size or an add-on is decided per item row).
  // Migrated from old shapes when needed. Never throws.
  const settingsFirst = menu.settings && typeof menu.settings === 'object' ? menu.settings : {};
  const groups = [];
  const groupById = new Map();
  const ensureGroup = (id, name) => {
    if (typeof id !== 'string' || !id || groupById.has(id)) return groupById.get(id) || null;
    const nm = name && typeof name === 'object'
      ? { en: typeof name.en === 'string' ? name.en : '', ar: typeof name.ar === 'string' ? name.ar : '' }
      : { en: id, ar: id };
    const g = { id, name: nm };
    groups.push(g);
    groupById.set(id, g);
    return g;
  };
  for (const g of Array.isArray(settingsFirst.featureGroups) ? settingsFirst.featureGroups : []) {
    if (g && typeof g === 'object') ensureGroup(g.id, g.name);
  }
  const defaultGroupFor = (kind) => {
    const id = kind === 'addon' ? 'addons' : 'sizes';
    if (!groupById.has(id)) {
      ensureGroup(id, kind === 'addon' ? { en: 'Add-ons', ar: 'إضافات' } : { en: 'Sizes', ar: 'أحجام' });
    }
    return groupById.get(id);
  };
  const defs = [];
  const defById = new Map();
  const ensureDef = (id, name, groupId, fallbackKind) => {
    if (typeof id !== 'string' || !id || defById.has(id)) return;
    const nm = name && typeof name === 'object'
      ? { en: typeof name.en === 'string' ? name.en : '', ar: typeof name.ar === 'string' ? name.ar : '' }
      : { en: id, ar: id };
    const g = (typeof groupId === 'string' && groupById.has(groupId))
      ? groupById.get(groupId)
      : defaultGroupFor(fallbackKind === 'addon' ? 'addon' : 'size');
    const def = { id, groupId: g ? g.id : 'sizes', name: nm };
    defs.push(def);
    defById.set(id, def);
  };
  for (const d of Array.isArray(settingsFirst.featureDefs) ? settingsFirst.featureDefs : []) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !d.id) continue;
    const gid = (typeof d.groupId === 'string' && groupById.has(d.groupId)) ? d.groupId : null;
    const legacyKind = (d.kind === 'size' || d.kind === 'addon') ? d.kind : null;
    if (!gid && !legacyKind) {
      // Unplaceable legacy row without any hint — keep it under sizes
      ensureDef(d.id, d.name, null, 'size');
      continue;
    }
    if (!gid && legacyKind) {
      // Old kind-carrying feature without a section → default bucket of its kind
      ensureDef(d.id, d.name, null, legacyKind);
      continue;
    }
    ensureDef(d.id, d.name, gid);
  }

  if (Array.isArray(menu.items)) {
    out.items = menu.items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const pricing = normalizePricing(item);
      const copy = { ...item, pricing };
      delete copy.price; // single source of truth from here on
      // Old variants {id, name, price} -> {featureId, price} + library def
      if (Array.isArray(copy.variants)) {
        copy.variants = copy.variants
          .filter((v) => v && typeof v === 'object')
          .map((v) => {
            if (typeof v.featureId === 'string' && v.featureId) return { featureId: v.featureId, price: v.price };
            if (typeof v.id === 'string' && v.id) {
              ensureDef(v.id, v.name, v.groupId, 'size');
              return { featureId: v.id, price: v.price };
            }
            return null;
          })
          .filter(Boolean);
      }
      // New per-item add-ons pass through (drop malformed rows)
      if (Array.isArray(copy.addons)) {
        copy.addons = copy.addons
          .filter((a) => a && typeof a === 'object' && typeof a.featureId === 'string' && a.featureId)
          .map((a) => ({ featureId: a.featureId, price: a.price }));
      }
      // Explicit default survives only when it points at a size
      if (typeof copy.defaultVariant === 'string' && copy.defaultVariant) {
        const okDef = Array.isArray(copy.variants) && copy.variants.some((v) => v && v.featureId === copy.defaultVariant);
        if (!okDef) delete copy.defaultVariant;
      } else {
        delete copy.defaultVariant;
      }
      return copy;
    });
    // Old category-scoped addonGroups expand into per-item add-ons
    for (const g of Array.isArray(menu.addonGroups) ? menu.addonGroups : []) {
      if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !g.id) continue;
      ensureDef(g.id, g.name, g.groupId, 'addon');
      const cats = Array.isArray(g.categoryIds) ? g.categoryIds : [];
      for (const item of out.items) {
        if (!item || typeof item !== 'object' || !cats.includes(item.categoryId)) continue;
        if (!Array.isArray(item.addons)) item.addons = [];
        if (!item.addons.some((a) => a && a.featureId === g.id)) {
          item.addons.push({ featureId: g.id, price: g.price });
        }
      }
    }
  }
  delete out.addonGroups; // replaced by settings.featureDefs + per-item addons
  const settings = menu.settings && typeof menu.settings === 'object' ? menu.settings : {};
  const ord = settings.ordering && typeof settings.ordering === 'object' ? settings.ordering : {};
  const minOrder = typeof ord.minOrder === 'number' && Number.isFinite(ord.minOrder) ? ord.minOrder : 0;
  const deliveryFee = typeof ord.deliveryFee === 'number' && Number.isFinite(ord.deliveryFee) ? ord.deliveryFee : 0;
  const bRaw = settings.badges && typeof settings.badges === 'object' ? settings.badges : {};
  const intOr = (v, fb, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : fb);
  out.settings = {
    ...settings,
    ordering: {
      ...ord,
      minOrder,
      deliveryFee,
      minOrderEnabled: typeof ord.minOrderEnabled === 'boolean' ? ord.minOrderEnabled : minOrder > 0,
      deliveryFeeEnabled: typeof ord.deliveryFeeEnabled === 'boolean' ? ord.deliveryFeeEnabled : deliveryFee > 0,
    },
    badges: {
      newDays: intOr(bRaw.newDays, 14, 1, 365),
      topDays: intOr(bRaw.topDays, 30, 1, 365),
      topCount: intOr(bRaw.topCount, 6, 1, 50),
    },
    featureDefs: defs,
    featureGroups: groups,
  };
  return out;
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
    if (!isMoney(v.price) || v.price <= 0) throw new Error('unknown_variant');
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
    if (v && isMoney(v.price) && v.price > 0 && v.price < min) min = v.price;
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

/* ---------- Smart badges ---------- */

function badgeSettings(menu) {
  const raw = menu && menu.settings && typeof menu.settings.badges === 'object' ? menu.settings.badges : {};
  return {
    newDays: isInt(raw.newDays) && raw.newDays > 0 ? raw.newDays : 14,
    topDays: isInt(raw.topDays) && raw.topDays > 0 ? raw.topDays : 30,
    topCount: isInt(raw.topCount) && raw.topCount > 0 ? raw.topCount : 6,
  };
}

/** True while the item is within its NEW window (addedAt + newDays). */
export function isNewItem(menu, item, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const { newDays } = badgeSettings(menu);
  if (!item || typeof item.addedAt !== 'string') return false;
  const t = Date.parse(item.addedAt);
  if (!Number.isFinite(t) || t > now) return false;
  return now - t <= newDays * 86400000;
}

/** Stored badges plus the automatic NEW badge (deduped). */
export function effectiveBadges(menu, item, nowMs) {
  const set = new Set(Array.isArray(item && item.badges) ? item.badges : []);
  if (isNewItem(menu, item, nowMs)) set.add('new');
  return [...set];
}

/**
 * Rank items by quantity sold in the window (cancelled excluded).
 * orders: [{ createdAt, status, items: [{ id, qty }] }].
 * Returns [{ id, qty }] sorted by qty desc (ties by id).
 */
export function topSellers(orders, menu, opts) {
  const o = opts || {};
  const now = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
  const { topDays, topCount } = badgeSettings(menu);
  const days = isInt(o.days) && o.days > 0 ? o.days : topDays;
  const count = isInt(o.count) && o.count > 0 ? o.count : topCount;
  const start = now - days * 86400000;
  const map = new Map();
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
