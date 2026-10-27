/**
 * Settings-block validation for restaurant menu documents.
 * Single consumer: the validate.js orchestrator.
 */
import { stripControls, validateBilingual, validateBilingualOpt, TIME_REGEX, PHONE_REGEX, WHATSAPP_REGEX } from './validate-core.js';
import { buildFeatureLibrary } from './validate-feature-library.js';

/**
 * Validates the settings block and builds the feature-library state.
 * Returns the cleaned settings plus the live library (lookup maps with
 * their ensure* helpers), which the items phase mutates for legacy
 * migration. Appends to `errors` in document order.
 */
function validateSettings(s, errors) {
  const name = validateBilingual(errors, s.name, 'name', 80);
  const tagline = validateBilingual(errors, s.tagline, 'tagline', 80);
  const address = validateBilingual(errors, s.address, 'address', 120);
  const hoursText = validateBilingual(errors, s.hoursText, 'hoursText', 120);
  const currency = validateBilingual(errors, s.currency, 'currency', 10);

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
  const SOCIAL_NETWORKS = ['instagram', 'facebook', 'whatsapp'];
  const social = {};
  if (s.social && typeof s.social === 'object') {
    SOCIAL_NETWORKS.forEach((network) => {
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

  // Display order of the social platforms (admin-reorderable in settings).
  const socialOrder = [];
  if (Array.isArray(s.socialOrder)) {
    for (const key of s.socialOrder) {
      if (typeof key === 'string' && SOCIAL_NETWORKS.includes(key) && !socialOrder.includes(key)) {
        socialOrder.push(key);
      }
    }
  }
  for (const key of SOCIAL_NETWORKS) {
    if (!socialOrder.includes(key)) socialOrder.push(key);
  }

  // Social visibility flags
  const socialEnabledRaw = (s.socialEnabled && typeof s.socialEnabled === 'object') ? s.socialEnabled : {};
  const socialEnabled = {
    instagram: socialEnabledRaw.instagram !== false,
    facebook: socialEnabledRaw.facebook !== false,
    whatsapp: socialEnabledRaw.whatsapp !== false,
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

  // Pause / closed-hours controls (all optional, safe defaults).
  const paused = ord.paused === true;
  let pausedUntil = null;
  if (ord.pausedUntil !== undefined && ord.pausedUntil !== null && ord.pausedUntil !== '') {
    const t = typeof ord.pausedUntil === 'string' ? Date.parse(ord.pausedUntil) : NaN;
    if (!Number.isFinite(t)) {
      errors.push('settings.ordering.pausedUntil must be a valid ISO date or null');
    } else {
      pausedUntil = new Date(t).toISOString();
    }
  }
  const pausedMessage = { en: '', ar: '' };
  if (ord.pausedMessage && typeof ord.pausedMessage === 'object') {
    pausedMessage.en = stripControls(ord.pausedMessage.en).trim().slice(0, 160);
    pausedMessage.ar = stripControls(ord.pausedMessage.ar).trim().slice(0, 160);
  }
  const acceptWhenClosed = ord.acceptWhenClosed === true;

  // Announcement banner (plain text only, optional scheduling).
  const ann = s.announcement && typeof s.announcement === 'object' ? s.announcement : {};
  const announcementEnabled = ann.enabled === true;
  const announcementText = {
    en: stripControls(ann.text && ann.text.en).trim().slice(0, 140),
    ar: stripControls(ann.text && ann.text.ar).trim().slice(0, 140),
  };
  let announcementStartsAt = null;
  let announcementExpiresAt = null;
  if (ann.startsAt !== undefined && ann.startsAt !== null && ann.startsAt !== '') {
    const t = typeof ann.startsAt === 'string' ? Date.parse(ann.startsAt) : NaN;
    if (!Number.isFinite(t)) {
      errors.push('settings.announcement.startsAt must be a valid ISO date or null');
    } else {
      announcementStartsAt = new Date(t).toISOString();
    }
  }
  if (ann.expiresAt !== undefined && ann.expiresAt !== null && ann.expiresAt !== '') {
    const t = typeof ann.expiresAt === 'string' ? Date.parse(ann.expiresAt) : NaN;
    if (!Number.isFinite(t)) {
      errors.push('settings.announcement.expiresAt must be a valid ISO date or null');
    } else {
      announcementExpiresAt = new Date(t).toISOString();
    }
  }
  if (announcementStartsAt && announcementExpiresAt && announcementExpiresAt <= announcementStartsAt) {
    errors.push('settings.announcement.expiresAt must be after startsAt');
  }
  if (announcementExpiresAt && Date.parse(announcementExpiresAt) > Date.now() + 365 * 86400000) {
    errors.push('settings.announcement.expiresAt must be within 365 days');
  }
  if (announcementEnabled && !announcementText.en && !announcementText.ar) {
    errors.push('settings.announcement needs text in at least one language when enabled');
  }

  // Ticker motion: scrolling marquee by default (scroll !== false),
  // speed 1 (slow) .. 10 (fast), default 5. Out-of-range values are dropped.
  const announcementScroll = ann.scroll !== false;
  const announcementSpeed =
    typeof ann.speed === 'number' && Number.isFinite(ann.speed)
      ? Math.min(10, Math.max(1, Math.round(ann.speed)))
      : 5;

  // Privacy page extras (owner-editable plain text) + review flag.
  const priv = s.privacy && typeof s.privacy === 'object' ? s.privacy : {};
  const privacy = {
    extra: {
      en: stripControls(priv.extra && priv.extra.en).trim().slice(0, 1000),
      ar: stripControls(priv.extra && priv.extra.ar).trim().slice(0, 1000),
    },
    reviewed: priv.reviewed === true,
  };

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

  // Feature groups + library (names only; prices live per item) are parsed
  // by the feature-library module so settings can carry them; legacy docs
  // migrate into the library during items validation below.
  const { featureGroups, featureDefs, featureById, ensureFeature } = buildFeatureLibrary(s, errors);

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
    socialOrder,
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
      paused,
      pausedUntil,
      pausedMessage,
      acceptWhenClosed,
    },
    announcement: {
      enabled: announcementEnabled,
      text: announcementText,
      startsAt: announcementStartsAt,
      expiresAt: announcementExpiresAt,
      scroll: announcementScroll,
      speed: announcementSpeed,
    },
    privacy,
  };
  return { cleanSettings, featureById, ensureFeature };
}

export { validateSettings };
