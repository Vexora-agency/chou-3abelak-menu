import { useLayoutEffect, useRef, useState } from 'react';
import { pxPerSec } from '@/src/utils/announcement';

/**
 * Shared marquee measure loop (storefront banner + admin live preview).
 * Measures the first track unit so the reading speed stays constant:
 * each half holds >=1 viewport width, the track holds 2 halves and
 * loops 0 -> -50% seamlessly.
 *
 * The animation starts only once (ready flag): mounting the track with a
 * placeholder duration and then correcting it restarts the CSS animation
 * mid-flight — the visible "cut" that makes the loop look like a restarting
 * video instead of an endless rotation. Static text before the start shows
 * no jump at all.
 */
export function useTickerLoop(active: boolean, text: string, speed: number) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [half, setHalf] = useState(2);
  const [duration, setDuration] = useState(20);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!active) return;
    let alive = true;
    let finished = false;
    const compute = () => {
      const box = boxRef.current;
      // First unit of the track (measured, never read as a ref in render).
      const unit = box?.querySelector<HTMLElement>(':scope .ann-unit');
      if (!box || !unit) return;
      const boxW = box.clientWidth;
      const unitW = unit.offsetWidth;
      if (!boxW || !unitW) return;
      const h = Math.max(1, Math.ceil(boxW / unitW));
      if (!alive) return;
      setHalf(h);
      setDuration((h * unitW) / pxPerSec(speed));
    };
    const finish = () => {
      if (!alive || finished) return;
      finished = true;
      compute();
      setReady(true);
    };
    compute();
    // Start on webfont metrics when they arrive fast, otherwise after 1.2 s
    // on fallback metrics (a later swap restarts once at most — same as today).
    const timer = window.setTimeout(finish, 1200);
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => finish()).catch(() => {});
    }
    const box = boxRef.current;
    const ro = box ? new ResizeObserver(compute) : null;
    if (box && ro) ro.observe(box);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      ro?.disconnect();
    };
  }, [active, text, speed]);

  return { boxRef, half, duration, ready };
}
