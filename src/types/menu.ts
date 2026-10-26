export type OrderType = 'delivery' | 'pickup' | 'dinein';

export type PricingUnit = 'pc' | 'portion' | 'dozen' | 'box' | 'bottle' | 'glass' | 'kg';

export interface ItemPricing {
  unit: PricingUnit;
  /** Base price per unit. Absent when the item is sold by variants only. */
  price?: number;
  minQty: number;
  step: number;
  maxQty: number;
  showUnit: boolean;
}

/** A section in the Features library (e.g. Sizes, Add-ons).
 *  Sections are pure folders — whether a feature is used as a size or an
 *  add-on is decided per item in the item editor. */
export interface FeatureGroup {
  id: string;
  name: { en: string; ar: string };
}

/**
 * Feature library (menu level, names only — prices live per item).
 * Sections are pure folders; each item row decides size vs add-on.
 */
export interface FeatureDef {
  id: string;
  /** Section this feature lives in. */
  groupId: string;
  name: { en: string; ar: string };
}

/** A size enabled on one item (name from the library, price here). First = default. */
export interface ItemVariant {
  featureId: string;
  price: number;
}

/** An add-on enabled on one item (0 = free). */
export interface ItemAddon {
  featureId: string;
  price: number;
}

export type BadgeId = 'new' | 'spicy' | 'top';

export interface BadgeSettings {
  /** Days a new item keeps the NEW badge. */
  newDays: number;
  /** Sales window (days) for the top-sellers rank. */
  topDays: number;
  /** How many top sellers the Apply button flags. */
  topCount: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  /** Legacy numeric price (pre-schemaVersion-2 menus and caches). Use pricing instead. */
  price?: number;
  pricing: ItemPricing;
  /** Sizes enabled on this item (prices here). When present, customer must pick one. */
  variants?: ItemVariant[];
  /** featureId of the default size. Missing/invalid → first variant. Never reorders. */
  defaultVariant?: string;
  /** Add-ons enabled on this item (prices here, 0 = free). */
  addons?: ItemAddon[];
  badges: BadgeId[];
  /** ISO date the item was added. Drives the automatic NEW badge. Missing = not new. */
  addedAt?: string;
  featured: boolean;
  available: boolean;
}

export interface Category {
  id: string;
  name: { en: string; ar: string };
  visible: boolean;
  /** How its items render in the menu: cards grid, text-first list or compact rows. */
  layout?: 'cards' | 'list' | 'compact';
}

export interface MenuSettings {
  name: { en: string; ar: string };
  tagline: { en: string; ar: string };
  logoText: string;
  phone: string;
  whatsapp: string;
  mapUrl: string;
  address: { en: string; ar: string };
  hoursText: { en: string; ar: string };
  statusMode: 'auto' | 'open' | 'closed';
  openTime: string;
  closeTime: string;
  workingDays: string[];
  timezone: string;
  social: {
    instagram?: string;
    facebook?: string;
    tiktok?: string;
  };
  socialEnabled: {
    instagram: boolean;
    facebook: boolean;
    tiktok: boolean;
  };
  currency: { en: string; ar: string };
  about: { en: string; ar: string };
  defaultTheme: 'dark' | 'light';
  defaultLang: 'en' | 'ar';
  ordering: {
    enabled: boolean;
    types: OrderType[];
    minOrder: number;
    minOrderEnabled: boolean;
    deliveryFee: number;
    deliveryFeeEnabled: boolean;
    note: { en: string; ar: string };
    /** Manual pause switch (pausedUntil null = until resumed). */
    paused: boolean;
    /** Auto-resume instant (ISO) or null. Expired values count as resumed. */
    pausedUntil: string | null;
    /** Owner message shown while paused (empty = default message). */
    pausedMessage: { en: string; ar: string };
    /** When true, orders are accepted outside business hours. */
    acceptWhenClosed: boolean;
  };
  announcement: {
    enabled: boolean;
    text: { en: string; ar: string };
    startsAt: string | null;
    expiresAt: string | null;
  };
  privacy: {
    /** Owner-written extra notes shown on the privacy page. */
    extra: { en: string; ar: string };
    /** Owner confirms the privacy text was reviewed for local law. */
    reviewed: boolean;
  };
  featuredAutoplay: boolean;
  featuredAutoplayInterval: number;
  badges: BadgeSettings;
  /** Feature library (names only — prices live per item). */
  featureDefs: FeatureDef[];
  /** Library sections. Missing in old docs → default Sizes/Add-ons groups. */
  featureGroups: FeatureGroup[];
}

export interface MenuData {
  /** Optimistic-concurrency counter for PUT /api/admin/menu. Never repurposed. */
  version: number;
  /** Data-model schema version (2 = variants / add-ons / per-unit pricing). */
  schemaVersion?: number;
  updatedAt: string;
  settings: MenuSettings;
  categories: Category[];
  items: MenuItem[];
}

/** One configured cart line. Key = id + variantId + sorted addonIds. */
export interface CartLine {
  id: string;
  variantId?: string;
  addonIds?: string[];
  quantity: number;
}

/** Result of an admin save: the authoritative doc (for version adoption)
 *  plus whether the server actually stored our content. */
export interface AdminSaveResult {
  doc: MenuData;
  saved: boolean;
}

/** A cart line resolved against the live menu, with real money. */
export interface ResolvedCartLine {
  key: string;
  item: MenuItem;
  variantId?: string;
  addonIds: string[];
  quantity: number;
  unit: number;
  total: number;
}

/** @deprecated Old cart shape (item id -> quantity). Migrated on load. */
export interface CartItem {
  id: string;
  quantity: number;
}

export interface CustomerDetails {
  name: string;
  phone: string;
  address: string;
  tableNumber: string;
  notes: string;
  orderType: OrderType;
  remember: boolean;
}
