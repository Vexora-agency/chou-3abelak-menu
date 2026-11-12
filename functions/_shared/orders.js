/**
 * Shared order helpers (WebCrypto/node-compatible, no dependencies).
 * Used by the public POST /api/orders and the admin orders endpoints.
 * Pricing math comes from ./pricing.js (identical to src/utils/pricing.ts).
 */
import {
  featureName,
  getVariant,
  hasVariants,
  isValidQty,
  itemAddons,
  lineTotal,
  normalizeMenu,
  normalizePricing,
  round2,
  validatePicks,
} from './pricing.js';
import { normalizeDeliveryZones } from './delivery-zones.js';
import { haversineKm, parseMapUrlCoordsJs } from './eta.js';
import { resolveDeliveryFeeJs } from './delivery-fees.js';

export function newOrderId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const VALID_TYPES = ['delivery', 'pickup', 'dinein'];

function cleanStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

/**
 * Eastern Arabic (٠-٩) + Persian (۰-۹) numerals to Western digits.
 * Mobile Arabic keyboards emit these by default; without this the digit
 * filter below strips them and every Arabic-keyboard phone fails as
 * invalid_phone even though the user typed a correct number.
 */
function westernDigits(v) {
  if (typeof v !== 'string' || !v) return '';
  return v.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return String(code - 0x06f0);
  });
}

/**
 * Strict validation of a public order payload against the live menu.
 * NEVER trusts client prices or names — those always come from the menu.
 * Returns { ok, errors, cleaned } where cleaned is safe to store.
 */
