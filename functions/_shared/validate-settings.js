/**
 * Settings-block validation for restaurant menu documents.
 * Single consumer: the validate.js orchestrator.
 */
import { stripControls, validateBilingual, validateBilingualOpt, TIME_REGEX, PHONE_REGEX, WHATSAPP_REGEX } from './validate-core.js';
import { buildFeatureLibrary } from './validate-feature-library.js';
import VALID_COUNTRIES from './geodata/countries.js';

/** ISO 3166-1 alpha-2 codes we serve zone data for. */
const VALID_CC = new Set(
  (Array.isArray(VALID_COUNTRIES) ? VALID_COUNTRIES : [])
    .map((c) => c && typeof c.cc === 'string' ? c.cc.toUpperCase() : '')
    .filter((cc) => /^[A-Z]{2}$/.test(cc)),
);

/**
 * Validates the settings block and builds the feature-library state.
 * Returns the cleaned settings plus the live library (lookup maps with
 * their ensure* helpers), which the items phase mutates for legacy
 * migration. Appends to `errors` in document order.
 */
/**
 * Plain-JS twin of normalizeMapLocation() (client TS). Keep the two in sync:
 * bare "lat,lng" → coords search URL; http → https; bare domain → https;
 * free text → Maps search URL; https URLs kept verbatim.
 */
