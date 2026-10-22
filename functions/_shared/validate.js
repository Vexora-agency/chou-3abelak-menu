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

  // Version
  const version = typeof doc.version === 'number' && Number.isInteger(doc.version) && doc.version >= 1
    ? doc.version
    : 1;

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

  // Timezone check
  let timezone = typeof s.timezone === 'string' ? s.timezone.trim() : 'Africa/Cairo';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    errors.push(`Invalid timezone: ${timezone}`);
    timezone = 'Africa/Cairo';
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

  // Ordering settings
  const ord = s.ordering || {};
  const orderingEnabled = Boolean(ord.enabled);
  if (orderingEnabled && !WHATSAPP_REGEX.test(whatsapp)) {
    errors.push('settings.whatsapp must be an international phone number (e.g. 201000000000) when ordering is enabled');
  }

  const validTypes = ['delivery', 'pickup', 'dinein'];
  const types = Array.isArray(ord.types)
    ? ord.types.filter((t) => validTypes.includes(t))
    : ['delivery', 'pickup', 'dinein'];

  const minOrder = typeof ord.minOrder === 'number' && ord.minOrder >= 0 && ord.minOrder <= 100000
    ? Math.round(ord.minOrder * 100) / 100
    : 0;

  const deliveryFee = typeof ord.deliveryFee === 'number' && ord.deliveryFee >= 0 && ord.deliveryFee <= 10000
    ? Math.round(ord.deliveryFee * 100) / 100
    : 0;

  const note = validateBilingual(ord.note, 'ordering.note', 120);

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
    timezone,
    social,
    currency: currency.en ? currency : { en: 'EGP', ar: 'ج.م' },
    ordering: {
      enabled: orderingEnabled,
      types: types.length ? types : ['delivery', 'pickup', 'dinein'],
      minOrder,
      deliveryFee,
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

    const price = typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0 && item.price <= 100000
      ? Math.round(item.price * 100) / 100
      : 0;

    const badges = Array.isArray(item.badges)
      ? item.badges.filter((b) => allowedBadges.includes(b))
      : [];

    cleanItems.push({
      id,
      categoryId,
      name: validateBilingual(item.name, `item[${id}].name`, 80),
      description: validateBilingual(item.description, `item[${id}].description`, 300),
      price,
      badges,
      featured: Boolean(item.featured),
      available: item.available !== false,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      version,
      updatedAt,
      settings: cleanSettings,
      categories: cleanCategories,
      items: cleanItems,
    },
  };
}
