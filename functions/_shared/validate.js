/**
 * Pure validation library for restaurant menu document.
 * Usable both inside Cloudflare Pages Functions and admin client.
 */

const ID_REGEX = /^[a-z0-9_-]{1,40}$/i;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PHONE_REGEX = /^\+?[0-9\s-]{6,20}$/;
const WHATSAPP_REGEX = /^[1-9][0-9]{7,14}$/;

export function validateMenu(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['Document must be a JSON object'], value: null };
  }

  // Size check
  const jsonStr = JSON.stringify(doc);
  if (jsonStr.length > 256 * 1024) {
    errors.push('Menu document exceeds maximum size of 256 KB');
  }

  // Version (optimistic-concurrency counter — never repurposed).
  // schemaVersion is the separate data-model marker (2 = variants/add-ons).
  const version = typeof doc.version === 'number' && Number.isInteger(doc.version) && doc.version >= 1
    ? doc.version
    : 1;
  const schemaVersion = typeof doc.schemaVersion === 'number' && Number.isInteger(doc.schemaVersion) && doc.schemaVersion >= 2
    ? doc.schemaVersion
    : 2;

  // UpdatedAt
  let updatedAt = new Date().toISOString();
  if (typeof doc.updatedAt === 'string') {
    const d = new Date(doc.updatedAt);
    if (!isNaN(d.getTime())) {
      updatedAt = d.toISOString();
    }
  }

  // Settings validation
  const s = doc.settings;
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    errors.push('Missing or invalid settings object');
    return { ok: false, errors, value: null };
  }

  const validateBilingual = (field, name, max = 80) => {
    if (!field || typeof field !== 'object') {
      errors.push(`settings.${name} must be an object with en and ar strings`);
      return { en: '', ar: '' };
    }
    const en = typeof field.en === 'string' ? field.en.slice(0, max) : '';
    const ar = typeof field.ar === 'string' ? field.ar.slice(0, max) : '';
    return { en, ar };
  };

  // Optional bilingual blocks: missing means empty, never an error
  // (real menus ship without them).
  const validateBilingualOpt = (field, max = 80) => {
    if (!field || typeof field !== 'object') return { en: '', ar: '' };
    const en = typeof field.en === 'string' ? field.en.slice(0, max) : '';
    const ar = typeof field.ar === 'string' ? field.ar.slice(0, max) : '';
    return { en, ar };
  };

  const name = validateBilingual(s.name, 'name', 80);
  const tagline = validateBilingual(s.tagline, 'tagline', 80);
  const address = validateBilingual(s.address, 'address', 120);
  const hoursText = validateBilingual(s.hoursText, 'hoursText', 120);
  const currency = validateBilingual(s.currency, 'currency', 10);

  const logoText = typeof s.logoText === 'string' ? s.logoText.slice(0, 2) : 'R';

  // Phone
  const phone = typeof s.phone === 'string' ? s.phone.trim() : '';
  if (phone && !PHONE_REGEX.test(phone)) {
    errors.push('settings.phone must contain only digits, +, spaces, and dashes');
  }

  // WhatsApp
  const whatsapp = typeof s.whatsapp === 'string' ? s.whatsapp.replace(/[^0-9]/g, '') : '';

  // Map URL
  const mapUrl = typeof s.mapUrl === 'string' ? s.mapUrl.trim() : '';
  if (mapUrl && !mapUrl.startsWith('https://')) {
    errors.push('settings.mapUrl must be an https URL or empty');
  }

  // Status Mode
  const statusMode = ['auto', 'open', 'closed'].includes(s.statusMode) ? s.statusMode : 'auto';

  // Open / Close Time
  const openTime = typeof s.openTime === 'string' && TIME_REGEX.test(s.openTime) ? s.openTime : '12:00';
  const closeTime = typeof s.closeTime === 'string' && TIME_REGEX.test(s.closeTime) ? s.closeTime : '00:00';

  // Working days (sat..fri); unknown values dropped, empty means every day
  const validDays = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
  const workingDays = Array.isArray(s.workingDays)
    ? [...new Set(s.workingDays.filter((d) => validDays.includes(d)))]
    : [...validDays];
  const workingDaysFinal = workingDays.length ? workingDays : [...validDays];

  // Timezone check
  let timezone = typeof s.timezone === 'string' ? s.timezone.trim() : 'Asia/Beirut';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    errors.push(`Invalid timezone: ${timezone}`);
    timezone = 'Asia/Beirut';
  }

  // Social
  const social = {};
  if (s.social && typeof s.social === 'object') {
    ['instagram', 'facebook', 'tiktok'].forEach((network) => {
      const url = s.social[network];
      if (typeof url === 'string' && url.trim()) {
        if (url.trim().startsWith('https://')) {
          social[network] = url.trim();
        } else {
          errors.push(`social.${network} must be an https URL`);
        }
      }
    });
  }

  // Social visibility flags
  const socialEnabledRaw = (s.socialEnabled && typeof s.socialEnabled === 'object') ? s.socialEnabled : {};
  const socialEnabled = {
    instagram: socialEnabledRaw.instagram !== false,
    facebook: socialEnabledRaw.facebook !== false,
    tiktok: socialEnabledRaw.tiktok !== false,
  };

  const about = validateBilingualOpt(s.about, 300);

  // Defaults for first-time visitors (applied only when the visitor has no saved choice)
  const defaultTheme = s.defaultTheme === 'light' ? 'light' : 'dark';
  const defaultLang = s.defaultLang === 'ar' ? 'ar' : 'en';

  // Ordering settings
  const ord = s.ordering || {};
  const orderingEnabled = Boolean(ord.enabled);
  if (orderingEnabled && !WHATSAPP_REGEX.test(whatsapp)) {
    errors.push('settings.whatsapp must be an international phone number (e.g. 96170123456) when ordering is enabled');
  }

  const validTypes = ['delivery', 'pickup', 'dinein'];
  const types = Array.isArray(ord.types)
    ? ord.types.filter((t) => validTypes.includes(t))
    : ['delivery', 'pickup', 'dinein'];

  const minOrder = typeof ord.minOrder === 'number' && ord.minOrder >= 0 && ord.minOrder <= 100000000
    ? Math.round(ord.minOrder * 100) / 100
    : 0;

  const deliveryFee = typeof ord.deliveryFee === 'number' && ord.deliveryFee >= 0 && ord.deliveryFee <= 50000000
    ? Math.round(ord.deliveryFee * 100) / 100
    : 0;

  // Feature flags: an explicit boolean wins; when missing, a positive
  // value means enabled (so real menus without the flags still enforce them).
  const minOrderEnabled = typeof ord.minOrderEnabled === 'boolean' ? ord.minOrderEnabled : minOrder > 0;
  const deliveryFeeEnabled = typeof ord.deliveryFeeEnabled === 'boolean' ? ord.deliveryFeeEnabled : deliveryFee > 0;

  const note = validateBilingualOpt(ord.note, 120);

  // Featured carousel autoplay (settings level)
  const featuredAutoplay = s.featuredAutoplay !== undefined ? Boolean(s.featuredAutoplay) : true;
  const featuredAutoplayInterval = (typeof s.featuredAutoplayInterval === 'number' && s.featuredAutoplayInterval >= 2 && s.featuredAutoplayInterval <= 10)
    ? Math.round(s.featuredAutoplayInterval)
    : 4;

  // Smart badges windows (optional; safe defaults when missing)
  const bRaw = s.badges && typeof s.badges === 'object' ? s.badges : {};
  const intOr = (v, fb, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : fb);
  const badges = {
    newDays: intOr(bRaw.newDays, 14, 1, 365),
    topDays: intOr(bRaw.topDays, 30, 1, 365),
    topCount: intOr(bRaw.topCount, 6, 1, 50),
  };

  // Feature groups (library sections). The kind lives here once per
  // section — features inside inherit it. Missing entirely in old docs →
  // default Sizes/Add-ons sections are created when features need them.
  const featureGroups = [];
  const groupById = new Map();
  if (s.featureGroups !== undefined) {
    if (!Array.isArray(s.featureGroups)) {
      errors.push('settings.featureGroups must be an array');
    } else {
      if (s.featureGroups.length > 20) errors.push('Maximum 20 feature groups allowed');
      for (const g of s.featureGroups) {
        if (!g || typeof g !== 'object') continue;
        const gid = typeof g.id === 'string' ? g.id.trim() : '';
        if (!ID_REGEX.test(gid)) {
          errors.push(`Invalid feature group ID: "${gid}"`);
          continue;
        }
        if (groupById.has(gid)) {
          errors.push(`Duplicate feature group ID: "${gid}"`);
          continue;
        }
        const grp = { id: gid, name: validateBilingual(g.name, `group[${gid}].name`, 80) };
        featureGroups.push(grp);
        groupById.set(gid, grp);
      }
    }
  }
  const ensureGroup = (gid, name) => {
    if (groupById.has(gid)) return groupById.get(gid);
    const grp = { id: gid, name: validateBilingual(name, `group[${gid}].name`, 80) };
    featureGroups.push(grp);
    groupById.set(gid, grp);
    return grp;
  };

  // Feature library (names only; prices live per item).
  // Parsed here (before cleanSettings) so settings can carry it;
  // legacy docs migrate into it during items validation below.
  const featureDefs = [];
  const featureById = new Map();
  if (s.featureDefs !== undefined) {
    if (!Array.isArray(s.featureDefs)) {
      errors.push('settings.featureDefs must be an array');
    } else {
      if (s.featureDefs.length > 100) errors.push('Maximum 100 features allowed');
      for (const f of s.featureDefs) {
        if (!f || typeof f !== 'object') continue;
        const fid = typeof f.id === 'string' ? f.id.trim() : '';
        if (!ID_REGEX.test(fid)) {
          errors.push(`Invalid feature ID: "${fid}"`);
          continue;
        }
        if (featureById.has(fid)) {
          errors.push(`Duplicate feature ID: "${fid}"`);
          continue;
        }
        const fgid = typeof f.groupId === 'string' ? f.groupId.trim() : '';
        if (!groupById.has(fgid)) {
          errors.push(`Feature "${fid}" group "${fgid}" does not exist`);
          continue;
        }
        // A legacy kind on the feature is ignored (kind now lives per item row)
        const def = { id: fid, groupId: fgid, name: validateBilingual(f.name, `feature[${fid}].name`, 80) };
        featureDefs.push(def);
        featureById.set(fid, def);
      }
    }
  }
  const ensureFeature = (fid, kind, name, groupId) => {
    if (featureById.has(fid)) return featureById.get(fid);
    // Migrated features land in the default section of their kind
    const wantGroup = (typeof groupId === 'string' && groupById.has(groupId))
      ? groupId
      : (kind === 'addon' ? 'addons' : 'sizes');
    if (!groupById.has(wantGroup)) {
      ensureGroup(wantGroup, wantGroup === 'addons' ? { en: 'Add-ons', ar: 'إضافات' } : { en: 'Sizes', ar: 'أحجام' });
    }
    const def = { id: fid, groupId: wantGroup, name: validateBilingual(name, `feature[${fid}].name`, 80) };
    featureDefs.push(def);
    featureById.set(fid, def);
    return def;
  };

  const cleanSettings = {
    name,
    tagline,
    logoText,
    phone,
    whatsapp,
    mapUrl,
    address,
    hoursText,
    statusMode,
    openTime,
    closeTime,
    workingDays: workingDaysFinal,
    timezone,
    social,
    socialEnabled,
    about,
    currency: currency.en ? currency : { en: 'LBP', ar: 'ل.ل' },
    defaultTheme,
    defaultLang,
    featuredAutoplay,
    featuredAutoplayInterval,
    badges,
    featureDefs,
    featureGroups,
    ordering: {
      enabled: orderingEnabled,
      types: types.length ? types : ['delivery', 'pickup', 'dinein'],
      minOrder,
      minOrderEnabled,
      deliveryFee,
      deliveryFeeEnabled,
      note,
    },
  };

  // Categories validation
  if (!Array.isArray(doc.categories)) {
    errors.push('categories must be an array');
    return { ok: false, errors, value: null };
  }
  if (doc.categories.length > 30) {
    errors.push('Maximum 30 categories allowed');
  }

  const categoryIds = new Set();
  const cleanCategories = [];

  for (const cat of doc.categories) {
    if (!cat || typeof cat !== 'object') continue;
    const id = typeof cat.id === 'string' ? cat.id.trim() : '';
    if (!ID_REGEX.test(id)) {
      errors.push(`Invalid category ID: "${id}" (must match ${ID_REGEX})`);
      continue;
    }
    if (categoryIds.has(id)) {
      errors.push(`Duplicate category ID: "${id}"`);
      continue;
    }
    categoryIds.add(id);

    cleanCategories.push({
      id,
      name: validateBilingual(cat.name, `category[${id}].name`, 80),
      visible: Boolean(cat.visible),
    });
  }

  // Legacy category-scoped add-on groups migrate into the library +
  // per-item add-ons (collected here, expanded after items validate).
  // NOTE: the feature library itself is parsed earlier (before cleanSettings).
  const legacyGroups = [];
  if (doc.addonGroups !== undefined) {
    if (!Array.isArray(doc.addonGroups)) {
      errors.push('addonGroups must be an array');
    } else {
      if (doc.addonGroups.length > 50) errors.push('Maximum 50 add-on groups allowed');
      const addonIds = new Set();
      for (const g of doc.addonGroups) {
        if (!g || typeof g !== 'object') continue;
        const gid = typeof g.id === 'string' ? g.id.trim() : '';
        if (!ID_REGEX.test(gid)) {
          errors.push(`Invalid add-on group ID: "${gid}"`);
          continue;
        }
        if (addonIds.has(gid)) {
          errors.push(`Duplicate add-on group ID: "${gid}"`);
          continue;
        }
        addonIds.add(gid);
        if (!Number.isInteger(g.price) || g.price < 0 || g.price > 100000000) {
          errors.push(`Add-on "${gid}" price must be an integer >= 0`);
          continue;
        }
        const cats = Array.isArray(g.categoryIds) ? g.categoryIds : [];
        if (cats.length === 0) {
          errors.push(`Add-on "${gid}" must list at least one category`);
          continue;
        }
        let catsOk = true;
        for (const c of cats) {
          if (typeof c !== 'string' || !categoryIds.has(c)) {
            errors.push(`Add-on "${gid}" has non-existent categoryId "${c}"`);
            catsOk = false;
          }
        }
        if (!catsOk) continue;
        ensureFeature(gid, 'addon', g.name);
        legacyGroups.push({ id: gid, price: g.price, categoryIds: [...new Set(cats)] });
      }
    }
  }

  // Items validation
  if (!Array.isArray(doc.items)) {
    errors.push('items must be an array');
    return { ok: false, errors, value: null };
  }
  if (doc.items.length > 500) {
    errors.push('Maximum 500 items allowed');
  }

  const itemIds = new Set();
  const cleanItems = [];
  const allowedBadges = ['new', 'spicy', 'top'];

  for (const item of doc.items) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!ID_REGEX.test(id)) {
      errors.push(`Invalid item ID: "${id}"`);
      continue;
    }
    if (itemIds.has(id)) {
      errors.push(`Duplicate item ID: "${id}"`);
      continue;
    }
    itemIds.add(id);

    const categoryId = typeof item.categoryId === 'string' ? item.categoryId.trim() : '';
    if (!categoryIds.has(categoryId)) {
      errors.push(`Item "${id}" has non-existent categoryId "${categoryId}"`);
    }

    // Pricing block (new model). A legacy numeric `price` converts to
    // pricing { unit:'portion', price, ...defaults }.
    const validUnits = ['pc', 'portion', 'dozen', 'box', 'bottle', 'glass', 'kg'];
    const hasPricing = item.pricing && typeof item.pricing === 'object';
    const praw = hasPricing ? item.pricing : {};
    const legacyPrice = typeof item.price === 'number' && Number.isFinite(item.price) ? Math.max(0, Math.round((item.price + Number.EPSILON) * 100) / 100) : null;
    const unit = validUnits.includes(praw.unit) ? praw.unit : (!hasPricing ? 'portion' : null);
    if (unit === null) {
      errors.push(`Item "${id}" pricing.unit must be one of ${validUnits.join(', ')}`);
      continue;
    }
    let basePrice;
    if (praw.price !== undefined) {
      if (typeof praw.price !== 'number' || !Number.isFinite(praw.price) || praw.price < 0 || praw.price > 100000000) {
        errors.push(`Item "${id}" pricing.price must be a number >= 0 (decimals allowed)`);
        continue;
      }
      basePrice = Math.round((praw.price + Number.EPSILON) * 100) / 100;
    } else if (legacyPrice !== null) {
      basePrice = legacyPrice;
    }
    const minQty = praw.minQty === undefined ? 1 : praw.minQty;
    const step = praw.step === undefined ? 1 : praw.step;
    const maxQty = praw.maxQty === undefined ? 50 : praw.maxQty;
    if (!Number.isInteger(minQty) || minQty < 1) {
      errors.push(`Item "${id}" pricing.minQty must be an integer >= 1`);
      continue;
    }
    if (!Number.isInteger(step) || step < 1) {
      errors.push(`Item "${id}" pricing.step must be an integer >= 1`);
      continue;
    }
    if (!Number.isInteger(maxQty) || maxQty < minQty) {
      errors.push(`Item "${id}" pricing.maxQty must be an integer >= minQty`);
      continue;
    }

    // Sizes (optional; names come from the feature library, prices live here).
    // Legacy inline {id, name, price} variants migrate into the library.
    let variants;
    if (item.variants !== undefined) {
      if (!Array.isArray(item.variants) || item.variants.length === 0) {
        errors.push(`Item "${id}" must have at least one variant when "variants" is present`);
        continue;
      }
      if (item.variants.length > 20) {
        errors.push(`Item "${id}" allows at most 20 variants`);
        continue;
      }
      const seenV = new Set();
      variants = [];
      let vOk = true;
      for (const v of item.variants) {
        if (!v || typeof v !== 'object') { vOk = false; break; }
        // New shape {featureId, price} or legacy {id, name?, price}
        const rawId = typeof v.featureId === 'string' && v.featureId ? v.featureId : (typeof v.id === 'string' ? v.id : '');
        const vid = rawId.trim();
        if (!ID_REGEX.test(vid) || seenV.has(vid)) {
          errors.push(`Item "${id}" has an invalid or duplicate variant: "${vid}"`);
          vOk = false;
          break;
        }
        seenV.add(vid);
        if (typeof v.price !== 'number' || !Number.isFinite(v.price) || v.price <= 0 || v.price > 100000000) {
          errors.push(`Item "${id}" variant "${vid}" price must be a number > 0 (decimals allowed)`);
          vOk = false;
          break;
        }
        if (v.featureId) {
          if (!featureById.has(vid)) {
            errors.push(`Item "${id}" variant "${vid}" is not a known feature`);
            vOk = false;
            break;
          }
        } else {
          // Legacy inline name migrates into the library (first wins)
          ensureFeature(vid, 'size', v.name);
        }
        variants.push({ featureId: vid, price: Math.round((v.price + Number.EPSILON) * 100) / 100 });
      }
      if (!vOk) continue;
    }

    // Add-ons enabled on this item (prices here, 0 = free)
    let addons;
    if (item.addons !== undefined) {
      if (!Array.isArray(item.addons)) {
        errors.push(`Item "${id}" addons must be an array`);
        continue;
      }
      if (item.addons.length > 20) {
        errors.push(`Item "${id}" allows at most 20 add-ons`);
        continue;
      }
      const seenA = new Set();
      addons = [];
      let aOk = true;
      for (const a of item.addons) {
        if (!a || typeof a !== 'object') { aOk = false; break; }
        const aid = typeof a.featureId === 'string' ? a.featureId.trim() : '';
        if (!ID_REGEX.test(aid) || seenA.has(aid)) {
          errors.push(`Item "${id}" has an invalid or duplicate add-on: "${aid}"`);
          aOk = false;
          break;
        }
        seenA.add(aid);
        if (!featureById.has(aid)) {
          errors.push(`Item "${id}" add-on "${aid}" is not a known feature`);
          aOk = false;
          break;
        }
        if (typeof a.price !== 'number' || !Number.isFinite(a.price) || a.price < 0 || a.price > 100000000) {
          errors.push(`Item "${id}" add-on "${aid}" price must be a number >= 0 (decimals allowed)`);
          aOk = false;
          break;
        }
        addons.push({ featureId: aid, price: Math.round((a.price + Number.EPSILON) * 100) / 100 });
      }
      if (!aOk) continue;
    }

    // Every item needs a price path: variants or a base price.
    if (!variants && basePrice === undefined) {
      errors.push(`Item "${id}" needs pricing.price or at least one variant`);
      continue;
    }

    const badges = Array.isArray(item.badges)
      ? item.badges.filter((b) => allowedBadges.includes(b))
      : [];

    const pricing = { unit, minQty, step, maxQty, showUnit: praw.showUnit === true };
    // With variants the variant price rules; a base price is dropped to
    // avoid two competing sources of truth.
    if (!variants && basePrice !== undefined) pricing.price = basePrice;

    const cleanItem = {
      id,
      categoryId,
      name: validateBilingual(item.name, `item[${id}].name`, 80),
      description: validateBilingual(item.description, `item[${id}].description`, 300),
      pricing,
      badges,
      featured: Boolean(item.featured),
      available: item.available !== false,
    };
    if (variants) cleanItem.variants = variants;
    // Explicit default (★ marks in place, order untouched): must point at a size
    if (item.defaultVariant !== undefined) {
      const dvd = typeof item.defaultVariant === 'string' ? item.defaultVariant.trim() : '';
      if (!dvd || !variants || !variants.some((v) => v.featureId === dvd)) {
        errors.push(`Item "${id}" defaultVariant must match one of its variants`);
        continue;
      }
      cleanItem.defaultVariant = dvd;
    }
    if (addons && addons.length) cleanItem.addons = addons;
    // Legacy groups expand: every item of a listed category offers the
    // add-on at the group price (explicit per-item entries win).
    for (const g of legacyGroups) {
      if (!g.categoryIds.includes(categoryId)) continue;
      cleanItem.addons = cleanItem.addons || [];
      if (!cleanItem.addons.some((a) => a.featureId === g.id)) {
        cleanItem.addons.push({ featureId: g.id, price: g.price });
      }
    }
    if (cleanItem.addons && cleanItem.addons.length === 0) delete cleanItem.addons;
    // addedAt drives the automatic NEW badge (missing/invalid clears it)
    if (typeof item.addedAt === 'string' && item.addedAt) {
      const t = Date.parse(item.addedAt);
      if (!Number.isFinite(t)) {
        errors.push(`Item "${id}" addedAt must be a valid date or empty`);
        continue;
      }
      cleanItem.addedAt = new Date(t).toISOString();
    }
    cleanItems.push(cleanItem);
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      version,
      schemaVersion,
      updatedAt,
      settings: cleanSettings,
      categories: cleanCategories,
      items: cleanItems,
    },
  };
}