function normalizeMapLocationJs(raw) {
  const clean = (raw || '').trim();
  if (!clean) return '';
  const coordRe = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;
  const cm = clean.match(coordRe);
  if (cm) {
    const lat = Number(cm[1]);
    const lng = Number(cm[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }
  }
  if (/^http:\/\//i.test(clean)) return clean.replace(/^http:\/\//i, 'https://');
  if (/^https:\/\//i.test(clean)) return clean;
  if (/^(www\.)?[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(clean)) return `https://${clean}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}`;
}

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

  // WhatsApp (full international digits, e.g. 96170123456): persisted so
  // the header/footer wa.me buttons and the Social autofill keep working.
  const whatsapp = typeof s.whatsapp === 'string' ? s.whatsapp.replace(/[^0-9]/g, '') : '';

  // Map URL — accepts a work location in any form (full/short Maps URL,
  // raw "lat,lng", place name) and normalizes to a working https Maps link.
  // Mirrors normalizeMapLocation() in src/utils/menuHelpers.ts (plain-JS
  // twin: functions cannot import the TS client utils).
  const mapUrlRaw = typeof s.mapUrl === 'string' ? s.mapUrl.trim() : '';
  const mapUrl = normalizeMapLocationJs(mapUrlRaw);
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
  // Ordering guards: enabling needs BOTH a callable contact phone (Call
  // button) AND a WhatsApp number (header/footer wa.me buttons + order
  // contact). PHONE_REGEX allows +, spaces and dashes; WHATSAPP_REGEX
  // wants full international digits with no leading zero.
  if (orderingEnabled && !PHONE_REGEX.test(phone)) {
    errors.push('settings.phone must be a callable phone number (e.g. +96170123456) when ordering is enabled');
  }
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

  // Delivery zones: 'all' serves everywhere (legacy behavior); 'selected'
  // restricts delivery pins to the listed countries, each either fully
  // open ('ALL' subdivisions) or narrowed to explicit subdivision codes.
  // Subdivision existence is guaranteed by the admin UI (same generated
  // lists), so the server checks shape only — plus the pin↔restaurant
  // distance backstop in orders.js, which needs no external data.
  const dzRaw = ord.deliveryZones && typeof ord.deliveryZones === 'object' && !Array.isArray(ord.deliveryZones)
    ? ord.deliveryZones
    : {};
  const dzMode = dzRaw.mode === 'selected' ? 'selected' : 'all';
  let dzMaxKm = 100;
  if (dzRaw.maxKm !== undefined) {
    if (typeof dzRaw.maxKm !== 'number' || !Number.isFinite(dzRaw.maxKm) || dzRaw.maxKm < 1 || dzRaw.maxKm > 2000) {
      errors.push('settings.ordering.deliveryZones.maxKm must be a number between 1 and 2000');
    } else {
      dzMaxKm = Math.round(dzRaw.maxKm);
    }
  }
  const dzCountries = [];
  if (dzRaw.countries !== undefined) {
    if (!Array.isArray(dzRaw.countries)) {
      errors.push('settings.ordering.deliveryZones.countries must be an array');
    } else {
      if (dzRaw.countries.length > 249) errors.push('Maximum 249 delivery-zone countries allowed');
      const seenCc = new Set();
      for (const z of dzRaw.countries) {
        if (!z || typeof z !== 'object') continue;
        const cc = typeof z.cc === 'string' ? z.cc.trim().toUpperCase() : '';
        if (!/^[A-Z]{2}$/.test(cc)) {
          errors.push(`Invalid delivery-zone country code: "${typeof z.cc === 'string' ? z.cc : ''}"`);
          continue;
        }
        if (!VALID_CC.has(cc)) {
          errors.push(`Unknown delivery-zone country code: "${cc}"`);
          continue;
        }
        if (seenCc.has(cc)) {
          errors.push(`Duplicate delivery-zone country: "${cc}"`);
          continue;
        }
        seenCc.add(cc);
        if (z.subdivisions === undefined || z.subdivisions === null || z.subdivisions === 'ALL') {
          dzCountries.push({ cc, subdivisions: 'ALL' });
          continue;
        }
        if (!Array.isArray(z.subdivisions)) {
          errors.push(`Delivery-zone "${cc}" subdivisions must be "ALL" or an array of codes`);
          continue;
        }
        if (z.subdivisions.length > 200) {
          errors.push(`Delivery-zone "${cc}" allows at most 200 subdivisions`);
          continue;
        }
        const codes = [];
        const seenSub = new Set();
        for (const code of z.subdivisions) {
          if (typeof code !== 'string' || !/^[A-Za-z0-9-]{2,16}$/.test(code.trim())) {
            errors.push(`Delivery-zone "${cc}" has an invalid subdivision code`);
            continue;
          }
          const up = code.trim().toUpperCase();
          if (!seenSub.has(up)) {
            seenSub.add(up);
            codes.push(up);
          }
        }
        if (!codes.length) {
          errors.push(`Delivery-zone "${cc}" lists no valid subdivisions (use "ALL" for the whole country)`);
          continue;
        }
        dzCountries.push({ cc, subdivisions: codes });
      }
    }
  }
  const deliveryZones = { mode: dzMode, maxKm: dzMaxKm, countries: dzCountries };

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
  let pausedAt = null;
  if (ord.pausedAt !== undefined && ord.pausedAt !== null && ord.pausedAt !== '') {
    const t = typeof ord.pausedAt === 'string' ? Date.parse(ord.pausedAt) : NaN;
    if (!Number.isFinite(t)) {
      errors.push('settings.ordering.pausedAt must be a valid ISO date or null');
    } else {
      pausedAt = new Date(t).toISOString();
    }
  }
  const pausedMessage = { en: '', ar: '' };
  if (ord.pausedMessage && typeof ord.pausedMessage === 'object') {
    pausedMessage.en = stripControls(ord.pausedMessage.en).trim().slice(0, 160);
    pausedMessage.ar = stripControls(ord.pausedMessage.ar).trim().slice(0, 160);
  }
  const acceptWhenClosed = ord.acceptWhenClosed === true;

  // Smart-ETA tuning (all optional, safe defaults; out-of-range falls back).
  const etaMinutesOr = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 180 ? Math.round(v) : fb);
  const courierSpeedKmh = (typeof ord.courierSpeedKmh === 'number' && Number.isFinite(ord.courierSpeedKmh) && ord.courierSpeedKmh >= 5 && ord.courierSpeedKmh <= 120)
    ? ord.courierSpeedKmh
    : 25;
  const roadFactor = (typeof ord.roadFactor === 'number' && Number.isFinite(ord.roadFactor) && ord.roadFactor >= 1 && ord.roadFactor <= 2)
    ? Math.round((ord.roadFactor + Number.EPSILON) * 100) / 100
    : 1.35;
  const receiveDelayOr = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 720 ? Math.round(v) : fb);
  const prepMinutes = etaMinutesOr(ord.prepMinutes, 15);
  const kitchenMinutesPerOrder = etaMinutesOr(ord.kitchenMinutesPerOrder, 3);
  const defaultDeliveryMinutes = etaMinutesOr(ord.defaultDeliveryMinutes, 20);
  const receiveDelayDeliveryMin = receiveDelayOr(ord.receiveDelayDeliveryMin, 30);
  const receiveDelayPickupMin = receiveDelayOr(ord.receiveDelayPickupMin, 15);
  // Customer self-cancel / kitchen grace window (1..30 min, default 5).
  // Zero/blank/out-of-range in old docs falls back to 5 (legacy behavior);
  // the value is validated, never rejected with an error.
  const cancelWindowMin = (typeof ord.cancelWindowMin === 'number' && Number.isFinite(ord.cancelWindowMin) && ord.cancelWindowMin >= 1 && ord.cancelWindowMin <= 30)
    ? Math.round(ord.cancelWindowMin)
    : 5;

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

  // Bell chimes (owner-pickable, one of the 5 library ids; unknown ->
  // classic so an old client never goes silent). Twin of the client's
  // soundsOrDefault — keep the two in sync.
  const SOUND_IDS = ['classic', 'triple', 'urgent', 'soft', 'gong'];
  const sndRaw = s.sounds && typeof s.sounds === 'object' ? s.sounds : {};
  const soundOr = (v) => (typeof v === 'string' && SOUND_IDS.includes(v.trim()) ? v.trim() : 'classic');
  const sounds = { kitchen: soundOr(sndRaw.kitchen), customer: soundOr(sndRaw.customer) };

  // Smart badges windows (optional; safe defaults when missing)
  const bRaw = s.badges && typeof s.badges === 'object' ? s.badges : {};
  const intOr = (v, fb, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : fb);
  const badges = {
    newDays: intOr(bRaw.newDays, 14, 1, 365),
    topDays: intOr(bRaw.topDays, 30, 1, 365),
    topCount: intOr(bRaw.topCount, 6, 1, 50),
  };

  // Show-more paging (menu sections; safe defaults when missing). Bounds keep
  // it sane: at least 4 (below that a button is silly), at most 50 a screen.
  const smRaw = s.showMore && typeof s.showMore === 'object' ? s.showMore : {};
  const showMore = {
    initial: intOr(smRaw.initial, 12, 4, 50),
    batch: intOr(smRaw.batch, 8, 4, 50),
  };

  // Customer order-status email notifications (all optional, safe defaults:
  // sender '' + replyTo '' + every event enabled). Invalid replyTo is
  // rejected with an error and reset to '' (never stored blindly).
  const notifRaw = s.notifications && typeof s.notifications === 'object' && !Array.isArray(s.notifications)
    ? s.notifications
    : {};
  const senderName = typeof notifRaw.senderName === 'string'
    ? stripControls(notifRaw.senderName).trim().slice(0, 80)
    : '';
  let replyTo = typeof notifRaw.replyTo === 'string' ? notifRaw.replyTo.trim().slice(0, 254) : '';
  if (replyTo) {
    const lowered = replyTo.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lowered)) {
      errors.push('settings.notifications.replyTo must be a valid email address or empty');
      replyTo = '';
    } else {
      replyTo = lowered;
    }
  }
  const evRaw = notifRaw.events && typeof notifRaw.events === 'object' && !Array.isArray(notifRaw.events)
    ? notifRaw.events
    : {};
  const boolOrTrue = (v) => (typeof v === 'boolean' ? v : true);
  const notifications = {
    senderName,
    replyTo,
    events: {
      placed: boolOrTrue(evRaw.placed),
      confirmed: boolOrTrue(evRaw.confirmed),
      completed: boolOrTrue(evRaw.completed),
      cancelled: boolOrTrue(evRaw.cancelled),
      receipt_check: boolOrTrue(evRaw.receipt_check),
    },
  };

  // Feature groups + library (names only; prices live per item) are parsed
  // by the feature-library module so settings can carry them; legacy docs
  // migrate into the library during items validation below.
  const { featureGroups, featureDefs, featureById, groupById, ensureFeature } =
    buildFeatureLibrary(s, errors);

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
    sounds,
    badges,
    showMore,
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
      deliveryZones,
      paused,
      pausedUntil,
      pausedAt,
      pausedMessage,
      acceptWhenClosed,
      prepMinutes,
      kitchenMinutesPerOrder,
      courierSpeedKmh,
      roadFactor,
      defaultDeliveryMinutes,
      receiveDelayDeliveryMin,
      receiveDelayPickupMin,
      cancelWindowMin,
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
    notifications,
  };
  return { cleanSettings, featureById, groupById, ensureFeature };
}

export { validateSettings };
