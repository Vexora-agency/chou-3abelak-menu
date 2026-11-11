/**
 * Celebration confetti — `canvas-confetti` is ALWAYS loaded via dynamic
 * `import()` so it never joins the initial bundle: `off`/calm visitors
 * download zero extra bytes; the chunk (~25 KB raw, ~8 KB gzip) loads only
 * at the exact moment a celebration fires.
 *
 * Total silence rules (same as the snow itself):
 * - `prefers-reduced-motion: reduce` → no confetti, ever.
 * - Data-saver (`navigator.connection.saveData`) → no confetti, ever.
 * Failures are swallowed — confetti is decorative, never load-bearing.
 */

export interface ConfettiOrigin {
  x: number;
  y: number;
}

/** False on the server, under reduced motion, or on metered connections. */
export function celebrationAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData === true) return false;
  } catch {
    return false;
  }
  return true;
}

/** Viewport-normalized center of an element — so the burst starts inside it. */
export function originOf(el: HTMLElement): ConfettiOrigin {
  const r = el.getBoundingClientRect();
  const x = (r.left + r.width / 2) / Math.max(1, window.innerWidth);
  const y = (r.top + r.height / 2) / Math.max(1, window.innerHeight);
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

async function fire(opts: {
  particleCount: number;
  spread: number;
  startVelocity: number;
  ticks: number;
  gravity: number;
  scalar: number;
  origin: ConfettiOrigin;
  colors: string[];
}): Promise<void> {
  if (!celebrationAllowed()) return;
  try {
    const { default: confetti } = await import('canvas-confetti');
    confetti({ ...opts, disableForReducedMotion: true });
  } catch {
    // Decorative only — a failed chunk must never break the toggle/greeting.
  }
}

/** Small festive burst inside the admin panel the moment the season turns on. */
export function celebrateSeasonOn(origin?: ConfettiOrigin): void {
  void fire({
    particleCount: 55,
    spread: 75,
    startVelocity: 32,
    ticks: 120,
    gravity: 1.1,
    scalar: 0.9,
    origin: origin ?? { x: 0.5, y: 0.3 },
    colors: ['#ffffff', '#ffd166', '#ef476f', '#06d6a0', '#7dd3fc'],
  });
}

/** One gentle pop when the customer greeting card appears for the first time. */
export function greetSeasonOnce(): void {
  void fire({
    particleCount: 32,
    spread: 60,
    startVelocity: 26,
    ticks: 150,
    gravity: 0.9,
    scalar: 0.85,
    origin: { x: 0.5, y: 0.85 },
    colors: ['#ffffff', '#ffd166', '#bae6fd'],
  });
}
