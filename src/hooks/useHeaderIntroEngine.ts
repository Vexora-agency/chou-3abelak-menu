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

    const sCtx = smokeCanvas.getContext('2d');
    if (!sCtx) return;

    // The intro always plays for everyone (site owner decision): no reduced-motion
    // skip here. If the sheets fail to load, the fallbacks below still show
    // the final logo so the header never stays blank.

    // Enable high-definition image smoothing
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';

    let animId = 0;
    let isRunning = true;
    let finished = false;
    // Frame currently painted as the canvas CSS background. Style writes happen
    // only when the 24 fps frame changes, not on every 60 fps rAF tick.
    let lastDrawnFrame = -1;
    // Sheets fill in as each downloads (sheet 0 starts the clock; 1-3 stream
    // in during playback — each is needed 1.5 s after the previous, so even
    // slow networks stay ahead). A null slot = still downloading.
    let sheets: (HTMLImageElement | null)[] = [null, null, null, null];
    const sheetFailed: boolean[] = [false, false, false, false];
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

      // 1. Draw the raw sprite frame. The canvas uses CSS mix-blend-mode:
      // screen over the dark header, so the sheet's black background vanishes
      // and the logo/glow add light — visually equivalent to the old per-pixel
      // alpha keying WITHOUT a getImageData/putImageData readback every frame.
      // That readback loop was the single biggest main-thread blocker during
      // the 6 s intro (it delayed LCP to ~6.4 s on mobile). The smoke canvas
      // already uses the same screen blend.
      const t = introTime();
      const frame = Math.min(Math.floor(Math.max(0, t) * FPS), TOTAL_FRAMES - 1);
      const si = Math.floor(frame / FRAMES_PER_SHEET);
      // A later sheet still downloading: hold the last painted frame (the
      // clear/draw below is skipped) instead of flashing blank. A failed
      // sheet ends the intro on the final logo instead of hanging mid-air.
      if (!sheets[si] && sheetFailed[si]) finishNow();
      const sheet = sheets[si];
      if (sheet && t >= 0 && !finished) {
        const local = frame % FRAMES_PER_SHEET;
        // Paint the cell as a CSS background with screen blending, not into
        // the canvas bitmap. The sheet's black background disappears against
        // the dark header (same additive look as the old alpha keying) and the
        // main thread never runs a getImageData/putImageData readback.
        if (frame !== lastDrawnFrame) {
          lastDrawnFrame = frame;
          canvas.style.backgroundImage = `url("${SHEETS[si]}")`;
          canvas.style.backgroundSize = '400% 900%';
          canvas.style.backgroundPosition =
            `${(local % COLS) * (100 / (COLS - 1))}% ` +
            `${Math.floor(local / COLS) * (100 / (Math.ceil(FRAMES_PER_SHEET / COLS) - 1))}%`;
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

    // Sequential start: the clock begins the moment sheet 0 is ready (66 kB),
    // while sheets 1-3 stream in during playback — each chapter starts 1.5 s
    // after the previous, so the network stays ahead on any real connection.
    // Waiting for ALL sheets (Promise.all) held the whole 6 s intro hostage
    // to the slowest (331 kB) file: on slow lines the logo revealed seconds
    // late, which is exactly what LCP measures. Failure of sheet 0 still
    // falls back to the final logo like before.
    //
    // Slow-network staggering: sheet 0 (+ the preloaded copy) is all the
    // first paint needs. Sheets 1-3 are each due 1.5 s after the previous,
    // so on slow lines (2g / save-data) their downloads start ~1.2 s before
    // they are first drawn instead of all four racing the LCP image and the
    // app bundle from second zero. Fast networks keep the old fire-at-once
    // behavior — zero visual difference there.
    let settled = false;
    const staggerTimers: number[] = [];
    const slowLine = (() => {
      try {
        const conn = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
        return conn?.saveData === true || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g';
      } catch {
        return false;
      }
    })();
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(stallTimer);
      if (ok) {
        startStamp = performance.now();
        kick();
        if (slowLine) {
          // Chapter i starts at i*1.5 s; begin its download 1.2 s earlier.
          for (let i = 1; i < SHEETS.length; i += 1) {
            const delayMs = Math.max(0, i * 1500 - 1200);
            staggerTimers.push(window.setTimeout(() => loadSheet(i), delayMs));
          }
        }
      } else {
        finishNow();
      }
    };

    const loadSheet = (i: number) => {
      const src = SHEETS[i];
      if (!src) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (img.naturalWidth > 0) {
          sheets[i] = img;
          if (i === 0) settle(true);
        } else if (i === 0) {
          settle(false);
        } else {
          sheetFailed[i] = true;
        }
      };
      img.onerror = () => {
        if (i === 0) settle(false);
        else sheetFailed[i] = true;
      };
      img.src = src;
    };

    if (slowLine) {
      loadSheet(0);
    } else {
      SHEETS.forEach((_, i) => loadSheet(i));
    }

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
      for (const t of staggerTimers) window.clearTimeout(t);
      io.disconnect();
      cancelAnimationFrame(animId);
      animId = 0;
      sheets = [null, null, null, null];
    };
  }, [canvasRef, smokeCanvasRef, headerRef, setHasEnded, setEngineDone]);
}
