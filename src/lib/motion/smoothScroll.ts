import Lenis from 'lenis';

/**
 * Site-wide Lenis smooth scroll.
 *
 * WHY this setup:
 * - Lenis wraps the browser's NATIVE scroll (no transform on a content
 *   wrapper), so position: sticky, iOS momentum scrolling, hash links and
 *   accessibility keep working — only the wheel is eased.
 * - Touch is deliberately left native (`syncTouch: false`): iOS/Android
 *   already have the silkiest inertia there, and hijacking it is the #1
 *   cause of "stuck scroll" bug reports.
 * - `autoToggle` pauses Lenis automatically while an overlay locks the page;
 *   useBodyScrollLock additionally calls pauseSmoothScroll()/resumeSmoothScroll()
 *   so a drawer never fights the page behind it.
 * - `respectReducedMotion: false` follows the owner decision: motion runs for
 *   every visitor, even with OS reduced-motion or power saving enabled.
 *
 * Everything is defensive: if Lenis cannot start, native scrolling remains
 * untouched and every helper falls back to the platform API.
 */
let instance: Lenis | null = null;
let booting = false;
let lockDepth = 0;

export function getLenis(): Lenis | null {
  return instance;
}

export function initSmoothScroll(): Lenis | null {
  if (typeof window === 'undefined') return null;
  if (instance || booting) return instance;
  booting = true;
  try {
    instance = new Lenis({
      // A short, calm easing: premium glide without the "floaty" feeling
      // that makes long menus hard to aim.
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
      touchMultiplier: 1,
      wheelMultiplier: 0.95,
      autoRaf: true,
      autoResize: true,
      autoToggle: true,
      anchors: { offset: -8 },
      // Overlays that own their scroll (sheets, drawers, code blocks) opt out.
      prevent: (node) =>
        !!node.closest('[data-lenis-prevent], [data-lenis-prevent-wheel], [data-lenis-prevent-touch]'),
      respectReducedMotion: false,
    });
    if (lockDepth > 0) instance.stop();
  } catch {
    instance = null;
  } finally {
    booting = false;
  }
  return instance;
}

/** Stop smoothing while a modal owns the page (nested-lock safe). */
export function pauseSmoothScroll(): void {
  lockDepth += 1;
  instance?.stop();
}

/**
 * Resume after the last lock drains. `restoreY` re-seats Lenis on the exact
 * scroll offset the body pin restored, so the first wheel tick can never
 * snap the page back to the top.
 */
export function resumeSmoothScroll(restoreY?: number): void {
  lockDepth = Math.max(0, lockDepth - 1);
  if (lockDepth > 0) return;
  if (!instance) return;
  if (typeof restoreY === 'number' && Number.isFinite(restoreY)) {
    try {
      instance.scrollTo(restoreY, { immediate: true, force: true });
    } catch {}
  }
  instance.start();
}

/** Re-measure after async content (menu swap, fonts, route change). */
export function refreshSmoothScroll(): void {
  try {
    instance?.resize();
  } catch {}
}

/** Premium eased scroll to the top (Footer / Track back-to-top). */
export function scrollPageToTop(): void {
  if (instance) {
    instance.scrollTo(0, { duration: 1.15 });
    return;
  }
  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    window.scrollTo(0, 0);
  }
}

/** Eased scroll to an element id (category chips, admin anchors). */
export function scrollToElementId(id: string, offset = 0): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (!el) return;
  if (instance) {
    // Lenis already honors the target's CSS scroll-margin-top (the category
    // sections carry scroll-mt-[160px]) and the root's scroll-padding-top.
    // Pass 0 here unless a caller explicitly wants extra breathing room.
    instance.scrollTo(el, { offset, duration: 1.05 });
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
