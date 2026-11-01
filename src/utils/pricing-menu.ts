/**
 * Menu-normalization domain (client copy, split from pricing.ts).
 * MUST stay behavior-identical to functions/_shared/pricing.js normalize paths.
 * Pure functions only — settings defaults are the single source of truth.
 * Re-exported from ./pricing.ts so existing importers keep working.
 */
import type { MenuItem, PricingUnit } from '@/src/types/menu';
import {
  autoplayIntervalOrDefault,
  bilingualBlock,
  clockTimeOrDefault,
  isoDateOrNull,
  socialFlagsOrDefault,
  socialOrderOrDefault,
  soundsOrDefault,
  statusModeOrDefault,
  tickerSpeedOrDefault,
  timezoneOrDefault,
  workingDaysOrAll,
} from '@/src/utils/settingsDefaults';

export const UNITS: PricingUnit[] = ['pc', 'portion', 'dozen', 'box', 'bottle', 'glass', 'kg'];

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
  /** Known unit or a custom label (max 24 chars) — anything else falls back to 'portion'. */
  unit: string;
  price?: number;
  minQty: number;
  step: number;
  maxQty: number;
  showUnit: boolean;
}

/** Control characters (would break CSV/message lines) — a custom label containing any falls back. */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 31 || c === 127) return true;
  }
  return false;
}

