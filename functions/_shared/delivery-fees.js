/**
 * Smart distance-based delivery fees (server copy, no dependencies).
 * TWIN: src/utils/deliveryFees.ts — keep behavior identical.
 * Pure functions only. Never throws.
 */

export const DELIVERY_FEE_TIERS_MAX = 8;
export const DELIVERY_FEE_UPTO_MIN_KM = 0.1;
export const DELIVERY_FEE_UPTO_MAX_KM = 2000;
export const DELIVERY_FEE_MAX = 50000000;

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Normalize tiers: drop garbage, clamp ranges, sort ascending by upToKm,
 *  dedupe equal caps (keep the lowest fee), cap at 8 bands. */
export function normalizeDeliveryFeeTiersJs(v) {
  if (!Array.isArray(v)) return [];
  const rows = [];
  for (const t of v) {
    if (!t || typeof t !== 'object') continue;
    const up = typeof t.upToKm === 'number' && Number.isFinite(t.upToKm) ? t.upToKm : NaN;
    const fee = typeof t.fee === 'number' && Number.isFinite(t.fee) ? t.fee : NaN;
    if (!Number.isFinite(up) || !Number.isFinite(fee)) continue;
    if (up < DELIVERY_FEE_UPTO_MIN_KM || up > DELIVERY_FEE_UPTO_MAX_KM) continue;
    if (fee < 0 || fee > DELIVERY_FEE_MAX) continue;
    rows.push({ upToKm: Math.round(up * 10) / 10, fee: round2(Math.max(0, fee)) });
  }
  rows.sort((a, b) => a.upToKm - b.upToKm || a.fee - b.fee);
  const out = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && prev.upToKm === r.upToKm) continue;
    out.push(r);
    if (out.length >= DELIVERY_FEE_TIERS_MAX) break;
  }
  return out;
}

function normDist(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Single source of truth for the server fee (mirrors the client resolver).
 * - Disabled → 0. Free threshold → 0. Flat mode (or empty tiers) → flat fee.
 * - Distance mode: first tier with distance <= upToKm; beyond last → last
 *   tier; unknown distance → highest tier (fail-closed).
 */
export function resolveDeliveryFeeJs(ordering, distanceKm, subtotal) {
  const o = ordering && typeof ordering === 'object' ? ordering : {};
  if (o.deliveryFeeEnabled !== true) return { fee: 0, tierIndex: -1, distanceKm: null, freeApplied: false };
  const sub = typeof subtotal === 'number' && Number.isFinite(subtotal) ? subtotal : 0;
  const freeMin = typeof o.freeDeliveryMin === 'number' && Number.isFinite(o.freeDeliveryMin) ? o.freeDeliveryMin : 0;
  if (o.freeDeliveryEnabled === true && freeMin > 0 && sub >= freeMin) {
    return { fee: 0, tierIndex: -1, distanceKm: normDist(distanceKm), freeApplied: true };
  }
  const flat = typeof o.deliveryFee === 'number' && Number.isFinite(o.deliveryFee) ? round2(Math.max(0, o.deliveryFee)) : 0;
  const tiers = normalizeDeliveryFeeTiersJs(o.deliveryFeeTiers);
  if (o.deliveryFeeMode !== 'distance' || tiers.length === 0) {
    return { fee: flat, tierIndex: -1, distanceKm: normDist(distanceKm), freeApplied: false };
  }
  const d = normDist(distanceKm);
  if (d === null) {
    return { fee: tiers[tiers.length - 1].fee, tierIndex: tiers.length - 1, distanceKm: null, freeApplied: false };
  }
  for (let i = 0; i < tiers.length; i++) {
    if (d <= tiers[i].upToKm) return { fee: tiers[i].fee, tierIndex: i, distanceKm: d, freeApplied: false };
  }
  return { fee: tiers[tiers.length - 1].fee, tierIndex: tiers.length - 1, distanceKm: d, freeApplied: false };
}
