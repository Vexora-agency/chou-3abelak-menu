import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export function useHeaderMotion() {
  // Gentle depth on scroll: brand block drifts down a touch, the glow drifts
  // up (always on - site owner decision). Hand-rolled on purpose: motion's
  // useScroll measures document geometry on every scroll (forced reflow, the
  // top flagged offender in traces). scrollY is a free read that never forces
  // layout, and the mapping below is pure arithmetic — this listener costs
  // ~zero however big the DOM gets. Frame-for-frame identical to the old
  // useTransform mapping (direct write, no smoothing either way).
  const parY = useParallaxRef(46);
  const glowY = useParallaxRef(-30);

  // Entrance choreography: content rises in while the logo video draws itself
  // (always on - site owner decision).
  const intro = 1.5;
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return { parY, glowY, intro, rise };
}

/** Scroll-linked translateY with zero geometry reads (see above). */
function useParallaxRef(maxY: number): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let ticking = false;
    const update = () => {
      ticking = false;
      const t = Math.min(1, Math.max(0, window.scrollY / 320));
      if (ref.current) ref.current.style.transform = `translateY(${t * maxY}px)`;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [maxY]);
  return ref;
}
