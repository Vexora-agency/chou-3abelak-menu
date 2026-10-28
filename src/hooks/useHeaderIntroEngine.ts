import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { SmokeParticle, SparkParticle } from '@/src/components/header/headerIntroParticles';

export function useHeaderIntroEngine(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  smokeCanvasRef: RefObject<HTMLCanvasElement | null>,
  headerRef: RefObject<HTMLElement | null>,
  setHasEnded: Dispatch<SetStateAction<boolean>>,
  setEngineDone: Dispatch<SetStateAction<boolean>>
): void {
  // Real-time High-Definition Canvas Alpha Extraction + Cinematic Steam & Ember Engine
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const smokeCanvas = smokeCanvasRef.current;
    if (!video || !canvas || !smokeCanvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sCtx = smokeCanvas.getContext('2d');
    if (!ctx || !sCtx) return;

    // The intro always plays for everyone (site owner decision): no reduced-motion
    // skip here. If playback is truly blocked, the catch/stall fallbacks below
    // still show the final logo so the header never stays blank.

    // Enable high-definition image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';

    let animId = 0;
    let isRunning = true;
    let finished = false;

    // Particle pools
    const smokeParticles: SmokeParticle[] = [];
    const sparkParticles: SparkParticle[] = [];

    // Brand ember color resolved once per intro run (canvas fillStyle cannot
    // use var()). Falls back to the theme default if the variable is missing.
    const brandPrimary =
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#FFC400';

    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;

    let tick = 0;

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

      // 1. Process Video Frame with Crisp Subpixel Alpha Keying & Edge Luminosity Restoration
      if (video.readyState >= 2 && !video.paused && !video.ended) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(video, 0, 0, w, h);

        try {
          const frame = ctx.getImageData(0, 0, w, h);
          const data = frame.data;
          const len = data.length;

          for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const max = r > g ? (r > b ? r : b) : (g > b ? g : b);

            if (max <= 12) {
              // Complete transparent zero floor (cleans video compression black artifacts)
              data[i + 3] = 0;
            } else if (max < 52) {
              // Smooth cubic Hermite anti-aliasing curve: eliminates jagged pixels
              const t = (max - 12) / 40;
              const smooth = t * t * (3 - 2 * t);
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
          ctx.putImageData(frame, 0, 0);
        } catch {
          // Fallback if cross-origin restricts
        }

        // 2. Spawn Dynamic Gourmet Smoke & Sizzle Sparks in 720x266 coordinate
        // space (buffers run at half resolution for performance; CSS upscales).
        const curTime = video.currentTime;
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
      if (video.ended && smokeParticles.length === 0 && sparkParticles.length === 0) {
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

    const startPlayback = () => {
      video.defaultMuted = true;
      video.muted = true;
      const promise = video.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            kick();
          })
          .catch(() => {
            // Autoplay blocked (e.g. iOS Low Power Mode): show the final logo right away
            isRunning = false;
            finished = true;
            setHasEnded(true);
            setEngineDone(true);
          });
      }
    };

    if (video.readyState >= 2) {
      startPlayback();
    } else {
      video.addEventListener('canplay', startPlayback, { once: true });
    }

    const handleTimeUpdate = () => {
      if (video.duration && video.currentTime >= video.duration - 0.25) {
        setHasEnded(true);
      }
    };
    video.addEventListener('timeupdate', handleTimeUpdate);

    // Safety net: if the video never starts moving, show the final logo
    const stallTimer = window.setTimeout(() => {
      if (video.currentTime === 0 && !finished) {
        isRunning = false;
        finished = true;
        setHasEnded(true);
        setEngineDone(true);
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
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [videoRef, canvasRef, smokeCanvasRef, headerRef, setHasEnded, setEngineDone]);
}