export function validateOrderInput(body, menu) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['bad_payload'], cleaned: null };
  }

  const type = typeof body.type === 'string' ? body.type.trim() : '';
  if (!VALID_TYPES.includes(type)) errors.push('invalid_type');

  const enabledTypes = menu?.settings?.ordering?.types;
  if (Array.isArray(enabledTypes) && !enabledTypes.includes(type)) errors.push('invalid_type');

  const c = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const name = cleanStr(c.name, 60);
  if (name.length < 2) errors.push('invalid_name');

  const phoneDigits = westernDigits(typeof c.phone === 'string' ? c.phone : '').replace(/[^0-9]/g, '');
  if (phoneDigits.length < 6 || phoneDigits.length > 15) errors.push('invalid_phone');

  // Customer email (opt-in, never blocks the order): trim + lowercase +
  // max 254 + simple shape check. Invalid or missing reads as ''.
  const rawEmail = typeof c.email === 'string' ? c.email.trim().toLowerCase().slice(0, 254) : '';
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail) ? rawEmail : '';

  const address = cleanStr(c.address, 200);
  if (type === 'delivery' && !address) errors.push('invalid_address');

  const table = cleanStr(c.table, 10);
  if (type === 'dinein' && !table) errors.push('invalid_table');

  const notes = cleanStr(body.notes, 200);

  // Delivery pin is OPTIONAL (manual addresses allowed): a typed address
  // alone is enough to order. A pin is a precision bonus, never a gate.
  // When omitted/null, the order rides on the address text (Telegram falls
  // back to the address-query link, the fee quote uses no distance).
  // When provided it must be finite numbers in range, rounded to 5
  // decimals. Only for delivery; ignored for other types. Accuracy
  // (meters, from the OS fix) rides along when sane — downstream uses it
  // to distrust coarse cell-tower fixes instead of mislabeling them
  // "precise". Coarse fixes (>250m, mirrors MAPS_ACCURACY_OK_M in
  // telegram.js) are dropped to null so the order stores no pin and
  // Telegram falls back to the address-query link. A present-but-malformed
  // location (truthy non-object, out-of-range numbers) is still rejected
  // as invalid_location to catch tampering.
  let location = null;
  const locRaw = type === 'delivery' ? body.location : undefined;
  if (locRaw === undefined || locRaw === null) {
    location = null;
  } else if (typeof locRaw !== 'object' || Array.isArray(locRaw)) {
    errors.push('invalid_location');
  } else {
    const lat = typeof locRaw.lat === 'number' ? locRaw.lat : NaN;
    const lng = typeof locRaw.lng === 'number' ? locRaw.lng : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      errors.push('invalid_location');
    } else {
      const rawAcc = locRaw.accuracy;
      const acc = typeof rawAcc === 'number' && Number.isFinite(rawAcc) && rawAcc >= 0 && rawAcc <= 100000
        ? Math.round(rawAcc)
        : null;
      if (acc !== null && acc > 250) {
        location = null;
      } else {
        location = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
        if (acc !== null) location.accuracy = acc;
      }
    }
  }

  const lines = Array.isArray(body.items) ? body.items : [];
  if (lines.length < 1 || lines.length > 30) errors.push('invalid_items');

  // Resolve every line against the live menu (reject unknown ids/variants,
  // invalid add-ons or quantities; prices + names always come from the menu).
  const norm = normalizeMenu(menu);
  const menuItems = Array.isArray(norm?.items) ? norm.items : [];

  // Delivery-zone gate (selected zones only): the pin must resolve inside
  // a served country/subdivision AND within maxKm of the restaurant. The
  // client sends its reverse-geocode claim (best effort). A missing or
  // malformed claim is NOT itself a rejection — old cached clients predate
  // zones, so they fall back to the distance backstop alone. The backstop
  // needs no external data and cannot be tampered around: a forged claim
  // can at most deliver to a pin inside the served radius, which is
  // exactly what an honest user could do anyway.
  if (type === 'delivery' && !errors.length) {
    const zones = normalizeDeliveryZones(norm?.settings?.ordering?.deliveryZones);
    if (zones && zones.mode === 'selected') {
      let blocked = false;
      const claim = body.zone && typeof body.zone === 'object' ? body.zone : null;
      const claimCc = claim && typeof claim.cc === 'string' ? claim.cc.trim().toUpperCase() : '';
      if (/^[A-Z]{2}$/.test(claimCc)) {
        const served = zones.countries.find((z) => z && z.cc === claimCc);
        if (!served) {
          blocked = true;
        } else if (served.subdivisions !== 'ALL') {
          const sub = claim && typeof claim.subCode === 'string' ? claim.subCode.trim().toUpperCase()
            : (claim && typeof claim.sub === 'string' ? claim.sub.trim().toUpperCase() : '');
          if (!sub || !/^[A-Za-z0-9-]{2,16}$/.test(sub) || !served.subdivisions.some((a) => a.toUpperCase() === sub)) {
            blocked = true;
          }
        }
      }
      // Distance backstop applies ONLY when a pin is present: a bad pin
      // outside maxKm is blocked, but a missing pin (address-only order)
      // is allowed — the driver confirms the zone by phone.
      if (!blocked && location) {
        try {
          const rest = parseMapUrlCoordsJs(typeof norm?.settings?.mapUrl === 'string' ? norm.settings.mapUrl : '');
          if (rest && Number.isFinite(haversineKm(location.lat, location.lng, rest.lat, rest.lng))) {
            if (haversineKm(location.lat, location.lng, rest.lat, rest.lng) > zones.maxKm) blocked = true;
          }
        } catch {
          blocked = true;
        }
      }
      if (blocked) errors.push('out_of_zone');
    }
  }
  const resolved = [];
  if (lines.length >= 1 && lines.length <= 30) {
    for (const line of lines) {
      if (!line || typeof line !== 'object') {
        errors.push('invalid_items');
        break;
      }
      const id = typeof line.id === 'string' ? line.id : '';
      const found = menuItems.find((m) => m && m.id === id && m.available !== false);
      if (!found) {
        errors.push('invalid_items');
        break;
      }
      const qty = typeof line.qty === 'number' ? line.qty : NaN;

      // Variant: required pick when the item has variants (first = default),
      // rejected when the item has none. Names come from the feature library.
      let variantId;
      let variantName;
      if (hasVariants(found)) {
        const raw = typeof line.variantId === 'string' && line.variantId ? line.variantId : undefined;
        const v = getVariant(found, raw);
        if (!v) {
          errors.push('invalid_variant');
          break;
        }
        variantId = v.featureId;
        const nm = featureName(norm, variantId, 'en');
        const nmAr = featureName(norm, variantId, 'ar');
        variantName = { en: nm, ar: nmAr };
      } else if (typeof line.variantId === 'string' && line.variantId) {
        errors.push('invalid_variant');
        break;
      }

      // Add-ons: must be enabled on the item itself, no duplicates.
      const enabled = itemAddons(found);
      let addonIds = [];
      let addonNames = [];
      if (line.addonIds !== undefined) {
        if (!Array.isArray(line.addonIds)) {
          errors.push('invalid_addon');
          break;
        }
        const seen = new Set();
        let bad = false;
        for (const a of line.addonIds) {
          if (typeof a !== 'string' || seen.has(a) || !enabled.some((x) => x && x.featureId === a)) {
            bad = true;
            break;
          }
          seen.add(a);
        }
        if (bad) {
          errors.push('invalid_addon');
          break;
        }
        addonIds = [...seen];
        addonNames = addonIds.map((a) => ({
          en: featureName(norm, a, 'en'),
          ar: featureName(norm, a, 'ar'),
        }));
      }

      // Badged-spicy items REQUIRE a heat degree (the customer sheet forces
      // exactly one pick): every unit must carry exactly one heat level.
      // Missing or partial heat is REJECTED (heat_required) — never
      // silently dropped — so a tampered or stale request can never record
      // a heatless "spicy" order. Non-badged items keep heat optional.
      const SPICY_IDS = new Set(['spicy', 'spicy-mild', 'spicy-medium', 'spicy-hot']);
      const isBadgedSpicy = found && Array.isArray(found.badges) && found.badges.includes('spicy');
      const heatIds = addonIds.filter((id) => SPICY_IDS.has(id));
      if (isBadgedSpicy && heatIds.length < 1) {
        errors.push('heat_required');
        break;
      }
      let qtySrc = line.addonQty;

      if (!isValidQty(found, qty)) {
        errors.push('invalid_qty');
        break;
      }

      // Split quantities (optional): validated after qty so a bad qty still
      // reports invalid_qty, not invalid_addon. Persisted ONLY when the
      // request carries it (legacy lines store no addonQty key at all).
      let addonQty;
      if (qtySrc !== undefined) {
        if (!qtySrc || typeof qtySrc !== 'object' || Array.isArray(qtySrc)) {
          errors.push('invalid_addon');
          break;
        }
        try {
          validatePicks(norm, found, addonIds, qtySrc, qty);
        } catch {
          errors.push('invalid_addon');
          break;
        }
        const resolved = {};
        for (const a of addonIds) {
          resolved[a] = Object.prototype.hasOwnProperty.call(qtySrc, a) ? qtySrc[a] : qty;
        }
        addonQty = resolved;
        // Badged heat must cover every unit: a qty-2 line with medium×1
        // leaves one unit heatless (medium×1 + hot×1 is the way to split
        // degrees across units). Legacy (no addonQty) lines carry each id
        // at full qty, so exactly one heat id is full coverage.
        if (isBadgedSpicy) {
          let covered = 0;
          for (const a of heatIds) covered += resolved[a];
          if (covered !== qty) {
            errors.push('heat_required');
            break;
          }
        }
      } else if (isBadgedSpicy && heatIds.length !== 1) {
        // Legacy shape: each listed id rides all units, so two heat ids
        // would double-cover (zero is already rejected above).
        errors.push('heat_required');
        break;
      }

      let unit;
      try {
        unit = lineTotal(found, { variantId, addonIds, addonQty, qty });
        unit = round2(unit / qty);
      } catch (e) {
        const code = e && typeof e.message === 'string' ? e.message : 'invalid_items';
        errors.push(['invalid_addon', 'invalid_qty', 'unknown_variant'].includes(code) ? (code === 'unknown_variant' ? 'invalid_variant' : code) : 'invalid_items');
        break;
      }

      // Pricing unit travels with the line so Telegram / tracking /
      // the dashboard can render "2 دستتين" instead of a bare "2x".
      let pricingUnit = 'pc';
      try {
        const pu = normalizePricing(found).unit;
        if (typeof pu === 'string' && pu) pricingUnit = pu;
      } catch {}
      const entry = {
        id: found.id,
        name: {
          en: typeof found.name?.en === 'string' ? found.name.en : '',
          ar: typeof found.name?.ar === 'string' ? found.name.ar : '',
        },
        qty,
        unit: pricingUnit,
        unitPrice: unit,
      };
      if (variantId) {
        entry.variantId = variantId;
        entry.variantName = variantName;
      }
      if (addonIds.length) {
        entry.addonIds = addonIds;
        entry.addonNames = addonNames;
      }
      if (addonQty !== undefined) {
        entry.addonQty = addonQty;
      }
      resolved.push(entry);
    }
  }

  const lang = body.lang === 'ar' ? 'ar' : 'en';
  const idemKey = typeof body.idemKey === 'string' && body.idemKey.trim()
    ? body.idemKey.trim().slice(0, 128)
    : null;

  // Payment method: whitelist + fail-safe default. Today only 'cod'
  // exists (cash on delivery, pending until the courier collects). Any
  // absent/unknown value falls back to 'cod' — never errors, never trusts
  // the client for a future 'paid' state. Online gateways will extend
  // ALLOWED_METHODS, never change this default.
  const ALLOWED_PAYMENT_METHODS = ['cod'];
  const rawMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim().toLowerCase() : '';
  const paymentMethod = ALLOWED_PAYMENT_METHODS.includes(rawMethod) ? rawMethod : 'cod';
  const paymentStatus = 'pending';

  if (errors.length > 0) return { ok: false, errors, cleaned: null };

  let subtotal = 0;
  for (const r of resolved) subtotal += r.unitPrice * r.qty;

  // Ordering rules come from the NORMALIZED menu so menus without explicit
  // enable-flags (a positive value means enabled) enforce min order + fee.
  const ordering = norm?.settings?.ordering || {};
  if (ordering.enabled === false) return { ok: false, errors: ['ordering_disabled'], cleaned: null };

  if (ordering.minOrderEnabled && typeof ordering.minOrder === 'number' && ordering.minOrder > 0 && subtotal < ordering.minOrder) {
    return { ok: false, errors: ['min_order'], cleaned: null, minOrder: round2(ordering.minOrder) };
  }

  const deliveryFee = type === 'delivery' && ordering.deliveryFeeEnabled
    ? (() => {
        // Smart distance fee: authoritative server computation from the
        // trusted pin (client totals are never trusted). Unknown distance
        // (no pin / no restaurant coords) resolves to the highest tier
        // (fail-closed) via resolveDeliveryFeeJs — never free by accident.
        let distanceKm = null;
        try {
          if (location) {
            const rest = parseMapUrlCoordsJs(typeof norm?.settings?.mapUrl === 'string' ? norm.settings.mapUrl : '');
            if (rest) {
              const km = haversineKm(location.lat, location.lng, rest.lat, rest.lng);
              if (Number.isFinite(km) && km >= 0) distanceKm = km;
            }
          }
        } catch {}
        return resolveDeliveryFeeJs(ordering, distanceKm, subtotal).fee;
      })()
    : 0;

  return {
    ok: true,
    errors: [],
    cleaned: {
      type,
      name,
      phone: phoneDigits,
      phoneNorm: phoneDigits,
      email,
      address: address || null,
      table: table || null,
      notes: notes || null,
      location,
      items: resolved,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      lang,
      idemKey,
      paymentMethod,
      paymentStatus,
    },
  };
}

