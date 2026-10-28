import { useEffect, type RefObject } from 'react';

// Owner decision: the edge comet ALWAYS travels, even under
// prefers-reduced-motion or device power saving. Phones in power saving
// (notably iOS Low Power Mode) throttle or freeze CSS keyframe animations,
// so the comet is driven from requestAnimationFrame instead of CSS: wherever
// JS runs, it moves. Timing matches the old 4.8 s ease-in-out sweep loop.

const PERIOD_MS = 4800;

// CSS ease-in-out === cubic-bezier(0.42, 0, 0.58, 1). Solve x(t) = x for t
// (Newton-Raphson, this curve converges from t = x), then return y(t).
function easeInOut(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * 0.42;
  const bx = 3 * (0.58 - 0.42) - cx;
  const ax = 1 - cx - bx;
  const by = 3 * (1 - 0);
  const ay = 1 - by;
  let t = x;
  for (let i = 0; i < 5; i++) {
    const xOfT = ((ax * t + bx) * t + cx) * t - x;
    const dxOfT = (3 * ax * t + 2 * bx) * t + cx;
    if (dxOfT === 0) break;
    t -= xOfT / dxOfT;
  }
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return ((ay * t + by) * t) * t;
}

/** Eased 0 → 1 progress at `elapsedMs` into the endless loop. Pure: unit-testable. */
export function sweepEased(elapsedMs: number, periodMs = PERIOD_MS): number {
  const t = (((elapsedMs % periodMs) + periodMs) % periodMs) / periodMs;
  return easeInOut(t);
}

/** Advance `ref`'s stroke-dashoffset every frame, forever: the dash comet
 *  travels along its path. Attribute-only writes: no layout, repaint-cheap.
 *  The path uses pathLength=100, so offset runs 100 → 0. rAF already sleeps
 *  in background tabs. */
export function usePathSweep(ref: RefObject<SVGPathElement | null>, periodMs = PERIOD_MS) {
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const el = ref.current;
      if (el) el.style.strokeDashoffset = `${100 * (1 - sweepEased(now - start, periodMs))}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref, periodMs]);
}
