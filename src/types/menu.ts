export type OrderType = 'delivery' | 'pickup' | 'dinein';

export type PricingUnit = 'pc' | 'portion' | 'dozen' | 'box' | 'bottle' | 'glass' | 'kg';

export interface ItemPricing {
  /** Known unit (PricingUnit) or a free-text custom label (max 24 chars). */
  unit: string;
  /** Base price per unit. Absent when the item is sold by variants only. */
  price?: number;
  minQty: number;
  step: number;
  maxQty: number;
  showUnit: boolean;
}

/** Optional admin color for a feature-library section. Purely cosmetic:
 *  the admin Libraries tab uses it to tell sections apart. The customer
 *  storefront keeps one unified brand color (heat stays red). */
export type FeatureColorId =
  | 'gold'
  | 'amber'
  | 'orange'
  | 'red'
  | 'rose'
  | 'violet'
  | 'sky'
  | 'emerald'
  | 'vegetables'
  | 'cheese'
  | 'meat'
  | 'chicken'
  | 'seafood'
  | 'sauce'
  | 'bread'
  | 'drinks'
  | 'dessert'
  | 'vegan'
  | 'mushroom'
  | 'olive';

/** A section in the Features library (e.g. Sizes, Add-ons).
 *  Sections are pure folders — whether a feature is used as a size or an
 *  add-on is decided per item in the item editor.
 *  `selection` controls split-quantity picks for ADD-ONS only ('multi' =
 *  all-or-nothing per option, 'single' = at most one unit's worth across
 *  the group; default 'multi'). The sizes section ignores it (sizes stay
 *  single-required as today). `prompt` is an optional customer-facing
 *  title/note shown above that group's choices; absent/empty = legacy. */
export interface FeatureGroup {
  id: string;
  name: { en: string; ar: string };
  selection?: 'single' | 'multi';
  prompt?: { en: string; ar: string };
  /** Optional admin-only section color (see FeatureColorId). */
  color?: FeatureColorId;
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

/** An add-on enabled on one item (0 = free). `default` = pre-selected in the order window; the customer can still remove it. */
export interface ItemAddon {
  featureId: string;
  price: number;
  default?: boolean;
}

export type BadgeId = 'new' | 'spicy' | 'top';

/** One distance-based delivery fee band: pins up to `upToKm` km from the
 *  restaurant pay `fee` (in settings currency). Tiers are kept sorted
 *  ascending by `upToKm` everywhere (admin, client, server). */
export interface DeliveryFeeTier {
  /** Inclusive upper bound in km (0.1..2000, 1 decimal). */
  upToKm: number;
  /** Fee for this band (>= 0, 2 decimals). */
  fee: number;
}

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
  /** Add-on groups (feature-group ids) the customer MUST pick at least one
      option from — the sheet marks them required and the Add button stays
      disabled until each is covered; order-time validatePicks rejects
      uncovered lines. Groups with no enabled option are skipped (never
      impossible). Set per group from the item editor. */
  requiredGroups?: string[];
  badges: BadgeId[];
  /** ISO date the item was added. Drives the automatic NEW badge. Missing = not new. */
  addedAt?: string;
  featured: boolean;
  available: boolean;
  /** Photo for the "photos" and "round" layouts, the "cards" background
      and featured carousel cards. A public URL (https:// or
      root-relative `/...`) — never a data URL: the menu save payload is
      capped at 256 KB, so inline images would blow the budget fast.
      Absent/broken images fall back to the branded category placeholder. */
  imageUrl?: string;
  /** Optional responsive variants of imageUrl (≈400w for `s`, ≈800w for
      `m`; imageUrl itself stays the largest ≈1280w for backwards compat).
      Same URL rules as imageUrl (https://, http:// or /; ≤500 chars; never
      data:). Frontend builds srcset as `s 400w, m 800w, imageUrl <w>w`;
      missing variants fall back to imageUrl alone. */
  imageVariants?: { s?: string; m?: string };
  /** Opt out of heat entirely: no heat section is offered for this item
      (normalize strips any heat rows and never injects them), even though it
      has other add-ons. For drinks, desserts and other never-spicy items.
      Incompatible with the Spicy badge (heat is mandatory for badged items)
      — the admin UI and the server validator both reject the combination. */
  noHeat?: boolean;
}

