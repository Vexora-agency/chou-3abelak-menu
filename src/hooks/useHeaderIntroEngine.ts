import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { SmokeParticle, SparkParticle } from '@/src/components/header/headerIntroParticles';

// Forced-playback intro: the same 6 s / 24 fps logo reveal as the old video,
// but sourced from 4 preloaded sprite sheets instead of a <video> element.
// Canvas drawImage is never subject to autoplay policies (iOS Low Power Mode,
// Android data saver), so the intro now runs on EVERY device. Frame timing,
// alpha keying, particles and end states are identical to the video version.
const SHEETS = [
  '/assets/intro-sheet-0.webp',
  '/assets/intro-sheet-1.webp',
  '/assets/intro-sheet-2.webp',
  '/assets/intro-sheet-3.webp',
];
const CELL_W = 720;
const CELL_H = 266;
const COLS = 4;
const FRAMES_PER_SHEET = 36;
const FPS = 24;
const TOTAL_FRAMES = SHEETS.length * FRAMES_PER_SHEET; // 144
const DURATION_S = TOTAL_FRAMES / FPS; // 6.0
const END_AT_S = DURATION_S - 0.25; // match the old timeupdate threshold

export function useHeaderIntroEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  smokeCanvasRef: RefObject<HTMLCanvasElement | null>,
  headerRef: RefObject<HTMLElement | null>,
  setHasEnded: Dispatch<SetStateAction<boolean>>,
  setEngineDone: Dispatch<SetStateAction<boolean>>
): void {
  // Real-time High-Definition Canvas Alpha Extraction + Cinematic Steam & Ember Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    const smokeCanvas = smokeCanvasRef.current;
    if (!canvas || !smokeCanvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sCtx = smokeCanvas.getContext('2d');
    if (!ctx || !sCtx) return;

    // The intro always plays for everyone (site owner decision): no reduced-motion
    // skip here. If the sheets fail to load, the fallbacks below still show
    // the final logo so the header never stays blank.

    // Enable high-definition image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';

    let animId = 0;
    let isRunning = true;
    let finished = false;
    let sheets: HTMLImageElement[] | null = null;
    let startStamp = 0;

    // Particle pools
    const smokeParticles: SmokeParticle[] = [];
    const sparkParticles: SparkParticle[] = [];

    // Brand ember color resolved once per intro run (canvas fillStyle cannot
    // use var()). Falls back to the theme default if the variable is missing.
    const brandPrimary =
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#FFC400';

    let tick = 0;

    // Elapsed intro seconds; -1 while the sheets are still loading.
    const introTime = () => (startStamp === 0 ? -1 : (performance.now() - startStamp) / 1000);

    const finishNow = () => {
      isRunning = false;
      finished = true;
      setHasEnded(true);
      setEngineDone(true);
    };

    const renderLoop = () => {
      if (!isRunning) {
        animId = 0;
        return;
      }
      // Skip all canvas work while the tab is hidden.
      if (document.hidden) {
        animId = requestAnimationFrame(renderLoop);
        return;
      }
      tick++;

      const w = canvas.width;
      const h = canvas.height;

      // 1. Process Sprite Frame with Crisp Subpixel Alpha Keying & Edge Luminosity Restoration
      const t = introTime();
      if (sheets && t >= 0 && !finished) {
        const frame = Math.min(Math.floor(t * FPS), TOTAL_FRAMES - 1);
        const sheet = sheets[Math.floor(frame / FRAMES_PER_SHEET)];
        const local = frame % FRAMES_PER_SHEET;
        const sx = (local % COLS) * CELL_W;
        const sy = Math.floor(local / COLS) * CELL_H;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(sheet, sx, sy, CELL_W, CELL_H, 0, 0, w, h);

        try {
          const frameData = ctx.getImageData(0, 0, w, h);
          const data = frameData.data;
          const len = data.length;

          for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const max = r > g ? (r > b ? r : b) : (g > b ? g : b);

            if (max <= 12) {
              // Complete transparent zero floor (cleans compression artifacts)
              data[i + 3] = 0;
            } else if (max < 52) {
              // Smooth cubic Hermite anti-aliasing curve: eliminates jagged pixels
              const tt = (max - 12) / 40;
              const smooth = tt * tt * (3 - 2 * tt);
              data[i + 3] = (smooth * 255) | 0;

              // De-darken boundary pixels so edges stay vibrant & razor-sharp rather than dark/blurry
              const factor = Math.min(2.4, 1 / (smooth * 0.75 + 0.25));
              data[i] = Math.min(255, (r * factor) | 0);
              data[i + 1] = Math.min(255, (g * factor) | 0);
              data[i + 2] = Math.min(255, (b * factor) | 0);
            } else {
              // Fully solid letter stroke
              data[i + 3] = 255;
              // Clean pure luminous whites
              if (r > 200 && g > 200 && b > 200) {
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
              }
            }
          }
          ctx.putImageData(frameData, 0, 0);
        } catch {
          // Fallback if compositing is restricted
        }

        if (t >= END_AT_S) {
          setHasEnded(true);
        }

        // 2. Spawn Dynamic Gourmet Smoke & Sizzle Sparks in 720x266 coordinate
        // space (buffers run at half resolution for performance; CSS upscales).
        const curTime = t;
        if (curTime > 0.3 && curTime < 4.8) {
          // Spawn positions per intro chapter (720x266 coordinate space).
          const spawn =
            curTime < 1.6
              ? { xMin: 90, xMax: 230, y: 135 } // Pan handle drawing on left
              : curTime < 3.4
                ? { xMin: 210, xMax: 480, y: 140 } // "CHOU" and lower numbers forming
                : { xMin: 260, xMax: 620, y: 120 }; // Full letters & Arabic "شو" top-right accent

          // Spawn smoke puff every 2-3 frames
          if (tick % 3 === 0 && smokeParticles.length < 35) {
            smokeParticles.push({
              x: spawn.xMin + Math.random() * (spawn.xMax - spawn.xMin),
              y: spawn.y + (Math.random() * 20 - 10),
              vx: (Math.random() - 0.5) * 0.45,
              vy: -0.7 - Math.random() * 0.9, // rising up
              radius: 10 + Math.random() * 9,
              maxRadius: 37 + Math.random() * 20,
              alpha: 0.24 + Math.random() * 0.12,
              decay: 0.0035 + Math.random() * 0.003,
              wobbleSpeed: 0.03 + Math.random() * 0.03,
              wobbleAmount: 0.6 + Math.random() * 0.75,
              seed: Math.random() * 100,
            });
          }

          // Spawn sizzle spark ember every 4-5 frames
          if (tick % 4 === 0 && sparkParticles.length < 25) {
            sparkParticles.push({
              x: spawn.xMin + Math.random() * (spawn.xMax - spawn.xMin),
              y: spawn.y + (Math.random() * 15 - 7),
              vx: (Math.random() - 0.5) * 1.1,
              vy: -1.1 - Math.random() * 1.3,
              size: 1 + Math.random() * 1.6,
              alpha: 0.85 + Math.random() * 0.15,
              decay: 0.015 + Math.random() * 0.015,
              color: Math.random() > 0.3 ? brandPrimary : '#FFFFFF',
            });
          }
        }
      }

      // 3. Render Smoke & Embers on the overlay canvas
      sCtx.clearRect(0, 0, w, h);

      // Render smoke particles with soft radial dissipation
      for (let i = smokeParticles.length - 1; i >= 0; i--) {
        const p = smokeParticles[i];
        p.x += p.vx + Math.sin(tick * p.wobbleSpeed + p.seed) * p.wobbleAmount * 0.5;
        p.y += p.vy;
        p.radius += (p.maxRadius - p.radius) * 0.03;
        p.alpha -= p.decay;

        if (p.alpha <= 0.01 || p.y < -40) {
          smokeParticles.splice(i, 1);
          continue;
        }

        // Soft steam / smoke radial gradient
        const grad = sCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
        grad.addColorStop(0, `rgba(255, 235, 190, ${p.alpha * 0.55})`);
        grad.addColorStop(0.35, `rgba(220, 220, 220, ${p.alpha * 0.32})`);
        grad.addColorStop(0.75, `rgba(180, 180, 180, ${p.alpha * 0.1})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        sCtx.fillStyle = grad;
        sCtx.beginPath();
        sCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        sCtx.fill();
      }

      // Render spark embers (two-pass plain fill glow: same look as shadowBlur
      // at a fraction of the cost - shadowBlur re-blurs the layer per spark)
      for (let i = sparkParticles.length - 1; i >= 0; i--) {
        const sp = sparkParticles[i];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.alpha -= sp.decay;

        if (sp.alpha <= 0.02 || sp.y < -15) {
          sparkParticles.splice(i, 1);
          continue;
        }

        sCtx.globalAlpha = sp.alpha * 0.35;
        sCtx.fillStyle = sp.color;
        sCtx.beginPath();
        sCtx.arc(sp.x, sp.y, sp.size * 2.2, 0, Math.PI * 2);
        sCtx.fill();
        sCtx.globalAlpha = sp.alpha;
        sCtx.beginPath();
        sCtx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        sCtx.fill();
        sCtx.globalAlpha = 1;
      }

      // The intro is over and every particle has faded: stop the loop for good
      // and unmount the canvases (they are already invisible via opacity-0).
      // This frees the main thread for scroll / hover for the rest of the visit.
      const done = startStamp !== 0 && (performance.now() - startStamp) / 1000 >= DURATION_S;
      if (done && smokeParticles.length === 0 && sparkParticles.length === 0) {
        finished = true;
        animId = 0;
        setEngineDone(true);
        return;
      }

      animId = requestAnimationFrame(renderLoop);
    };

    // (Re)starts the loop only if it is not already running or finished.
    const kick = () => {
      if (animId === 0 && !finished && isRunning) {
        animId = requestAnimationFrame(renderLoop);
      }
    };

    // Preload every sheet, then start the clock: playback itself can never be
    // blocked (plain canvas drawing), so the only failure mode left is a
    // network failure, which falls back to the final logo like before.
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(stallTimer);
      if (ok && sheets) {
        startStamp = performance.now();
        kick();
      } else {
        finishNow();
      }
    };

    const loaders = SHEETS.map(
      (src) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
          img.onerror = () => resolve(null);
          img.src = src;
        })
    );
    void Promise.all(loaders).then((imgs) => {
      if (imgs.every((im): im is HTMLImageElement => im !== null)) {
        sheets = imgs;
        settle(true);
      } else {
        settle(false);
      }
    });

    // Safety net: if the sheets never arrive, show the final logo.
    // Same 3.5 s window the video version used.
    const stallTimer = window.setTimeout(() => {
      if (!finished && startStamp === 0) {
        finishNow();
      }
    }, 3500);

    // Pause the whole engine while the header is scrolled out of view and
    // resume when it comes back: zero canvas cost during menu scrolling,
    // with visuals identical whenever the header is visible.
    const io = new IntersectionObserver(
      (entries) => {
        isRunning = entries[0]?.isIntersecting ?? true;
        headerRef.current?.setAttribute('data-paused', isRunning ? 'false' : 'true');
        if (isRunning) kick();
      },
      { threshold: 0 }
    );
    if (headerRef.current) io.observe(headerRef.current);

    return () => {
      isRunning = false;
      window.clearTimeout(stallTimer);
      io.disconnect();
      cancelAnimationFrame(animId);
      animId = 0;
      sheets = null;
    };
  }, [canvasRef, smokeCanvasRef, headerRef, setHasEnded, setEngineDone]);
}
