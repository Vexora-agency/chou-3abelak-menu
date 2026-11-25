import { useLayoutEffect, useState, type FC, type RefObject } from 'react';
import { Link2 } from 'lucide-react';

interface LinkedOrdersConnectorProps {
  lang: 'en' | 'ar';
  /** Relative-positioned wrapper that holds the member rows. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Re-run measurement when this changes (member count, expand/collapse). */
  layoutKey: string | number;
  /** Rail distance from the container's inline-end edge (px). */
  railInset?: number;
  /** Stub length from the rail toward the cards (px). */
  stubLen?: number;
}

interface Geom {
  width: number;
  railX: number;
  stubX: number;
  points: number[];
  mid: number;
}

/**
 * Premium SVG bracket connector for linked (joint-delivery) orders.
 * A vertical gold rail hugs the container's inline-end side with smooth
 * 90° rounded bends reaching into every member card, plus a glowing
 * chain-link medallion at the midpoint — a bracket/tree visual.
 *
 * Fully measured (offsets, never viewport math): it adapts to any member
 * count and row height, and a ResizeObserver keeps it aligned while cards
 * expand or collapse. Logical (inline-end) placement mirrors it for RTL.
 * Pure SVG strokes + lucide icon — no images, no emoji.
 */
export const LinkedOrdersConnector: FC<LinkedOrdersConnectorProps> = ({
  lang,
  containerRef,
  layoutKey,
  railInset = 16,
  stubLen = 22,
}) => {
  const isAr = lang === 'ar';
  const [geom, setGeom] = useState<Geom | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    // Synchronous read (offset* forces layout — safe here): background tabs
    // never fire requestAnimationFrame, so the first paint must not depend
    // on it. The rAF pass re-reads after entrance animations settle.
    const read = () => {
      const w = container.offsetWidth;
      if (!w) {
        setGeom(null);
        return;
      }
      const rows = Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-link-row]'));
      const points = rows
        .map((el) => el.offsetTop + el.offsetHeight / 2)
        .filter((v) => Number.isFinite(v));
      if (points.length < 2) {
        setGeom(null);
        return;
      }
      const railX = isAr ? railInset : w - railInset;
      const stubX = isAr ? railInset + stubLen : w - railInset - stubLen;
      setGeom({ width: w, railX, stubX, points, mid: (points[0] + points[points.length - 1]) / 2 });
    };
    const measure = () => {
      cancelAnimationFrame(raf);
      read();
      raf = requestAnimationFrame(read);
    };
    measure();
    const ros: ResizeObserver[] = [];
    const watch = (el: Element | null) => {
      if (!el) return;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      ros.push(ro);
    };
    watch(container);
    container.querySelectorAll(':scope > [data-link-row]').forEach(watch);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      ros.forEach((ro) => ro.disconnect());
      window.removeEventListener('resize', measure);
    };
  }, [containerRef, layoutKey, isAr, railInset, stubLen]);

  if (!geom || geom.points.length < 2) return null;
  const { railX, stubX, points, mid } = geom;
  const r = 10;
  const y1 = points[0];
  const y2 = points[points.length - 1];
  // Single rail path with rounded 90° bends into the first/last cards.
  const main = `M ${stubX} ${y1} Q ${railX} ${y1} ${railX} ${y1 + r} L ${railX} ${y2 - r} Q ${railX} ${y2} ${stubX} ${y2}`;
  const middles = points.slice(1, -1);

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        style={{ filter: 'drop-shadow(0 0 5px rgba(212,175,55,0.45))' }}
        aria-hidden="true"
      >
        <path
          d={main}
          stroke="var(--primary)"
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {middles.map((cy, i) => (
          <path
            key={i}
            d={`M ${railX} ${cy} L ${stubX} ${cy}`}
            stroke="var(--primary)"
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <span
        aria-hidden="true"
        className="absolute z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--primary)] bg-[#0A0A0A] text-[var(--primary)] shadow-[0_0_16px_rgba(212,175,55,0.55)]"
        style={{ left: railX, top: mid, transform: 'translate(-50%, -50%)' }}
      >
        <Link2 size={16} strokeWidth={2.5} />
      </span>
    </>
  );
};
