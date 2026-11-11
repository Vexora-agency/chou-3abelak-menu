import type { DeliveryFeeTier, MenuSettings } from '@/src/types/menu';

/** Smart distance-based delivery fees (client copy).
 *  TWIN: functions/_shared/delivery-fees.js — keep behavior identical.
 *  Pure functions only. Never throws.
 */

export const DELIVERY_FEE_TIERS_MAX = 8;
export const DELIVERY_FEE_UPTO_MIN_KM = 0.1;
export const DELIVERY_FEE_UPTO_MAX_KM = 2000;
export const DELIVERY_FEE_MAX = 50000000;

/** Bank-safe rounding to 2 decimals. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Normalize tiers: drop garbage, clamp ranges, sort ascending by upToKm,
 *  dedupe equal caps (keep the lowest fee), cap at 8 bands. */
export function normalizeDeliveryFeeTiers(v: unknown): DeliveryFeeTier[] {
  if (!Array.isArray(v)) return [];
  const rows: DeliveryFeeTier[] = [];
  for (const t of v) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    const up = typeof r.upToKm === 'number' && Number.isFinite(r.upToKm) ? r.upToKm : NaN;
    const fee = typeof r.fee === 'number' && Number.isFinite(r.fee) ? r.fee : NaN;
    if (!Number.isFinite(up) || !Number.isFinite(fee)) continue;
    if (up < DELIVERY_FEE_UPTO_MIN_KM || up > DELIVERY_FEE_UPTO_MAX_KM) continue;
    if (fee < 0 || fee > DELIVERY_FEE_MAX) continue;
    rows.push({ upToKm: Math.round(up * 10) / 10, fee: round2(Math.max(0, fee)) });
  }
  rows.sort((a, b) => a.upToKm - b.upToKm || a.fee - b.fee);
  const out: DeliveryFeeTier[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && prev.upToKm === r.upToKm) continue; // sorted → first is cheapest
    out.push(r);
    if (out.length >= DELIVERY_FEE_TIERS_MAX) break;
  }
  return out;
}

export type DeliveryFeeMode = 'flat' | 'distance';

export function feeModeOrDefault(v: unknown, tiers: DeliveryFeeTier[]): DeliveryFeeMode {
  if (v === 'distance' && tiers.length > 0) return 'distance';
  return 'flat';
}

export interface DeliveryFeeQuote {
  fee: number;
  /** Index of the matched tier (-1 = flat / free / disabled). */
  tierIndex: number;
  /** Effective distance used (null = unknown → highest tier). */
  distanceKm: number | null;
  freeApplied: boolean;
}

/**
 * Single source of truth for the customer-facing + server fee.
 * - Disabled → 0.
 * - Free-delivery threshold (both modes): subtotal >= min → 0.
 * - Flat mode (or empty tiers): legacy `deliveryFee`.
 * - Distance mode: first tier with distance <= upToKm; beyond last → last
 *   tier; unknown distance (no pin / no restaurant coords) → highest tier
 *   (fail-closed: never grant a cheap/zero fee on an unmeasurable order).
 */
export function resolveDeliveryFee(
  ordering: Pick<
    MenuSettings['ordering'],
    'deliveryFee' | 'deliveryFeeEnabled' | 'deliveryFeeMode' | 'deliveryFeeTiers' | 'freeDeliveryMin' | 'freeDeliveryEnabled'
  > | null | undefined,
  distanceKm: number | null | undefined,
  subtotal: number,
): DeliveryFeeQuote {
  const o = (ordering && typeof ordering === 'object' ? ordering : {}) as Record<string, unknown>;
  if (o.deliveryFeeEnabled !== true) return { fee: 0, tierIndex: -1, distanceKm: null, freeApplied: false };
  const sub = typeof subtotal === 'number' && Number.isFinite(subtotal) ? subtotal : 0;
  const freeMin = typeof o.freeDeliveryMin === 'number' && Number.isFinite(o.freeDeliveryMin) ? o.freeDeliveryMin : 0;
  if (o.freeDeliveryEnabled === true && freeMin > 0 && sub >= freeMin) {
    return { fee: 0, tierIndex: -1, distanceKm: normDist(distanceKm), freeApplied: true };
  }
  const flat = typeof o.deliveryFee === 'number' && Number.isFinite(o.deliveryFee) ? round2(Math.max(0, o.deliveryFee)) : 0;
  const tiers = normalizeDeliveryFeeTiers(o.deliveryFeeTiers);
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

function normDist(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Human range label for tier i: "0–2 km", "2–5 km", "10+ km". */
export function tierRangeLabel(tiers: DeliveryFeeTier[], i: number, lang: 'en' | 'ar'): string {
  const t = tiers[i];
  if (!t) return '';
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
  const unit = lang === 'ar' ? 'كم' : 'km';
  if (i === tiers.length - 1) {
    if (i === 0) return lang === 'ar' ? `حتى ${fmt(t.upToKm)} ${unit}` : `Up to ${fmt(t.upToKm)} ${unit}`;
    return lang === 'ar'
      ? `من ${fmt(tiers[i - 1].upToKm)} إلى ${fmt(t.upToKm)} ${unit} وما بعد`
      : `${fmt(tiers[i - 1].upToKm)}–${fmt(t.upToKm)} ${unit} and beyond`;
  }
  if (i === 0) return lang === 'ar' ? `حتى ${fmt(t.upToKm)} ${unit}` : `Up to ${fmt(t.upToKm)} ${unit}`;
  return lang === 'ar'
    ? `من ${fmt(tiers[i - 1].upToKm)} إلى ${fmt(t.upToKm)} ${unit}`
    : `${fmt(tiers[i - 1].upToKm)}–${fmt(t.upToKm)} ${unit}`;
}