export interface Category {
  id: string;
  name: { en: string; ar: string };
  visible: boolean;
  /** How its items render in the menu: cards grid, text-first list, compact
      rows, photo-first cards, or round cards (circular photo + title +
      description + price). */
  layout?: 'cards' | 'list' | 'compact' | 'photos' | 'round';
  /** Watermark for cards: 'brand' (pan mark), a glyph key
      (pizza/cup/coffee/cake/croissant/salad/sandwich/utensils),
      'custom' (uses iconUrl), or 'none'. Undefined = none (clean default,
      same as the original cards). */
  icon?: string;
  /** Custom PNG watermark (data URL, ≤ ~40 KB after 256px resize).
      Used only when icon === 'custom'. */
  iconUrl?: string;
  /** Watermark style for description-less cards: single 'corner' mark
      (default), centered 'center' emblem, tiled 'pattern', or full-bleed
      'cover'. */
  iconStyle?: 'corner' | 'center' | 'pattern' | 'cover';
  /** Watermark opacity percent (5..60, default 18). */
  iconOpacity?: number;
  /** Watermark size percent (25..200, default 100). */
  iconScale?: number;
  /** Watermark rotation degrees (-180..180, default -12). */
  iconRotate?: number;
  /** Watermark anchor for single-mark styles, 0..100 percent. */
  iconX?: number;
  /** Watermark anchor for single-mark styles, 0..100 percent. */
  iconY?: number;
}

/** Social platforms shown in "Connect with Us" (admin-reorderable). */
export type SocialPlatform = 'instagram' | 'facebook' | 'whatsapp';

/** Seasonal storefront theme id: `off` = none. Extensible — future
 *  seasons (ramadan, halloween, …) add an id here plus a registry entry
 *  in `src/features/seasonal/themes.ts`. Unknown stored values normalize
 *  to `off` (client + server), so an old app never breaks on a new id. */
export type SeasonalTheme = 'off' | 'christmas';

export interface SeasonalSettings {
  theme: SeasonalTheme;
  /** Go-live switch: the Settings section only *arms* a season
   *  (theme='christmas', live=false); the dashboard card flips `live`.
   *  The customer site renders effects only when both are set. */
  live: boolean;
}

/** Payment method ids. Today only `cod` exists — the type is a seam for
 *  future online gateways (stripe / paypal / …) without touching orders. */
export type PaymentMethodId = 'cod';

export interface PaymentsSettings {
  /** Cash on delivery master switch. Default true (legacy menus). */
  codEnabled: boolean;
}

