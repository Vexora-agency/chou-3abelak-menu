import { useLayoutEffect, useRef, useState } from 'react';
import { pxPerSec } from '@/src/utils/announcement';

/**
 * Shared marquee measure loop (storefront banner + admin live preview).
 * Measures one track unit so the reading speed stays constant: each half
 * holds >=1 viewport width (+1 spare unit), the track holds 2 identical
 * halves and loops 0 -> -50% seamlessly.
 *
 * Once the loop starts (ready), the copy count and duration FREEZE: any
 * mid-flight change (unit count, --ann-duration, animation-name) restarts
 * the CSS animation from 0 — the visible "stop and start over" cut. Width
 * wobbles from image loading, scrollbar arrival or font swaps must never
 * touch a running loop. Only a real window resize/rotation (new viewport)
 * or new text re-measures, where a single clean restart is expected.
 */
export function useTickerLoop(active: boolean, text: string, speed: number) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frozen = useRef(false);
  const [half, setHalf] = useState(2);
  const [duration, setDuration] = useState(20);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!active) return;
    let alive = true;
    let finished = false;
    frozen.current = false;
    setReady(false);
    const compute = () => {
      // A running loop is untouchable — see the freeze note above.
      if (frozen.current) return;
      const box = boxRef.current;
      // First unit of the track (measured, never read as a ref in render).
      const unit = box?.querySelector<HTMLElement>(':scope .ann-unit');
      if (!box || !unit) return;
      const boxW = box.clientWidth;
      const unitW = unit.offsetWidth;
      if (!boxW || !unitW) return;
      // +1 spare unit: post-ready width wobbles stay covered without a recount.
      const h = Math.max(1, Math.ceil(boxW / unitW)) + 1;
      if (!alive) return;
      setHalf(h);
      setDuration((h * unitW) / pxPerSec(speed));
    };
    const finish = () => {
      if (!alive || finished) return;
      finished = true;
      // A pre-start viewport event may have frozen an estimate — reopen,
      // take the final measurement, then freeze for the running loop.
      frozen.current = false;
      compute();
      // Freeze BEFORE the first animated paint so the start commit carries
      // the final copy count, duration and animation-name all at once.
      frozen.current = true;
      setReady(true);
    };
    compute();
    // Start on webfont metrics when they arrive fast, otherwise after 1.2 s
    // on fallback metrics (a later swap can no longer restart the loop).
    const timer = window.setTimeout(finish, 1200);
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => finish()).catch(() => {});
    }
    // Pre-start only: keep the estimate fresh while still static.
    const box = boxRef.current;
    const ro = box ? new ResizeObserver(compute) : null;
    if (box && ro) ro.observe(box);
    // A new viewport (rotation/resize) needs a new measurement: unfreeze,
    // re-measure, and freeze again — one clean restart, which is expected.
    const onViewport = () => {
      if (!alive) return;
      frozen.current = false;
      compute();
      frozen.current = true;
    };
    window.addEventListener('resize', onViewport);
    window.addEventListener('orientationchange', onViewport);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('orientationchange', onViewport);
    };
  }, [active, text, speed]);

  return { boxRef, half, duration, ready };
}
