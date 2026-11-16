import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export function useHeaderMotion(introDelay = 1.5, parallaxEnabled = true) {
  // Gentle depth on scroll: the brand block drifts down, the glow drifts up.
  // The brand transform is disabled until the intro engine has unmounted its
  // stage: a transform on the brand block creates a stacking context, which
  // would isolate the film canvas's screen blend and bring the black rectangle
  // back. After engineDone the stage is display:none, so the transform is safe.
  const brandY = useParallaxRef(46, parallaxEnabled);
  const glowY = useParallaxRef(-30);

  // Entrance choreography is CSS-only now (see .rise-in in components.css):
  // the hook only exposes the shared delay and the parallax refs.
  const intro = introDelay;

  return { brandY, glowY, intro };
}

/** Scroll-linked translateY with zero geometry reads (see above). */
function useParallaxRef(maxY: number, enabled = true): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled) {
      // Never leave a transform on an ancestor of the screen-blended intro.
      ref.current?.style.removeProperty('transform');
      return;
    }
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
    return () => {
      window.removeEventListener('scroll', onScroll);
      ref.current?.style.removeProperty('transform');
    };
  }, [maxY, enabled]);
  return ref;
}
