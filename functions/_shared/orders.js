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

  const address = cleanStr(c.address, 200);
  if (type === 'delivery' && !address) errors.push('invalid_address');

  const table = cleanStr(c.table, 10);
  if (type === 'dinein' && !table) errors.push('invalid_table');

  const notes = cleanStr(body.notes, 200);

  // Optional delivery coordinates: finite numbers in range, rounded to
  // 5 decimals. Only for delivery; ignored for other types. Accuracy
  // (meters, from the OS fix) rides along when sane — downstream uses it
  // to distrust coarse cell-tower fixes instead of mislabeling them
  // "precise". Never blocks the order; never stored (transient hint).
  // Coarse fixes (>250m, mirrors MAPS_ACCURACY_OK_M in telegram.js) are
  // dropped to null so the order stores no pin and Telegram falls back to
  // the address-query link. Storing them would upgrade to a fake "exact"
  // pin after the DB round-trip (accuracy column does not exist, and a
  // missing accuracy reads as sharp) — the WRONG-pin bug on remembered
  // coarse pins.
  let location = null;
  if (type === 'delivery' && body.location && typeof body.location === 'object') {
    const lat = typeof body.location.lat === 'number' ? body.location.lat : NaN;
    const lng = typeof body.location.lng === 'number' ? body.location.lng : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      errors.push('invalid_location');
    } else {
      const rawAcc = body.location.accuracy;
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

      if (!isValidQty(found, qty)) {
        errors.push('invalid_qty');
        break;
      }

      // Split quantities (optional): validated after qty so a bad qty still
      // reports invalid_qty, not invalid_addon. Persisted ONLY when the
      // request carries it (legacy lines store no addonQty key at all).
      let addonQty;
      if (line.addonQty !== undefined) {
        if (!line.addonQty || typeof line.addonQty !== 'object' || Array.isArray(line.addonQty)) {
          errors.push('invalid_addon');
          break;
        }
        try {
          validatePicks(norm, found, addonIds, line.addonQty, qty);
        } catch {
          errors.push('invalid_addon');
          break;
        }
        const resolved = {};
        for (const a of addonIds) {
          resolved[a] = Object.prototype.hasOwnProperty.call(line.addonQty, a) ? line.addonQty[a] : qty;
        }
        addonQty = resolved;
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
    ? round2(Number(ordering.deliveryFee) || 0)
    : 0;

  return {
    ok: true,
    errors: [],
    cleaned: {
      type,
      name,
      phone: phoneDigits,
      phoneNorm: phoneDigits,
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
    },
  };
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
    customer: {
      name: row.customer_name || '',
      phone: row.customer_phone || '',
      ...(row.customer_address ? { address: row.customer_address } : {}),
      ...(row.customer_table ? { table: row.customer_table } : {}),
    },
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.location_lat !== null && row.location_lat !== undefined && row.location_lng !== null && row.location_lng !== undefined
      ? { location: { lat: row.location_lat, lng: row.location_lng } }
      : {}),
    items,
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
    ...(row.lang ? { lang: row.lang } : {}),
    ...(row.track_token ? { trackToken: row.track_token } : {}),
  };
}
