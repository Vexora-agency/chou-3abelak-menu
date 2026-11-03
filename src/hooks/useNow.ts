import { useEffect, useState } from 'react';

/**
 * Live display clock: returns a `Date.now()`-based ms stamp that re-renders
 * the caller every `intervalMs` while `enabled` AND the tab is visible.
 * Data fetching stays on its own (slower) poll — this only speeds up the
 * DISPLAY (countdowns), so enabling it never adds network traffic.
 *
 * Visibility-gated like the track/bell polls: ticks whose callback lands
 * while hidden are skipped, plus a `visibilitychange` catch-up stamp on
 * return so the first visible second is already correct. Cleanup clears
 * the interval and the listener (unmount or `enabled`/`intervalMs` change).
 * No DOM access at import time (only inside the effect + state initializer).
 */
export function useNow(enabled: boolean, intervalMs = 1000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    // Stamp at once on enable so the first paint is already fresh.
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setNowMs(Date.now());
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNowMs(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs]);

  return nowMs;
}
