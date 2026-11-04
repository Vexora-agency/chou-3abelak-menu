/**
 * Menu-normalization domain (server copy, split from pricing.js).
 * MUST stay behavior-identical to src/utils/pricing.ts normalize paths.
 * Pure functions only — no dependencies, works in Cloudflare Workers and Node.
 * Re-exported from ./pricing.js so existing importers keep working.
 */

export const UNITS = ['pc', 'portion', 'dozen', 'box', 'bottle', 'glass', 'kg'];

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

/** Control characters (would break CSV/WhatsApp lines) — a custom label containing any falls back. */
function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 31 || c === 127) return true;
  }
  return false;
}

export function normalizePricing(item) {
  const raw = item && typeof item === 'object' ? item.pricing : null;
  const legacy = item && typeof item.price === 'number' && Number.isFinite(item.price) ? Math.max(0, round2(item.price)) : null;
  const base = raw && typeof raw === 'object' ? raw : {};
  // Mirror of the client copy: known units pass; a short custom label is
  // kept as-is; anything else falls back to 'portion'.
  const rawUnit = typeof base.unit === 'string' ? base.unit.trim() : '';
  const unit = UNITS.includes(rawUnit)
    ? rawUnit
    : rawUnit && rawUnit.length <= 24 && !hasControlChars(rawUnit)
      ? rawUnit
      : 'portion';
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
  const ensureGroup = (id, name, selection, prompt, hasPrompt) => {
    if (typeof id !== 'string' || !id || groupById.has(id)) return groupById.get(id) || null;
    const nm = name && typeof name === 'object'
      ? { en: typeof name.en === 'string' ? name.en : '', ar: typeof name.ar === 'string' ? name.ar : '' }
      : { en: id, ar: id };
    const g = { id, name: nm };
    // Selection preserved when valid, else defaulted to 'multi' (same as
    // validation). The sizes section ignores it at order time.
    g.selection = selection === 'single' || selection === 'multi' ? selection : 'multi';
    // Prompt preserved when the input carries an object (cleaned to {en,ar});
    // absent stays absent (absent/empty = legacy rendering).
    if (hasPrompt && prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
      g.prompt = {
        en: typeof prompt.en === 'string' ? prompt.en : '',
        ar: typeof prompt.ar === 'string' ? prompt.ar : '',
      };
    }
    groups.push(g);
    groupById.set(id, g);
    return g;
  };
  for (const g of Array.isArray(settingsFirst.featureGroups) ? settingsFirst.featureGroups : []) {
    if (g && typeof g === 'object') {
      const hasPrompt = Object.prototype.hasOwnProperty.call(g, 'prompt');
      ensureGroup(g.id, g.name, g.selection, g.prompt, hasPrompt);
    }
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
      // New per-item add-ons pass through (drop malformed rows).
      // The pre-selected flag survives: dropping `default` here wiped the
      // star on every reload (and the next save made it permanent).
      if (Array.isArray(copy.addons)) {
        copy.addons = copy.addons
          .filter((a) => a && typeof a === 'object' && typeof a.featureId === 'string' && a.featureId)
          .map((a) => (a.default === true
            ? { featureId: a.featureId, price: a.price, default: true }
            : { featureId: a.featureId, price: a.price }));
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
  // Protected built-ins always exist (additive only — an existing def keeps
  // its admin-edited name): item add-ons, the cart and Telegram all key off
  // the stable 'spicy' id, so a document missing it would silently break them.
  // Runs AFTER legacy expansion so group order stays untouched.
  ensureDef('spicy', { en: 'Spicy', ar: 'حار' }, 'addons', 'addon');
  delete out.addonGroups; // replaced by settings.featureDefs + per-item addons
  const settings = menu.settings && typeof menu.settings === 'object' ? menu.settings : {};
  const ord = settings.ordering && typeof settings.ordering === 'object' ? settings.ordering : {};
  const minOrder = typeof ord.minOrder === 'number' && Number.isFinite(ord.minOrder) ? ord.minOrder : 0;
  const deliveryFee = typeof ord.deliveryFee === 'number' && Number.isFinite(ord.deliveryFee) ? ord.deliveryFee : 0;
  const etaMinutesOr = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 180 ? Math.round(v) : fb);
  const receiveDelayOr = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 720 ? Math.round(v) : fb);
  const prepMinutes = etaMinutesOr(ord.prepMinutes, 15);
  const kitchenMinutesPerOrder = etaMinutesOr(ord.kitchenMinutesPerOrder, 3);
  const courierSpeedKmh = (typeof ord.courierSpeedKmh === 'number' && Number.isFinite(ord.courierSpeedKmh) && ord.courierSpeedKmh >= 5 && ord.courierSpeedKmh <= 120) ? ord.courierSpeedKmh : 25;
  const roadFactor = (typeof ord.roadFactor === 'number' && Number.isFinite(ord.roadFactor) && ord.roadFactor >= 1 && ord.roadFactor <= 2) ? Math.round((ord.roadFactor + Number.EPSILON) * 100) / 100 : 1.35;
  const defaultDeliveryMinutes = etaMinutesOr(ord.defaultDeliveryMinutes, 20);
  const receiveDelayDeliveryMin = receiveDelayOr(ord.receiveDelayDeliveryMin, 30);
  const receiveDelayPickupMin = receiveDelayOr(ord.receiveDelayPickupMin, 15);
  const bRaw = settings.badges && typeof settings.badges === 'object' ? settings.badges : {};
  const intOr = (v, fb, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : fb);
  // Customer email notifications mirror (validate-settings.js): never throws,
  // invalid replyTo falls back to '' (validation surfaces the error).
  const notifRaw = settings.notifications && typeof settings.notifications === 'object' && !Array.isArray(settings.notifications)
    ? settings.notifications
    : {};
  const notifSender = typeof notifRaw.senderName === 'string' ? notifRaw.senderName.trim().slice(0, 80) : '';
  let notifReply = typeof notifRaw.replyTo === 'string' ? notifRaw.replyTo.trim().toLowerCase().slice(0, 254) : '';
  if (notifReply && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(notifReply)) notifReply = '';
  const notifEv = notifRaw.events && typeof notifRaw.events === 'object' && !Array.isArray(notifRaw.events) ? notifRaw.events : {};
  const boolOrTrue = (v) => (typeof v === 'boolean' ? v : true);
  out.settings = {
    ...settings,
    ordering: {
      ...ord,
      minOrder,
      deliveryFee,
      minOrderEnabled: typeof ord.minOrderEnabled === 'boolean' ? ord.minOrderEnabled : minOrder > 0,
      deliveryFeeEnabled: typeof ord.deliveryFeeEnabled === 'boolean' ? ord.deliveryFeeEnabled : deliveryFee > 0,
      prepMinutes,
      kitchenMinutesPerOrder,
      courierSpeedKmh,
      roadFactor,
      defaultDeliveryMinutes,
      receiveDelayDeliveryMin,
      receiveDelayPickupMin,
    },
    badges: {
      newDays: intOr(bRaw.newDays, 14, 1, 365),
      topDays: intOr(bRaw.topDays, 30, 1, 365),
      topCount: intOr(bRaw.topCount, 6, 1, 50),
    },
    notifications: {
      senderName: notifSender,
      replyTo: notifReply,
      events: {
        placed: boolOrTrue(notifEv.placed),
        confirmed: boolOrTrue(notifEv.confirmed),
        completed: boolOrTrue(notifEv.completed),
        cancelled: boolOrTrue(notifEv.cancelled),
        receipt_check: boolOrTrue(notifEv.receipt_check),
      },
    },
    featureDefs: defs,
    featureGroups: groups,
  };
  return out;
}
