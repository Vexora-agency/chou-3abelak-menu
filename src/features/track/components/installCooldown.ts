/**
 * Dismiss-cooldown for the track-page install card. Pure helpers take
 * explicit args (no DOM at import time) so they stay unit-testable; the
 * localStorage wrappers are thin try/catch shells (private mode must not
 * throw).
 */

export const INSTALL_DISMISS_KEY = 'track_install_dismissed_v1';

/** 7 days in ms — a dismissed card stays quiet for exactly this long. */
export const INSTALL_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** True while a stored dismiss timestamp is still inside the cooldown. */
export function isCooldownActive(storedRaw: string | null | undefined, nowMs: number): boolean {
  if (!storedRaw) return false;
  const at = Number(storedRaw);
  if (!Number.isFinite(at) || at <= 0) return false;
  // Future stamp (clock moved backwards): stay hidden, never crash.
  if (at > nowMs) return true;
  return nowMs - at < INSTALL_DISMISS_COOLDOWN_MS;
}

/** Read path used by the card's initial state. */
export function readInstallDismissed(): boolean {
  try {
    return isCooldownActive(window.localStorage.getItem(INSTALL_DISMISS_KEY), Date.now());
  } catch {
    return false;
  }
}

/** Write path used by the card's X button. */
export function writeInstallDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode — the card just returns next visit */
  }
}
