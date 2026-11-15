import { useEffect, useRef } from 'react';

/**
 * React Bits-style magnetic pull for primary CTAs.
 *
 * Fine pointers only: on touch there is no hover, and a sticky translate
 * would fight the tap feedback. Uses the independent `translate` property so
 * it composes with motion/react entrance transforms and Tailwind scale.
 *
 * Usage:
 *   const ref = useMagnetic<HTMLAnchorElement>();
 *   <a ref={ref} className="fx-magnetic …">…</a>
 */
export function useMagnetic<T extends HTMLElement = HTMLElement>(
  strength = 0.16,
  max = 6
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }

    let raf = 0;
    let tx = 0;
    let ty = 0;
    let inside = false;
    let rect: DOMRect | null = null;

    const measure = () => {
      rect = el.getBoundingClientRect();
    };
    const invalidate = () => {
      rect = null;
    };
    const listenInvalidate = () => {
      window.addEventListener('scroll', invalidate, { passive: true });
      window.addEventListener('resize', invalidate);
    };
    const stopInvalidate = () => {
      window.removeEventListener('scroll', invalidate);
      window.removeEventListener('resize', invalidate);
    };

    const paint = () => {
      raf = 0;
      el.style.translate = `${tx.toFixed(2)}px ${ty.toFixed(2)}px`;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onEnter = () => {
      measure();
      // Only pay for scroll/resize invalidation while the pointer is on the
      // target. Idle pages keep zero magnetic listeners on the scroll path.
      listenInvalidate();
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      inside = true;
      if (!rect) measure();
      if (!rect) return;
      const dx = (event.clientX - (rect.left + rect.width / 2)) * strength;
      const dy = (event.clientY - (rect.top + rect.height / 2)) * strength;
      tx = Math.max(-max, Math.min(max, dx));
      ty = Math.max(-max, Math.min(max, dy));
      kick();
    };
    const reset = () => {
      stopInvalidate();
      if (!inside && tx === 0 && ty === 0) {
        rect = null;
        return;
      }
      inside = false;
      rect = null;
      tx = 0;
      ty = 0;
      kick();
    };

    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', reset);
    el.addEventListener('pointercancel', reset);
    el.addEventListener('blur', reset);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', reset);
      el.removeEventListener('pointercancel', reset);
      el.removeEventListener('blur', reset);
      stopInvalidate();
      el.style.translate = '';
    };
  }, [strength, max]);

  return ref;
}
