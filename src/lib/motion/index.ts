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

export function initMotionRuntime(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;

  try {
    initRevealSystem();
  } catch {}

  try {
    initSmoothScroll();
  } catch {}

  // GSAP is strictly additive and must never compete with the first paint.
  scheduleIdle(() => {
    void initGsapLayer();
  }, 2500);

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
    refreshGsapLayer();
  } catch {}
}

export { getLenis };
