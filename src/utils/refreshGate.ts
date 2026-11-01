/**
 * Event-driven refresh gate: stops focus/visibility/pageshow storms from
 * turning into request storms.
 *
 * Root cause it fixes: every window `focus` (keyboard show/hide per input
 * on iOS, app switches, notification shade, toolbar toggles) used to fire
 * an immediate `/api/menu` + `/api/ordering-state` (+ N order-track)
 * fetch, AND reset the 120 s fast-poll window — so normal phone tapping
 * pinned 5 s polling forever. A few minutes of testing easily produced
 * 200+ requests. The self-scheduling pollers (3 s paused / 30 s bell /
 * 60 s menu) are the steady drumbeat and are intentionally untouched.
 *
 * Industry rule applied (SWR `focusThrottleInterval`, TanStack Query
 * focus-refetch + `staleTime`): ambient event refreshes are coalesced to
 * at most one network fetch per window per channel, never while the page
 * is hidden, while genuine returns (data older than the window) still
 * refresh instantly. Scheduled ticks stamp the same clock, so an event
 * right after a tick is correctly recognized as redundant.
 *
 * No React hooks here on purpose: module-level timestamps only, so hook
 * order/count in consumers never changes.
 */

const lastStart: Record<string, number> = {};

const nowMs = () => Date.now();

/** Stamp a fetch start for `key`. Call at the top of every fetch — scheduled
 *  ticks AND event-driven ones — so the gate below dedupes against all of
 *  them. Synchronous: callers must invoke it before any await. */
export function markFetchStart(key: string): void {
  lastStart[key] = nowMs();
}

/**
 * True when an ambient event (focus / visibilitychange / pageshow /
 * storage / custom ping) is allowed to hit the network for `key`.
 * Skips while hidden, and while a fetch started less than `windowMs` ago
 * (default 15 s: paused-state 3 s ticks and genuine stale returns are
 * unaffected — worst case adds 15 s staleness to an already-stale read,
 * while tap-storms collapse from dozens of requests to one).
 */
export function shouldEventFetch(key: string, windowMs = 15000): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  return nowMs() - (lastStart[key] ?? 0) >= windowMs;
}
