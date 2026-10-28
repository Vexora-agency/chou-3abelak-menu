import { useEffect, type RefObject } from 'react';

// Owner decision: the edge shine ALWAYS sweeps, even under
// prefers-reduced-motion or device power saving. Phones in power saving
// (notably iOS Low Power Mode) throttle or freeze CSS keyframe animations,
// so the sweep is driven from requestAnimationFrame instead of CSS: wherever
// JS runs, the shine moves. Timing is byte-identical to the old edgeSweep
// keyframes it replaces (4.8 s loop, ease-in-out, -120% → 420%).

const PERIOD_MS = 4800;
const FROM_PCT = -120;
const TO_PCT = 420;

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

/** Shine offset in % at `elapsedMs` into the endless 4.8 s loop. Pure: unit-testable. */
export function edgeSweepAt(elapsedMs: number): number {
  const t = ((((elapsedMs % PERIOD_MS) + PERIOD_MS) % PERIOD_MS) / PERIOD_MS);
  return FROM_PCT + (TO_PCT - FROM_PCT) * easeInOut(t);
}

/** Advance `ref`'s translateX every frame, forever. Transform-only writes:
 *  no layout, compositor-cheap. rAF already sleeps in background tabs. */
export function useEdgeSweep(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const el = ref.current;
      if (el) el.style.transform = `translateX(${edgeSweepAt(now - start)}%)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref]);
}
