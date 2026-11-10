/**
 * Customer-facing order-progress phases for the bell widget + track page.
 *
 * Pure (no React, no DOM) so the rules stay unit-testable — see
 * scripts/test-track-phases.mjs. Both surfaces MUST use these helpers
 * (never inline `5 * 60 * 1000`) so the bell and the track page can never
 * disagree about which message a `new` order shows.
 *
 * Timeline for a `new` order:
 *  1. inside the customer-cancel window  -> "your order will be accepted
 *     after the cancellation window ends" + live countdown;
 *  2. window elapsed, kitchen silent     -> "waiting for your order
 *     to be accepted" (static, no countdown);
 *  3. confirmed/ready + locked           -> handled by the callers with
 *     the server-computed `receivableAt` (not here).
 */

/** Customer self-cancel window: a `new` order may still be cancelled.
 *  Kept as the default for backwards compatibility (old callers + old
 *  menus without the tunable); the admin setting
 *  `settings.ordering.cancelWindowMin` (1..30 min) overrides it wherever
 *  the menu is available. */
export const CUSTOMER_CANCEL_WINDOW_MS = 5 * 60 * 1000;

/** Default cancel window in whole minutes (mirrors the setting default). */
export const CANCEL_WINDOW_MIN_DEFAULT = 5;

/**
 * Coerce a raw `cancelWindowMin` (minutes) to the allowed 1..30 range.
 * Zero/blank/non-finite/out-of-range in old docs falls back to 5 so
 * legacy menus behave exactly as today.
 */
export function cancelWindowMinOrDefault(v: unknown, fallback = CANCEL_WINDOW_MIN_DEFAULT): number {
  const fb = Number.isFinite(fallback) ? (fallback as number) : CANCEL_WINDOW_MIN_DEFAULT;
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 30 ? Math.round(v) : fb;
}

/**
 * Resolve the cancel window (ms) from a menu ordering block.
 * Never throws — garbage input yields the 5-minute default.
 */
export function cancelWindowMsFromOrdering(ordering: unknown): number {
  try {
    const o = (ordering && typeof ordering === 'object' ? ordering : {}) as { cancelWindowMin?: unknown };
    return cancelWindowMinOrDefault(o.cancelWindowMin) * 60000;
  } catch {
    return CUSTOMER_CANCEL_WINDOW_MS;
  }
}

/** Resolve the cancel window (ms) from the raw `/api/menu` doc shape. */
export function cancelWindowMsFromMenu(menu: unknown): number {
  try {
    const m = (menu && typeof menu === 'object' ? menu : {}) as {
      settings?: { ordering?: unknown };
    };
    return cancelWindowMsFromOrdering(m.settings?.ordering);
  } catch {
    return CUSTOMER_CANCEL_WINDOW_MS;
  }
}

/** Resolve a finite window (ms), falling back to the 5-minute default. */
function windowOrDefault(windowMs: unknown): number {
  return typeof windowMs === 'number' && Number.isFinite(windowMs) && windowMs > 0
    ? windowMs
    : CUSTOMER_CANCEL_WINDOW_MS;
}

/** Absolute instant (epoch ms) the cancel window ends, or null when the
 *  creation time is missing/unparseable (caller falls back to phase 2). */
export function cancelWindowEndsAt(
  createdAt: string | null | undefined,
  windowMs: number = CUSTOMER_CANCEL_WINDOW_MS,
): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  return Number.isNaN(t) ? null : t + windowOrDefault(windowMs);
}

/**
 * Milliseconds left in the cancel window. Returns null when the creation
 * time is unknown (caller shows the static phase-2 copy), otherwise the
 * signed remainder — callers treat `> 0` as phase 1 (live countdown) and
 * anything else as phase 2.
 */
export function cancelWindowRemainingMs(
  createdAt: string | null | undefined,
  nowMs: number,
  windowMs: number = CUSTOMER_CANCEL_WINDOW_MS,
): number | null {
  const end = cancelWindowEndsAt(createdAt, windowMs);
  if (end === null) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return end - now;
}

/** True while a `new` order is still inside its cancel window — the only
 *  case that needs a 1 s display ticker. Anything else renders static. */
export function isInCancelWindow(
  status: string,
  createdAt: string | null | undefined,
  nowMs: number,
  windowMs: number = CUSTOMER_CANCEL_WINDOW_MS,
): boolean {
  if (status !== 'new') return false;
  const remaining = cancelWindowRemainingMs(createdAt, nowMs, windowMs);
  return remaining !== null && remaining > 0;
}
