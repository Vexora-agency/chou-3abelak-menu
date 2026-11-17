/// <reference lib="webworker" />
/**
 * Header intro renderer — the original "keyed logo + gold steam/embers" look,
 * entirely off the main thread.
 *
 * The main thread transfers TWO OffscreenCanvases:
 *  - logo: the four pre-keyed alpha AVIF sheets, 4×9 cells, 24 fps.
 *  - smoke: the exact gold/gray particle system from the old canvas engine,
 *    drawn at 60 fps and screen-blended over the header.
 *
 * The old engine did the logo alpha-keying and particle gradients on the main
 * thread every frame; this worker does the same visuals on its own thread, so
 * React/LCP/decode cannot stutter the reveal.
 */
type StartMessage = {
  type: 'start';
  canvas: OffscreenCanvas;
  smokeCanvas: OffscreenCanvas;
  sheets: string[];
  brandPrimary: string;
};

type SmokeParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  decay: number;
  wobbleSpeed: number;
  wobbleAmount: number;
  seed: number;
};

type SparkParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  color: string;
};

const FPS = 24;
const SMOKE_FPS = 60;
const COLS = 4;
const CELL_W = 720;
const CELL_H = 266;
const FRAMES_PER_SHEET = 36;
const TOTAL_FRAMES = 144;
const END_AT_S = 5.75;
const DURATION_S = 6.0;

let timer: ReturnType<typeof setTimeout> | null = null;
let closed = false;

self.onmessage = (event: MessageEvent<StartMessage>) => {
  if (event.data?.type !== 'start') return;
  const { canvas, smokeCanvas, sheets, brandPrimary } = event.data;

  const ctx = canvas.getContext('2d', { alpha: true });
  const sCtx = smokeCanvas.getContext('2d', { alpha: true });
  if (!ctx || !sCtx) {
    self.postMessage({ type: 'error' });
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  sCtx.imageSmoothingEnabled = true;
  sCtx.imageSmoothingQuality = 'high';

  const bitmaps: (ImageBitmap | null)[] = new Array(sheets.length).fill(null);
  const smokeParticles: SmokeParticle[] = [];
  const sparkParticles: SparkParticle[] = [];
  let started = false;
  let startTime = 0;
  let lastFrame = -1;
  let tick = 0;
  let ended = false;
  let lastTickAt = 0;

  const drawLogo = (t: number): void => {
    const frame = Math.min(Math.floor(Math.max(0, t) * FPS), TOTAL_FRAMES - 1);
    if (frame === lastFrame) return;
    const si = Math.min(sheets.length - 1, Math.floor(frame / FRAMES_PER_SHEET));
    const bmp = bitmaps[si];
    if (!bmp) return; // hold the last frame while the next sheet decodes
    lastFrame = frame;
    const local = frame % FRAMES_PER_SHEET;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      bmp,
      (local % COLS) * CELL_W,
      Math.floor(local / COLS) * CELL_H,
      CELL_W,
      CELL_H,
      0,
      0,
      canvas.width,
      canvas.height
    );
    // Chapters behind us are never drawn again: release their decoded bitmap
    // (~27 MB each) instead of holding all four for the whole visit.
    for (let k = 0; k < si; k += 1) {
      const old = bitmaps[k];
      if (old) {
        old.close();
        bitmaps[k] = null;
      }
    }
  };

  const drawSmoke = (t: number, dt: number): void => {
    sCtx.clearRect(0, 0, smokeCanvas.width, smokeCanvas.height);

    if (t > 0.3 && t < 4.8) {
      const spawn =
        t < 1.6
          ? { xMin: 90, xMax: 230, y: 135 }
          : t < 3.4
            ? { xMin: 210, xMax: 480, y: 140 }
            : { xMin: 260, xMax: 620, y: 120 };

      if (tick % 3 === 0 && smokeParticles.length < 35) {
        smokeParticles.push({
          x: spawn.xMin + Math.random() * (spawn.xMax - spawn.xMin),
          y: spawn.y + (Math.random() * 20 - 10),
          vx: (Math.random() - 0.5) * 0.45,
          vy: -0.7 - Math.random() * 0.9,
          radius: 10 + Math.random() * 9,
          maxRadius: 37 + Math.random() * 20,
          alpha: 0.24 + Math.random() * 0.12,
          decay: 0.0035 + Math.random() * 0.003,
          wobbleSpeed: 0.03 + Math.random() * 0.03,
          wobbleAmount: 0.6 + Math.random() * 0.75,
          seed: Math.random() * 100,
        });
      }

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

    // Soft steam / smoke, exact old gradient colours.
    for (let i = smokeParticles.length - 1; i >= 0; i -= 1) {
      const p = smokeParticles[i];
      p.x += (p.vx + Math.sin(tick * p.wobbleSpeed + p.seed) * p.wobbleAmount * 0.5) * dt;
      p.y += p.vy * dt;
      p.radius += (p.maxRadius - p.radius) * 0.03 * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha <= 0.01 || p.y < -40) {
        smokeParticles.splice(i, 1);
        continue;
      }
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

    // Gold / white sizzle sparks, two-pass glow.
    for (let i = sparkParticles.length - 1; i >= 0; i -= 1) {
      const sp = sparkParticles[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.alpha -= sp.decay * dt;
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
  };

  const loop = (): void => {
    if (closed) return;
    const now = performance.now();
    const dt = lastTickAt === 0 ? 1 : Math.min(4, (now - lastTickAt) / (1000 / SMOKE_FPS));
    lastTickAt = now;
    tick += 1;
    const t = (now - startTime) / 1000;

    drawLogo(t);
    drawSmoke(t, dt);

    if (!ended && t >= END_AT_S) {
      ended = true;
      self.postMessage({ type: 'ended' });
    }
    if (t >= DURATION_S) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      self.setTimeout(() => {
        if (!closed) self.postMessage({ type: 'done' });
      }, 800);
      return;
    }
    // 60 fps for the particles; drift-corrected so a late tick does not
    // accumulate delay.
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(loop, Math.max(0, 1000 / SMOKE_FPS));
  };

  const start = (): void => {
    if (started || closed) return;
    started = true;
    startTime = performance.now();
    lastTickAt = 0;
    self.postMessage({ type: 'started' });
    timer = setTimeout(loop, 0);
  };

  const loadSheet = async (index: number): Promise<void> => {
    const url = sheets[index];
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`sheet ${index}: ${res.status}`);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      if (closed) {
        bitmap.close();
        return;
      }
      bitmaps[index] = bitmap;
      if (index === 0) start();
    } catch {
      if (index === 0) self.postMessage({ type: 'error' });
    }
  };

  sheets.forEach((_, index) => {
    void loadSheet(index);
  });

  self.addEventListener('message', (ev: MessageEvent<{ type?: string }>) => {
    if (ev.data?.type === 'stop') {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      bitmaps.forEach((bitmap, i) => {
        bitmap?.close();
        bitmaps[i] = null;
      });
    }
  });
};
