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

  try {
    initSmoothScroll();
  } catch {}

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
    refreshSmoothScroll();
    if (hasGsapTargets()) void initGsapLayer();
    refreshGsapLayer();
  } catch {}
}

export { getLenis };
