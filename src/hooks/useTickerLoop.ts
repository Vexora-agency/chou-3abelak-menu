import { useLayoutEffect, useRef, useState } from 'react';
import { pxPerSec } from '@/src/utils/announcement';

/**
 * Shared marquee measure loop (storefront banner + admin live preview).
 * Measures the first track unit so the reading speed stays constant:
 * each half holds >=1 viewport width, the track holds 2 halves and
 * loops 0 -> -50% seamlessly.
 */
export function useTickerLoop(active: boolean, text: string, speed: number) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [half, setHalf] = useState(2);
  const [duration, setDuration] = useState(20);

  useLayoutEffect(() => {
    if (!active) return;
    let alive = true;
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
    compute();
    const box = boxRef.current;
    const ro = box ? new ResizeObserver(compute) : null;
    if (box && ro) ro.observe(box);
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => {
        if (alive) compute();
      }).catch(() => {});
    }
    return () => {
      alive = false;
      ro?.disconnect();
    };
  }, [active, text, speed]);

  return { boxRef, half, duration };
}
