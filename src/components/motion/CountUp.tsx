import { useEffect, useRef } from 'react';

interface CountUpProps {
  value: number;
  /** Seconds. */
  duration?: number;
  /** Formatter applied on every frame (money, decimals, grouping…). */
  format?: (value: number) => string;
  className?: string;
  /** Accessible final value; defaults to the formatted value. */
  ariaLabel?: string;
}

const defaultFormat = (n: number): string => Math.round(n).toLocaleString();

/**
 * React Bits-style CountUp, written without re-renders.
 *
 * The animated number is written straight to textContent inside one rAF loop;
 * a static sr-only twin carries the final value for screen readers, so an
 * announcement never hears every intermediate frame.
 *
 * Starts from 0 on mount, then animates from the current value on updates
 * (live order totals keep their continuity).
 */
export function CountUp({
  value,
  duration = 1.15,
  format,
  className = '',
  ariaLabel,
}: CountUpProps) {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const currentRef = useRef(0);
  const formatRef = useRef<(n: number) => string>(format ?? defaultFormat);

  // Keep the animation loop on the latest formatter without making it an
  // effect input (inline formatters change identity every render).
  useEffect(() => {
    formatRef.current = format ?? defaultFormat;
  }, [format]);

  const fmt = format ?? defaultFormat;
  const finalLabel = ariaLabel || fmt(value);

  useEffect(() => {
    const el = spanRef.current;
    if (!el || !Number.isFinite(value)) return;
    const formatFrame = formatRef.current;
    const from = currentRef.current;
    const to = value;
    if (Math.abs(to - from) < 0.0001) {
      el.textContent = formatFrame(to);
      return;
    }
    const start = performance.now();
    const ms = Math.max(120, duration * 1000);
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      // Expo-out: fast commit, calm settle — the same feel as the site's
      // other entrances.
      const eased = 1 - Math.pow(1 - p, 4);
      const next = from + (to - from) * eased;
      currentRef.current = next;
      el.textContent = formatFrame(next);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        currentRef.current = to;
        el.textContent = formatFrame(to);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className={`tabular-nums ${className}`}>
      <span ref={spanRef} aria-hidden="true">
        {fmt(0)}
      </span>
      <span className="sr-only">{finalLabel}</span>
    </span>
  );
}