export interface MenuSettings {  name: { en: string; ar: string };
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
    whatsapp?: string;
  };
  socialEnabled: {
    instagram: boolean;
    facebook: boolean;
    whatsapp: boolean;
  };
  /** Display order of the social platforms (admin-reorderable). */
  socialOrder: SocialPlatform[];
  currency: { en: string; ar: string };
  about: { en: string; ar: string };
  defaultTheme: 'dark' | 'light';
  defaultLang: 'en' | 'ar';
  /** Show-more paging for long menu sections (admin-tunable, 4..50). */
  showMore: {
    /** Items visible before the expander (default 12). */
    initial: number;
    /** Items added per "show more" tap (default 8). */
    batch: number;
  };
  ordering: {
    enabled: boolean;
    types: OrderType[];
    minOrder: number;
    minOrderEnabled: boolean;
    deliveryFee: number;
    deliveryFeeEnabled: boolean;
    /** Pricing model: 'flat' = one fee for all (legacy); 'distance' =
     *  tiered fees by pin distance from the restaurant (smart). Missing in
     *  old docs → 'flat' so legacy menus behave exactly as today. */
    deliveryFeeMode?: 'flat' | 'distance';
    /** Distance tiers (distance mode only): ascending `upToKm` caps, each
     *  with its fee. A pin at distance d pays the first tier with
     *  d <= upToKm; beyond the last tier pays the last tier's fee.
     *  Missing/empty → flat fallback. Max 8 tiers. */
    deliveryFeeTiers?: DeliveryFeeTier[];
    /** Free delivery threshold: when enabled and subtotal >= freeDeliveryMin
     *  the fee drops to 0 (both modes). Missing → disabled. */
    freeDeliveryMin?: number;
    freeDeliveryEnabled?: boolean;
    note: { en: string; ar: string };
    /** Manual pause switch (pausedUntil null = until resumed). */
    paused: boolean;
    /** Auto-resume instant (ISO) or null. Expired values count as resumed. */
    pausedUntil: string | null;
    /** When the current pause started (ISO) or null. Display-only live timer. */
    pausedAt: string | null;
    /** Owner message shown while paused (empty = default message). */
    pausedMessage: { en: string; ar: string };
    /** When true, orders are accepted outside business hours. */
    acceptWhenClosed: boolean;
    /** Base kitchen prep minutes before dispatch (smart ETA). */
    prepMinutes: number;
    /** Extra kitchen minutes per queued order (smart ETA). */
    kitchenMinutesPerOrder: number;
    /** Courier speed km/h (smart ETA). */
    courierSpeedKmh: number;
    /** Road detour multiplier, 1.0..2.0 (smart ETA). */
    roadFactor: number;
    /** Fallback delivery minutes when distance is unknown (smart ETA). */
    defaultDeliveryMinutes: number;
    /** Receive-delay window for delivery orders (smart ETA). */
    receiveDelayDeliveryMin: number;
    /** Receive-delay window for pickup orders (smart ETA). */
    receiveDelayPickupMin: number;
    /** Customer self-cancel / kitchen grace window, whole minutes 1..30
     *  (default 5). Missing/out-of-range/zero in old docs falls back to 5
     *  so legacy menus behave exactly as today. */
    cancelWindowMin?: number;
    /** Delivery area: 'all' serves everywhere (legacy behavior); 'selected'
     *  restricts delivery pins to the listed countries, each either fully
     *  open ('ALL' subdivisions) or narrowed to explicit subdivision codes.
     *  maxKm is the server-enforced backstop radius from the restaurant. */
    deliveryZones: {
      mode: 'all' | 'selected';
      maxKm: number;
      countries: Array<{ cc: string; subdivisions: 'ALL' | string[] }>;
    };
  };
  /** Order status emails to the customer (frontend stores the prefs;
   *  the server decides the actual send). Missing in old docs → defaults
   *  (empty sender/reply-to, all events on). */
  notifications: {
    senderName: string;
    replyTo: string;
    events: { placed: boolean; confirmed: boolean; completed: boolean; cancelled: boolean; receipt_check: boolean };
  };
  announcement: {
    enabled: boolean;
    text: { en: string; ar: string };
    startsAt: string | null;
    expiresAt: string | null;
    /** Ticker motion: true = scrolling marquee (default), false = static centered text. */
    scroll?: boolean;
    /** Marquee speed 1 (slow) .. 10 (fast). Default 5. */
    speed?: number;
  };
  /** Seasonal storefront theme (snow, greetings, …). Missing in old docs
   *  → `{ theme: 'off', live: false }` (see seasonalOrDefault). `live` is
   *  flipped only from the dashboard card; the Settings section merely
   *  arms a season. */
  seasonal: SeasonalSettings;
  privacy: {
    /** Owner-written extra notes shown on the privacy page. */
    extra: { en: string; ar: string };
    /** Owner confirms the privacy text was reviewed for local law. */
    reviewed: boolean;
  };
  featuredAutoplay: boolean;
  featuredAutoplayInterval: number;
  /** Owner-picked bell chimes (one of the 5 ids in bellPatterns.ts). */
  sounds: {
    /** Kitchen alarm on the admin dashboard. */
    kitchen: string;
    /** Customer bell on the menu page. */
    customer: string;
  };
  badges: BadgeSettings;
  /** Payments block. Missing in old docs → `{ codEnabled: true }`
   *  (legacy behavior: COD is the only method and it is on). */
  payments?: PaymentsSettings;
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

/** One configured cart line. Key = id + variantId + sorted addonIds
 *  (or sorted fid:count pairs when addonQty is present).
 *  `addonQty` maps featureId → number of units carrying that option.
 *  ABSENT = legacy semantics (every id in addonIds applies to ALL units). */
export interface CartLine {
  id: string;
  variantId?: string;
  addonIds?: string[];
  /** Split quantities: featureId → 0..quantity. Absent = legacy (all units). */
  addonQty?: Record<string, number>;
  quantity: number;
}

/** Result of an admin save: the authoritative doc (for version adoption)
 *  plus whether the server actually stored our content. */
export interface AdminSaveResult {
  doc: MenuData;
  saved: boolean;
}

/** A cart line resolved against the live menu, with real money.
 *  `addonQty` rides along when the source line carries split counts
 *  (absent = legacy, every addon applies to all units). */
export interface ResolvedCartLine {
  key: string;
  item: MenuItem;
  variantId?: string;
  addonIds: string[];
  addonQty?: Record<string, number>;
  quantity: number;
  unit: number;
  total: number;
}

export interface CustomerDetails {
  name: string;
  phone: string;
  address: string;
  tableNumber: string;
  notes: string;
  /** Optional email for order status updates. Absent/empty = no emails. */
  email?: string;
  orderType: OrderType;
  remember: boolean;
  /** Opt-in: WhatsApp order confirmations (used only if the restaurant enabled the Cloud API sender). */
  whatsappUpdates?: boolean;
}
