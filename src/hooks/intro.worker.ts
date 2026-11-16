/// <reference lib="webworker" />
/**
 * Intro sprite renderer — runs entirely off the main thread.
 *
 * The main thread transfers an OffscreenCanvas and never touches a pixel
 * again. The worker fetches/decodes the four alpha AVIF sheets, steps the
 * 4×9 grid at 24 fps and draws the current cell. Main-thread long tasks
 * (React, LCP, image decode) can no longer stutter the logo reveal.
 */
type StartMessage = {
  type: 'start';
  canvas: OffscreenCanvas;
  sheets: string[];
};

const FPS = 24;
const COLS = 4;
const CELL_W = 720;
const CELL_H = 266;
const FRAMES_PER_SHEET = 36;
const TOTAL_FRAMES = 144;
const END_AT_S = 5.75;
const DURATION_S = 6.0;

let timer: ReturnType<typeof setInterval> | null = null;
let closed = false;

self.onmessage = (event: MessageEvent<StartMessage>) => {
  if (event.data?.type !== 'start') return;
  const { canvas, sheets } = event.data;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    self.postMessage({ type: 'error' });
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const bitmaps: (ImageBitmap | null)[] = new Array(sheets.length).fill(null);
  let started = false;
  let startTime = 0;
  let ended = false;

  const draw = (): void => {
    if (closed || !started) return;
    const t = (performance.now() - startTime) / 1000;
    const frame = Math.min(Math.floor(Math.max(0, t) * FPS), TOTAL_FRAMES - 1);
    const si = Math.min(sheets.length - 1, Math.floor(frame / FRAMES_PER_SHEET));
    const bmp = bitmaps[si];
    if (!bmp) return; // hold the previous frame while the next sheet decodes
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

    if (!ended && t >= END_AT_S) {
      ended = true;
      self.postMessage({ type: 'ended' });
    }
    if (t >= DURATION_S && timer !== null) {
      clearInterval(timer);
      timer = null;
      self.setTimeout(() => {
        if (!closed) self.postMessage({ type: 'done' });
      }, 800);
    }
  };

  const start = (): void => {
    if (started || closed) return;
    started = true;
    startTime = performance.now();
    self.postMessage({ type: 'started' });
    draw();
    // 24 fps: the sprite itself has no more information; 60 Hz polling would
    // only warm the worker for no visible gain.
    timer = setInterval(draw, 1000 / FPS);
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

  // The worker is terminated by the main thread; this handler is only a
  // courtesy for worker-side cleanup if a future caller posts 'stop'.
  self.addEventListener('message', (ev: MessageEvent<{ type?: string }>) => {
    if (ev.data?.type === 'stop') {
      closed = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      bitmaps.forEach((bitmap, i) => {
        bitmap?.close();
        bitmaps[i] = null;
      });
    }
  });
};
