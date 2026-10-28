import type { MenuSettings } from '@/src/types/menu';

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
