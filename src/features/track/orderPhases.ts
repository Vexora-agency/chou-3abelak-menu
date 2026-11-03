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

/** Customer self-cancel window: a `new` order may still be cancelled. */
export const CUSTOMER_CANCEL_WINDOW_MS = 5 * 60 * 1000;

/** Absolute instant (epoch ms) the cancel window ends, or null when the
 *  creation time is missing/unparseable (caller falls back to phase 2). */
export function cancelWindowEndsAt(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  return Number.isNaN(t) ? null : t + CUSTOMER_CANCEL_WINDOW_MS;
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
): number | null {
  const end = cancelWindowEndsAt(createdAt);
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
): boolean {
  if (status !== 'new') return false;
  const remaining = cancelWindowRemainingMs(createdAt, nowMs);
  return remaining !== null && remaining > 0;
}