/**
 * Canonical phone for follow-up matching (pure, no DB).
 * Strips non-digits, drops a leading international `00` (so `0020…` and
 * `20…` compare equal), keeps the rest verbatim. Never throws — garbage
 * yields '' so callers fail closed (no link).
 */
export function canonicalLinkPhone(v) {
  if (typeof v !== 'string' || !v) return '';
  const digits = v.replace(/[^0-9]/g, '');
  if (!digits) return '';
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

/**
 * Same-customer test for the follow-up link (pure, unit-testable).
 * Exact match wins; otherwise a shared suffix of 9 (then 7) digits catches
 * the `01…` (local) vs `20…` (international) Egyptian shape and the
 * `03…` vs `961…` Lebanese shape without ever merging strangers.
 * Both numbers must carry at least 7 digits — shorter fragments never link.
 */
export function isSameCustomerPhone(a, b) {
  const x = canonicalLinkPhone(a);
  const y = canonicalLinkPhone(b);
  if (!x || !y || x.length < 7 || y.length < 7) return false;
  if (x === y) return true;
  for (const k of [9, 7]) {
    if (x.length >= k && y.length >= k && x.slice(-k) === y.slice(-k)) return true;
  }
  return false;
}

/** Map a D1 row to the camelCase Order shape the dashboard expects. */
export function mapOrderRow(row) {
  let items = [];
  try {
    const parsed = JSON.parse(row.items_json || '[]');
    if (Array.isArray(parsed)) items = parsed;
  } catch {}
  return {
    id: row.id,
    number: row.number,
    createdAt: row.created_at,
    status: row.status,
    type: row.type,
    // Confirm + smart-ETA instants (migration 0022, nullable — legacy rows
    // keep NULL until re-confirmed; always present as null-or-string so the
    // dashboard/public shapes never shift keys).
    confirmedAt: row.confirmed_at || null,
    etaAt: row.eta_at || null,
    // Follow-up link (migration 0023, nullable — legacy rows keep NULL and
    // read as standalone; always present as number-or-null so the dashboard
    // shape never shifts keys).
    parentNumber: Number.isInteger(row.parent_number) ? row.parent_number : null,
    // Last status actor (migration 0029, nullable — legacy rows and
    // owner-touched rows keep NULL and read as null; kitchen/client
    // touches read as the login name. Always present as string-or-null
    // so the dashboard shape never shifts keys; the UI hides null).
    updatedBy: typeof row.updated_by === 'string' && row.updated_by ? row.updated_by : null,
    customer: {
      name: row.customer_name || '',
      phone: row.customer_phone || '',
      // Email is opt-in: only present when non-empty so legacy rows and
      // email-less orders keep the exact pre-0024 API shape (no '' key).
      ...(typeof row.customer_email === 'string' && row.customer_email ? { email: row.customer_email } : {}),
      ...(row.customer_address ? { address: row.customer_address } : {}),
      ...(row.customer_table ? { table: row.customer_table } : {}),
    },
    // فحص الاستلام: يظهر فقط عند التعيين (مثل البريد الاختياري فوق).
    // Receipt-check stamp: key absent when NULL, ISO string when set.
    ...(row.receipt_asked_at ? { receiptAskedAt: row.receipt_asked_at } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.location_lat !== null && row.location_lat !== undefined && row.location_lng !== null && row.location_lng !== undefined
      ? { location: { lat: row.location_lat, lng: row.location_lng } }
      : {}),
    items,
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
    // Payment (migration 0031): legacy rows predate the columns and read
    // as COD/pending — the same fail-safe default the validator applies.
    paymentMethod: typeof row.payment_method === 'string' && row.payment_method ? row.payment_method : 'cod',
    paymentStatus: typeof row.payment_status === 'string' && row.payment_status ? row.payment_status : 'pending',
    ...(row.lang ? { lang: row.lang } : {}),
    ...(row.track_token ? { trackToken: row.track_token } : {}),
  };
}
