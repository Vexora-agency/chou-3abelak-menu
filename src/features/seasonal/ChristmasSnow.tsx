import { useEffect, useRef } from 'react';

/**
 * Christmas snowfall — a fixed full-screen canvas.
 *
 * Performance budget (zero impact when idle or off):
 * - Mounts only when the seasonal theme is `christmas` (the whole
 *   `SeasonalEffects` chunk is lazy-loaded, so `off` costs zero bytes).
 * - The rAF loop starts only after the browser goes idle
 *   (`requestIdleCallback`, 2 s ceiling) — never before first paint.
 * - Pauses when the tab is hidden (visibilitychange) and resumes on return.
 * - DPR capped at 1 (a snowy backdrop needs no retina sharpness).
 * - Flakes are stamped from 4 pre-rendered radial sprites with drawImage —
 *   NO shadowBlur/gradients inside the frame loop (the classic canvas perf killer).
 * - ~90 flakes on desktop, ~50 on small screens (< 640 px width).
 * - Richness lives in the same canvas + same rAF loop, still allocation-free:
 *   a sparse bokeh layer (few large soft low-alpha discs for depth) and a
 *   gentle per-flake twinkle (alpha oscillates around its base via one sin —
 *   no extra draws, no state objects created in the loop). The 2d context is
 *   resolved once, not per frame.
 *
 * Stacking (z-index): `z-[30]` — above page content and the sticky category
 * chips (`z-20`), BELOW the offline banner / cart drawer / item modal
 * (`z-50`) and the scroll-progress line (`z-[60]`). Snow never covers
 * anything tappable. `pointer-events-none` + `aria-hidden` throughout.
 */
export const ChristmasSnow: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return;
    let raf = 0;
    let running = false;
    let stopped = false;

    interface Flake {
      x: number;
      y: number;
      r: number;
      speed: number;
      drift: number;
      phase: number;
      /** Resting alpha — the loop oscillates around it (twinkle), never above 1. */
      base: number;
      /** Twinkle angular speed (rad/s) + phase offset. Bokeh drifts slower. */
      tw: number;
      twPhase: number;
      sprite: number;
    }
    let flakes: Flake[] = [];
    let w = 0;
    let h = 0;

    const seed = () => {
      const rectW = window.innerWidth;
      const rectH = window.innerHeight;
      // DPR cap 1: backdrop softness hides the downscale, GPU fill-rate saved.
      w = Math.max(1, Math.floor(rectW));
      h = Math.max(1, Math.floor(rectH));
      canvas.width = w;
      canvas.height = h;
      const count = rectW < 640 ? 50 : 90;
      const bokehCount = rectW < 640 ? 6 : 10;
      const rnd = (a: number, b: number) => a + Math.random() * (b - a);
      flakes = Array.from({ length: count + bokehCount }, (_, i) => {
        if (i < count) {
          return {
            x: Math.random() * w,
            y: Math.random() * h,
            r: 0.8 + Math.random() * 2.0,
            speed: 0.35 + Math.random() * 0.9,
            drift: 0.3 + Math.random() * 0.9,
            phase: Math.random() * Math.PI * 2,
            base: 0.35 + Math.random() * 0.55,
            tw: rnd(0.8, 2.4),
            twPhase: Math.random() * Math.PI * 2,
            sprite: i % 3,
          };
        }
        // Bokeh: few, large, barely-there discs floating slowly behind it all.
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: rnd(6, 13),
          speed: rnd(0.12, 0.37),
          drift: rnd(0.15, 0.45),
          phase: Math.random() * Math.PI * 2,
          base: rnd(0.05, 0.11),
          tw: rnd(0.3, 1.0),
          twPhase: Math.random() * Math.PI * 2,
          sprite: 3,
        };
      });
    };

    // Pre-rendered soft-dot sprites (3 flake sizes + 1 large bokeh disc) —
    // the loop only drawImages.
    const sprites: HTMLCanvasElement[] = [];
    const buildSprites = () => {
      const sizes = [8, 16, 24, 48];
      for (const size of sizes) {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        sprites.push(c);
      }
    };

    let last = 0;
    // Resolved once — the old code paid a getContext lookup every frame.
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const frame = (t: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(50, t - (last || t));
      last = t;
      const step = dt / 16.7;
      const tSec = t / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.phase += 0.01 * step;
        f.y += f.speed * step;
        f.x += Math.sin(f.phase) * f.drift * 0.4 * step;
        if (f.y > h + 6) {
          f.y = -6;
          f.x = Math.random() * w;
        }
        if (f.x > w + 6) f.x = -6;
        else if (f.x < -6) f.x = w + 6;
        const sprite = sprites[f.sprite];
        if (!sprite) continue;
        const d = f.r * 2.4;
        // Twinkle: one sin around the resting alpha. No allocation, no shadows.
        ctx.globalAlpha = f.base * (0.72 + 0.28 * Math.sin(tSec * f.tw + f.twPhase));
        ctx.drawImage(sprite, f.x - d / 2, f.y - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
    };

    const start = () => {
      if (running || stopped) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };

    buildSprites();
    seed();
    let resizeT = 0;
    const onResize = () => {
      window.clearTimeout(resizeT);
      resizeT = window.setTimeout(seed, 150);
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    // Never start before first paint: idle callback with a 2 s ceiling, so
    // LCP and hydration are never delayed by a decorative effect.
    let idleTimer = 0;
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => start(), { timeout: 2000 });
      void id;
    } else {
      idleTimer = window.setTimeout(start, 600);
    }

    return () => {
      stopped = true;
      stop();
      window.clearTimeout(idleTimer);
      window.clearTimeout(resizeT);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[30]"
    />
  );
};
