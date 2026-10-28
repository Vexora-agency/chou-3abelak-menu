import type { MenuData, MenuSettings } from '@/src/types/menu';
import { getOrderingState, type OrderingStatus } from '@/src/utils/status';

type Ordering = MenuSettings['ordering'];

/**
 * Coherent pause edits for the Settings-draft path (OrderingSection switch).
 * The draft has no duration picker, so enabling a pause stamps a fresh start
 * with NO deadline (indefinite — customers see no fake resume time), and
 * disabling clears both stamps so no stale resume time ever leaks to
 * customers or the admin countdown. The dashboard quick-pause endpoint owns
 * timed pauses and already maintains the same fields; both writers now agree.
 */
export function applyDraftPause(ordering: Ordering, paused: boolean, nowIso: string): Ordering {
  if (paused) {
    return { ...ordering, paused: true, pausedUntil: null, pausedAt: nowIso };
  }
  return { ...ordering, paused: false, pausedUntil: null, pausedAt: null };
}

/**
 * Single display truth for availability: the live poller wins, EXCEPT a
 * poller value the server could never have produced — paused with an already
 * reached deadline (only possible when it went stale after expiry). That
 * case recomputes locally so the UI flips to open in the same second instead
 * of showing the previous pause's resume time for up to a poll interval.
 * Used by the storefront shell and the cart alike, so admin countdown and
 * customer line always converge on the same instant.
 */
export function resolveLiveOrdering(
  polled: OrderingStatus | null | undefined,
  menu: MenuData,
  nowMs: number
): OrderingStatus {
  if (polled) {
    const deadline = polled.state === 'paused' && typeof polled.reopensAt === 'string'
      ? Date.parse(polled.reopensAt)
      : NaN;
    if (!(Number.isFinite(deadline) && deadline <= nowMs)) {
      return polled;
    }
  }
  return getOrderingState(menu.settings, nowMs);
}

/**
 * Poll freshness guard: a successful poll older than maxAgeMs is untrusted
 * (timers may run while its fetches silently fail — the exact frozen-phone
 * case: a ticking countdown on dead data). Callers drop back to the local
 * machine instead of displaying it. Never fires before the first success.
 */
export function isPollStale(lastSuccessMs: number | null, nowMs: number, maxAgeMs = 120000): boolean {
  if (lastSuccessMs === null) return false;
  return nowMs - lastSuccessMs > maxAgeMs;
}

/**
 * Adaptive poll cadence: every 5 s while paused (a resume must surface in
 * seconds — this is the moment customers stare at the countdown), every
 * 10 s within two minutes of opening/returning (fresh sessions are when
 * owners test and customers decide — a pause must surface fast there too),
 * every 60 s otherwise (idle-open pages stay cheap on KV reads and phone
 * battery).
 */
export function pollIntervalMs(
  state: OrderingStatus | null,
  nowMs: number = Date.now(),
  lastReturnMs: number = 0
): number {
  if (state?.state === 'paused') return 5000;
  if (nowMs - lastReturnMs < 120000) return 10000;
  return 60000;
}
