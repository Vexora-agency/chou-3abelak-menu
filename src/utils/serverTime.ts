/**
 * serverNow(): device-clock-independent clock for every time comparison
 * (banner expiry, open/closed text). The offset is learned from the HTTP
 * Date response header of /api/menu and /api/ordering-state, so a wrong
 * phone clock cannot show or hide anything incorrectly.
 */

let offsetMs = 0;

/** Feed a Date response header value (or null when absent/unparseable). */
export function setServerOffsetFromDateHeader(dateHeader: string | null): void {
  if (!dateHeader) return;
  const t = Date.parse(dateHeader);
  if (!Number.isFinite(t)) return;
  // Clamp absurd jumps (more than a day) to a wrong header, not time travel.
  const off = t - Date.now();
  if (Math.abs(off) > 86400000) return;
  offsetMs = off;
}

/** Now, corrected to server time when a header was seen. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
