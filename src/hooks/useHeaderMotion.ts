import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export function useHeaderMotion(introDelay = 1.5) {
  // Gentle depth on scroll: brand block drifts down a touch, the glow drifts
  // up (always on - site owner decision). Hand-rolled on purpose: motion's
  // useScroll measures document geometry on every scroll (forced reflow, the
  // top flagged offender in traces). scrollY is a free read that never forces
  // layout, and the mapping below is pure arithmetic — this listener costs
  // ~zero however big the DOM gets. Frame-for-frame identical to the old
  // useTransform mapping (direct write, no smoothing either way).
  const glowY = useParallaxRef(-30);

  // Entrance choreography is CSS-only now (see .rise-in in components.css):
  // the hook only exposes the shared delay and the glow parallax.
  const intro = introDelay;

  return { glowY, intro };
}

/** Scroll-linked translateY with zero geometry reads (see above). */
function useParallaxRef(maxY: number): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let ticking = false;
    // The mapping saturates at scrollY=320. Before this guard the handler kept
    // re-writing the same transform on every scroll frame for the whole menu,
    // which kept a huge gradient layer on the style/paint path for no visual
    // change. Skip identical values: depth still moves on the first 320px and
    // costs literally zero for the rest of the page.
    let lastT = -1;
    const update = () => {
      ticking = false;
      const t = Math.min(1, Math.max(0, window.scrollY / 320));
      if (t === lastT) return;
      lastT = t;
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