/** Normalize one item's pricing block (legacy numeric `price` converts). Never throws. */
export function normalizePricing(item: Pick<MenuItem, 'pricing'> & { price?: unknown }): NormalizedPricing {
  const raw = (item && typeof item === 'object' ? (item as { pricing?: unknown }).pricing : null) as Record<string, unknown> | null;
  const legacyPrice =
    item && typeof (item as { price?: unknown }).price === 'number' && Number.isFinite((item as { price?: unknown }).price)
      ? Math.max(0, round2((item as { price?: number }).price as number))
      : null;
  const base = raw && typeof raw === 'object' ? raw : {};
  // Known units pass through; a short custom label is kept as-is (shown
  // verbatim by unitLabel); anything else falls back to 'portion'.
  const rawUnit = typeof base.unit === 'string' ? base.unit.trim() : '';
  const unit: string = UNITS.includes(rawUnit as PricingUnit)
    ? rawUnit
    : rawUnit && rawUnit.length <= 24 && !hasControlChars(rawUnit)
      ? rawUnit
      : 'portion';
  let price: number | undefined;
  if (isMoney(base.price) && (base.price) >= 0) price = round2(base.price);
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
    if (typeof id !== 'string' || !id || groupById.has(id)) return (groupById.get(id as string) || null);
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
    const gid = (typeof dd.groupId === 'string' && groupById.has(dd.groupId)) ? (dd.groupId) : null;
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
              ensureDef(vv.id, vv.name, (vv).groupId, 'size');
              return { featureId: vv.id, price: vv.price };
            }
            return null;
          })
          .filter(Boolean);
      }
      // New per-item add-ons pass through (drop malformed rows).
      // The pre-selected flag survives: dropping `default` here wiped the
      // ★ on every reload (and the next save made it permanent).
      if (Array.isArray(copy.addons)) {
        copy.addons = (copy.addons as unknown[])
          .filter((a) => a && typeof a === 'object' && typeof (a as Record<string, unknown>).featureId === 'string' && (a as Record<string, unknown>).featureId)
          .map((a) => {
            const aa = a as Record<string, unknown>;
            return aa.default === true
              ? { featureId: aa.featureId, price: aa.price, default: true }
              : { featureId: aa.featureId, price: aa.price };
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
    for (const g of Array.isArray((m).addonGroups) ? ((m).addonGroups as unknown[]) : []) {
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
    isInt(v) && (v) >= min && (v) <= max ? (v) : fb;
  const socialRaw = (settings.social && typeof settings.social === 'object' ? settings.social : {}) as Record<string, unknown>;
  const annRaw = (settings.announcement && typeof settings.announcement === 'object' ? settings.announcement : {}) as Record<string, unknown>;
  const annTextRaw = (annRaw.text && typeof annRaw.text === 'object' ? annRaw.text : {}) as Record<string, unknown>;
  const privRaw = (settings.privacy && typeof settings.privacy === 'object' ? settings.privacy : {}) as Record<string, unknown>;
  const privExtraRaw = (privRaw.extra && typeof privRaw.extra === 'object' ? privRaw.extra : {}) as Record<string, unknown>;
  const ordNoteRaw = (ordRaw.note && typeof ordRaw.note === 'object' ? ordRaw.note : {}) as Record<string, unknown>;
  const ordPausedMsgRaw = (ordRaw.pausedMessage && typeof ordRaw.pausedMessage === 'object' ? ordRaw.pausedMessage : {}) as Record<string, unknown>;
  const validTypes = ['delivery', 'pickup', 'dinein'];
  const ordTypes = Array.isArray(ordRaw.types)
    ? (ordRaw.types as unknown[]).filter((t) => validTypes.includes(t as string))
    : ['delivery', 'pickup', 'dinein'];
  out.settings = {
    ...settings,
    statusMode: statusModeOrDefault(settings.statusMode),
    openTime: clockTimeOrDefault(settings.openTime, '12:00'),
    closeTime: clockTimeOrDefault(settings.closeTime, '00:00'),
    workingDays: workingDaysOrAll(settings.workingDays),
    timezone: timezoneOrDefault(settings.timezone),
    social: {
      ...(typeof socialRaw.instagram === 'string' && socialRaw.instagram ? { instagram: socialRaw.instagram } : {}),
      ...(typeof socialRaw.facebook === 'string' && socialRaw.facebook ? { facebook: socialRaw.facebook } : {}),
    },
    socialEnabled: socialFlagsOrDefault(settings.socialEnabled),
    socialOrder: socialOrderOrDefault((settings as { socialOrder?: unknown }).socialOrder),
    about: bilingualBlock(settings.about, 300),
    currency: (settings.currency as Record<string, unknown> | undefined)?.en ? settings.currency : { en: 'LBP', ar: 'ل.ل' },
    defaultTheme: settings.defaultTheme === 'light' ? 'light' : 'dark',
    defaultLang: settings.defaultLang === 'ar' ? 'ar' : 'en',
    featuredAutoplay: settings.featuredAutoplay !== undefined ? Boolean(settings.featuredAutoplay) : true,
    featuredAutoplayInterval: autoplayIntervalOrDefault(settings.featuredAutoplayInterval),
    sounds: soundsOrDefault((settings as Record<string, unknown>).sounds),
    ordering: {
      ...ordRaw,
      enabled: Boolean(ordRaw.enabled),
      types: ordTypes.length ? ordTypes : ['delivery', 'pickup', 'dinein'],
      minOrder,
      deliveryFee,
      minOrderEnabled: typeof ordRaw.minOrderEnabled === 'boolean' ? ordRaw.minOrderEnabled : minOrder > 0,
      deliveryFeeEnabled:
        typeof ordRaw.deliveryFeeEnabled === 'boolean' ? ordRaw.deliveryFeeEnabled : deliveryFee > 0,
      note: bilingualBlock(Object.keys(ordNoteRaw).length ? ordNoteRaw : ordRaw.note, 120),
      paused: ordRaw.paused === true,
      pausedUntil: isoDateOrNull(ordRaw.pausedUntil),
      pausedAt: isoDateOrNull(ordRaw.pausedAt),
      pausedMessage: bilingualBlock(ordPausedMsgRaw, 160),
      acceptWhenClosed: ordRaw.acceptWhenClosed === true,
    },
    announcement: {
      enabled: annRaw.enabled === true,
      text: bilingualBlock(annTextRaw, 140),
      startsAt: isoDateOrNull(annRaw.startsAt),
      expiresAt: isoDateOrNull(annRaw.expiresAt),
      scroll: annRaw.scroll !== false,
      speed: tickerSpeedOrDefault(annRaw.speed),
    },
    privacy: {
      extra: bilingualBlock(privExtraRaw, 1000),
      reviewed: privRaw.reviewed === true,
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
