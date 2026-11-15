import { initRevealSystem, refreshReveals } from './reveal';
import { initSmoothScroll, refreshSmoothScroll, getLenis } from './smoothScroll';
import { initGsapLayer, refreshGsapLayer } from './gsapLayer';
import { scheduleIdle } from '@/src/utils/scheduleIdle';

/**
 * Boot the site-wide premium motion runtime.
 *
 * Called once from main.tsx BEFORE React renders so the reveal observer is
 * already armed when the first tree is committed (no visible flash on
 * above-the-fold sections). Lenis starts immediately; GSAP waits for idle.
 */
let booted = false;
const GSAP_TARGETS = '[data-gsap-parallax], [data-gsap-float]';

function hasGsapTargets(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector(GSAP_TARGETS);
}

export function initMotionRuntime(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;

  try {
    initRevealSystem();
  } catch {}

  // A stale inline root clip must never survive into the new page boot.
  try {
    document.documentElement.style.removeProperty('overflow');
  } catch {}

  // Lenis is programmatic-only (native wheel) and its constructor measures
  // document geometry. Start it after the first paint/idle so it can never
  // force a layout on the critical path; scrollTo helpers fall back to the
  // platform API until it is ready.
  scheduleIdle(() => {
    try {
      initSmoothScroll();
    } catch {}
  }, 1200);

  // GSAP is now strictly opt-in: if no element asks for a data-gsap-* effect,
  // the 113 kB GSAP + ScrollTrigger pair is never requested. That keeps the
  // desktop cold start and the scroll path free of an unused animation engine.
  scheduleIdle(() => {
    if (hasGsapTargets()) void initGsapLayer();
  }, 4000);

  // Async geometry sources that change the page height.
  const refresh = () => {
    refreshSmoothScroll();
    refreshReveals();
    refreshGsapLayer();
  };
  window.addEventListener('load', refresh, { once: true });
  document.fonts?.ready.then(() => {
    refreshSmoothScroll();
  }).catch(() => {});
  // Lazy chunks (menu, cart, track, admin) mount after boot: one light sweep
  // after the browser settles keeps every reveal/parallax target armed.
  scheduleIdle(refresh, 3000);
}

/** Route/content changes can call this to re-arm late-mounted targets. */
export function refreshMotionRuntime(): void {
  try {
    refreshReveals();
    // Lenis resize + ScrollTrigger refresh read page geometry. Defer them off
    // the commit frame so the menu swap never pays a forced reflow.
    scheduleIdle(() => {
      refreshSmoothScroll();
      refreshGsapLayer();
    }, 900);
    if (hasGsapTargets()) void initGsapLayer();
  } catch {}
}

export { getLenis };
