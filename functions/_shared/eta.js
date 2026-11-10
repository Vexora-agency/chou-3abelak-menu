/**
 * Smart ETA + receive-unlock helpers (pure, no dependencies).
 *
 * Single source of truth for the ordering ETA tunables that live under
 * `settings.ordering` (validated in ./validate-settings.js, normalized in
 * ./pricing-menu.js). Field names are a cross-agent contract with the admin
 * UI — do NOT rename: prepMinutes, kitchenMinutesPerOrder, courierSpeedKmh,
 * roadFactor, defaultDeliveryMinutes, receiveDelayDeliveryMin,
 * receiveDelayPickupMin, cancelWindowMin.
 *
 * Works in Cloudflare Workers and Node (no imports). The coordinate parser
 * below is a plain-JS twin of parseMapUrlCoords() in
 * src/utils/menuHelpers.ts — keep the two in sync (same shapes, same ranges).
 */

/** Defaults applied when a menu predates the ETA settings or omits them. */
export const ETA_DEFAULTS = Object.freeze({
  prepMinutes: 15,
  kitchenMinutesPerOrder: 3,
  courierSpeedKmh: 25,
  roadFactor: 1.35,
  defaultDeliveryMinutes: 20,
  receiveDelayDeliveryMin: 30,
  receiveDelayPickupMin: 15,
  cancelWindowMin: 5,
});

/**
 * Grace buffer after the computed ETA before the customer may tap
 * "received". Covers real-world variance (traffic lights, handoff at the
 * door) without ever trapping: the unlock instant is always ETA + this,
 * never earlier. Industry tolerance is far more generous (Talabat allows
 * cancellation only after +20 min past promise), so +5 never angers —
 * it protects against Beirut signal jitter.
 */
export const RECEIVE_BUFFER_MIN = 5;

function numOr(v, fb) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fb;
}

function clampNum(v, fb, min, max) {
  const n = numOr(v, fb);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Coerce an ordering block's ETA tunables with server-side range clamps
 * (minutes 0..180, speed 5..120, factor 1.0..2.0, delays 0..720,
 * cancel window 1..30).
 * Missing/non-finite values fall back to ETA_DEFAULTS. Never throws —
 * null/garbage input yields pure defaults so unlock paths fail open.
 */
export function orderingEtaOrDefaults(ordering) {
  const o = ordering && typeof ordering === 'object' ? ordering : {};
  return {
    prepMinutes: clampNum(o.prepMinutes, ETA_DEFAULTS.prepMinutes, 0, 180),
    kitchenMinutesPerOrder: clampNum(o.kitchenMinutesPerOrder, ETA_DEFAULTS.kitchenMinutesPerOrder, 0, 180),
    courierSpeedKmh: clampNum(o.courierSpeedKmh, ETA_DEFAULTS.courierSpeedKmh, 5, 120),
    roadFactor: clampNum(o.roadFactor, ETA_DEFAULTS.roadFactor, 1.0, 2.0),
    defaultDeliveryMinutes: clampNum(o.defaultDeliveryMinutes, ETA_DEFAULTS.defaultDeliveryMinutes, 0, 180),
    receiveDelayDeliveryMin: clampNum(o.receiveDelayDeliveryMin, ETA_DEFAULTS.receiveDelayDeliveryMin, 0, 720),
    receiveDelayPickupMin: clampNum(o.receiveDelayPickupMin, ETA_DEFAULTS.receiveDelayPickupMin, 0, 720),
    cancelWindowMin: Math.round(clampNum(o.cancelWindowMin, ETA_DEFAULTS.cancelWindowMin, 1, 30)),
  };
}

/**
 * Receive delay for an order type (minutes): delivery gets the courier
 * window, everything else (pickup/dinein — the customer is already at the
 * counter) gets the shorter pickup window.
 * FALLBACK-ONLY since the ETA+5 rule: used solely when an order carries no
 * usable etaAt (legacy rows). Normal orders never consult these tunables.
 */
export function receiveDelayMinFor(orderType, settings) {
  const s = orderingEtaOrDefaults(settings);
  return orderType === 'delivery' ? s.receiveDelayDeliveryMin : s.receiveDelayPickupMin;
}

/**
 * Extract `lat,lng` from a Google Maps URL in any common shape (server twin
 * of the client's parseMapUrlCoords — same regexes, same ranges):
 * bare "lat,lng" · ?q= / ?query= / ?api=1&query= · ?ll= / ?center= ·
 * directions ?destination= / ?origin= / ?saddr= / ?daddr= ·
 * path "@lat,lng,zoom" · data "…!3dlat!4dlng" ·
 * DMS "33°52'29.1"N 35°32'44.5"E" (decoded or URL-encoded, hemisphere
 * suffixes optional — a missing suffix reads positive).
 * Short links (maps.app.goo.gl) carry no coords → null. Null when absent.
 */
export function parseMapUrlCoordsJs(url) {
  if (typeof url !== 'string' || !url) return null;
  const clean = url.trim();
  if (!clean) return null;
  const inRange = (lat, lng) =>
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const pair = (a, b) => {
    if (a === undefined || b === undefined) return null;
    const lat = Number(a);
    const lng = Number(b);
    return inRange(lat, lng) ? { lat, lng } : null;
  };
  let m = clean.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return pair(m[1], m[2]);
  m = clean.match(/[?&](?:q|query|ll|center|destination|origin|saddr|daddr)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return pair(m[1], m[2]);
  m = clean.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|$|[?/])/);
  if (m) return pair(m[1], m[2]);
  m = clean.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return pair(m[1], m[2]);
  // DMS "33°52'29.1"N 35°32'44.5"E" — the shape Google Maps copies in
  // degrees mode (often URL-encoded, sometimes pasted truncated without
  // the trailing "E). Decoded first so %C2%B0/%22 forms parse identically.
  // Suffixes optional (missing = positive); minutes/seconds range-checked
  // so free text never matches.
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  m = decoded.match(/(\d{1,3})\s*[°ºdD]\s*(\d{1,2})\s*['′’mM]\s*(\d+(?:\.\d+)?)\s*(?:"|″|”|s|S)?\s*([NSns])?\s*[,;]?\s*(\d{1,3})\s*[°ºdD]\s*(\d{1,2})\s*['′’mM]\s*(\d+(?:\.\d+)?)\s*(?:"|″|”|s|S)?\s*([EWew])?/);
  if (m) {
    const dms = (deg, min, sec, hemi, neg) => {
      const dd = Number(deg);
      const mm = Number(min);
      const ss = Number(sec);
      if (!Number.isFinite(dd) || mm >= 60 || ss >= 60) return NaN;
      let v = dd + mm / 60 + ss / 3600;
      if (String(hemi || '').toUpperCase() === neg) v = -v;
      return v;
    };
    const lat = dms(m[1], m[2], m[3], m[4], 'S');
    const lng = dms(m[5], m[6], m[7], m[8], 'W');
    if (inRange(lat, lng)) return { lat, lng };
  }
  return null;
}

/** Great-circle distance in kilometres (haversine). */
export function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const t = Math.PI / 180;
  const dLat = (bLat - aLat) * t;
  const dLng = (bLng - aLng) * t;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Order → restaurant distance in km, or null when it cannot be computed
 * (non-delivery types don't travel — callers treat non-delivery as 0
 * travel; here null simply means "no precise distance, use the default").
 * Restaurant coords come from the ALREADY-LOADED menu
 * (`menu.settings.mapUrl`); the order's own stored location_lat/lng.
 * Deliberately uncapped: every pin computes its true distance, however
 * far — computeEta floors at 10 minutes but never caps above, so a wrong
 * estimate stays visible and investigable instead of hiding behind a cap.
 * Pure — no KV/D1 reads (callers piggyback their existing menu fetch).
 */
export function orderDistanceKm(orderRow, menu) {
  try {
    const r = orderRow && typeof orderRow === 'object' ? orderRow : null;
    // Strict number check: Number(null) === 0 would fake a Gulf-of-Guinea
    // fix for orders without a stored location — those must stay null.
    const lat = r && typeof r.location_lat === 'number' ? r.location_lat : NaN;
    const lng = r && typeof r.location_lng === 'number' ? r.location_lng : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const mapUrl = menu && menu.settings ? menu.settings.mapUrl : null;
    const rest = parseMapUrlCoordsJs(typeof mapUrl === 'string' ? mapUrl : '');
    if (!rest) return null;
    const km = haversineKm(lat, lng, rest.lat, rest.lng);
    if (!Number.isFinite(km) || km < 0) return null;
    return km;
  } catch {
    return null;
  }
}

/**
 * Receive-unlock instant (ms epoch) for a customer "received" tap.
 * Smart rule: unlock = etaAt + RECEIVE_BUFFER_MIN. The ETA already encodes
 * prep + queue + route, so the unlock scales with the real wait instead of
 * a fixed per-type delay — no setting for the owner to misjudge.
 * Fallback (legacy/corrupt rows with no usable etaAt): the old guarantee
 * unlock = max((confirmed_at ?? created_at) + delay[type], -inf), i.e.
 * immediately receivable in practice — old orders are NEVER trapped.
 * A corrupt/missing created_at fails open to `nowMs` (receivable now).
 * Pure — same function feeds GET /api/track, POST /api/track/batch and
 * POST /api/track/received so the three can never disagree.
 */
export function receivableAtMs(input) {
  const o = input && typeof input === 'object' ? input : {};
  const now = Number.isFinite(o.nowMs) ? o.nowMs : Date.now();
  const eta = Date.parse(typeof o.etaAt === 'string' ? o.etaAt : '');
  if (Number.isFinite(eta)) return eta + RECEIVE_BUFFER_MIN * 60000;
  let base = Date.parse(typeof o.confirmedAt === 'string' ? o.confirmedAt : '');
  if (!Number.isFinite(base)) base = Date.parse(typeof o.createdAt === 'string' ? o.createdAt : '');
  if (!Number.isFinite(base)) base = now;
  const delayMin = receiveDelayMinFor(o.orderType, o.settings);
  return base + delayMin * 60000;
}

/**
 * Joint-delivery unlock for a follow-up order (pure).
 * The child keeps its own kitchen ticket, but the courier carries both
 * together — so the customer may confirm the child as soon as EITHER the
 * child or its still-active parent becomes receivable. Returns the earlier
 * of the two instants (or the own instant when the parent is gone/done).
 * Pure — same helper feeds GET /api/track, POST /api/track/batch and
 * POST /api/track/received so the three surfaces can never disagree.
 */
export function linkedReceivableAtMs(ownMs, parentRow, settings, nowMs) {
  const own = Number.isFinite(ownMs) ? ownMs : Infinity;
  try {
    const p = parentRow && typeof parentRow === 'object' ? parentRow : null;
    if (!p) return own;
    const st = typeof p.status === 'string' ? p.status : '';
    if (st !== 'new' && st !== 'confirmed' && st !== 'ready') return own;
    const parentMs = receivableAtMs({
      confirmedAt: typeof p.confirmed_at === 'string' ? p.confirmed_at : null,
      createdAt: typeof p.created_at === 'string' ? p.created_at : null,
      etaAt: typeof p.eta_at === 'string' ? p.eta_at : null,
      orderType: typeof p.type === 'string' ? p.type : 'delivery',
      settings,
      nowMs,
    });
    if (!Number.isFinite(parentMs)) return own;
    return Math.min(own, parentMs);
  } catch {
    return own;
  }
}
