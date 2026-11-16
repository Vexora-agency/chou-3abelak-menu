import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

/**
 * Header intro — the original deployment's effect, rebuilt off the main thread.
 *
 * The visible logo is the four alpha-keyed AVIF sheets (the same keying the old
 * canvas engine applied per pixel), and the overlay is the old gold/gray steam
 * and ember particle system. A worker owns BOTH OffscreenCanvases: logo at
 * 24 fps, particles at 60 fps. React/LCP/decode cannot stutter it, and the
 * screen-blended smoke canvas keeps the gold sparks the old version had.
 *
 * If OffscreenCanvas is unavailable, a CSS background-position walk plays the
 * logo frames (no particles) as a final fallback; the static logo is last.
 */
const SHEETS = [
  '/assets/intro-alpha-0.avif',
  '/assets/intro-alpha-1.avif',
  '/assets/intro-alpha-2.avif',
  '/assets/intro-alpha-3.avif',
];
const FPS = 24;
const FRAMES_PER_SHEET = 36;
const CHAPTER_S = FRAMES_PER_SHEET / FPS; // 1.5 s per sheet
const DURATION_S = SHEETS.length * CHAPTER_S; // 6.0 s
const END_AT_S = DURATION_S - 0.25; // start the fade just before the last frame
const UNMOUNT_AFTER_S = 0.8; // let the 700 ms CSS fade finish

type Setter = Dispatch<SetStateAction<boolean>>;

function startSpriteEngine(
  sprite: HTMLCanvasElement,
  smoke: HTMLCanvasElement,
  setHasEnded: Setter,
  setEngineDone: Setter
): () => void {
  // Preferred path: logo + particles in one worker on two OffscreenCanvases.
  // The main thread receives only started/ended/done.
  if (
    typeof Worker !== 'undefined' &&
    'transferControlToOffscreen' in sprite &&
    'transferControlToOffscreen' in smoke
  ) {
    let worker: Worker | null = null;
    let safety = 0;
    try {
      const logoOffscreen = sprite.transferControlToOffscreen();
      const smokeOffscreen = smoke.transferControlToOffscreen();
      const brandPrimary =
        getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#FFC400';
      worker = new Worker(new URL('./intro.worker.ts', import.meta.url), { type: 'module' });
      safety = window.setTimeout(() => {
        setHasEnded(true);
        setEngineDone(true);
        worker?.terminate();
      }, 8000);
      worker.onmessage = (event: MessageEvent<{ type?: string }>) => {
        const type = event.data?.type;
        if (type === 'started') {
          // The worker has painted frame 0; the CSS poster is no longer needed.
          sprite.style.backgroundImage = '';
        } else if (type === 'ended') {
          setHasEnded(true);
        } else if (type === 'done' || type === 'error') {
          window.clearTimeout(safety);
          setHasEnded(true);
          setEngineDone(true);
          worker?.terminate();
        }
      };
      worker.postMessage(
        {
          type: 'start',
          canvas: logoOffscreen,
          smokeCanvas: smokeOffscreen,
          sheets: SHEETS,
          brandPrimary,
        },
        [logoOffscreen, smokeOffscreen]
      );
      return () => {
        window.clearTimeout(safety);
        try {
          worker?.postMessage({ type: 'stop' });
        } catch {}
        worker?.terminate();
      };
    } catch {
      window.clearTimeout(safety);
      worker?.terminate();
      // Fall through to the CSS background walk below.
    }
  }

  // CSS fallback: a step-held background-position walk. If a sheet fails, the
  // static final logo is already underneath and the stage unmounts immediately.
  let disposed = false;
  let started = false;
  let chapter = 0;
  let chapterDueAt = 0;
  let pendingNext: number | null = null;
  const loaded = [false, false, false, false];
  const failed = [false, false, false, false];
  const preloaders: (HTMLImageElement | null)[] = [null, null, null, null];
  const timers: number[] = [];

  const later = (fn: () => void, ms: number): void => {
    timers.push(window.setTimeout(fn, ms));
  };

  const clearTimers = (): void => {
    for (const id of timers) window.clearTimeout(id);
    timers.length = 0;
  };

  const finishNow = (): void => {
    if (disposed) return;
    clearTimers();
    setHasEnded(true);
    setEngineDone(true);
  };

  const playAnimation = (url: string, elapsed: number): void => {
    sprite.classList.remove('intro-sheet-playing');
    void sprite.offsetWidth;
    sprite.style.backgroundImage = `url("${url}")`;
    sprite.style.animationDelay = `${-Math.min(CHAPTER_S, Math.max(0, elapsed))}s`;
    sprite.classList.add('intro-sheet-playing');
  };

  const scheduleAdvance = (delayMs: number): void => {
    chapterDueAt = performance.now() + delayMs;
    later(advance, delayMs);
  };

  const advance = (): void => {
    if (disposed) return;
    const next = chapter + 1;
    if (next >= SHEETS.length) return;
    const late = Math.max(0, performance.now() - chapterDueAt) / 1000;
    if (loaded[next]) switchChapter(next, late);
    else {
      pendingNext = next;
      loadSheet(next);
    }
  };

  const switchChapter = (next: number, late: number): void => {
    chapter = next;
    const elapsed = Math.min(CHAPTER_S, Math.max(0, late));
    playAnimation(SHEETS[next], elapsed);
    scheduleAdvance(Math.max(0, (CHAPTER_S - elapsed) * 1000));
  };

  const loadSheet = (index: number): void => {
    if (preloaders[index] || loaded[index] || failed[index]) return;
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = index === 0 ? 'auto' : 'low';
    img.onload = () => {
      if (disposed) return;
      if (!img.naturalWidth) {
        fail(index);
        return;
      }
      preloaders[index] = img;
      loaded[index] = true;
      if (index === 0) startFirstChapter();
      else if (pendingNext === index) {
        pendingNext = null;
        switchChapter(index, Math.max(0, performance.now() - chapterDueAt) / 1000);
      }
    };
    img.onerror = () => fail(index);
    img.src = SHEETS[index];
    preloaders[index] = img;
  };

  const fail = (_index: number): void => {
    finishNow();
  };

  const startFirstChapter = (): void => {
    if (disposed || started) return;
    started = true;
    chapter = 0;
    playAnimation(SHEETS[0], 0);
    scheduleAdvance(CHAPTER_S * 1000);
    later(() => {
      if (!disposed) setHasEnded(true);
    }, END_AT_S * 1000);
    later(() => {
      if (!disposed) setEngineDone(true);
    }, (DURATION_S + UNMOUNT_AFTER_S) * 1000);
    later(() => loadSheet(1), 350);
    later(() => loadSheet(2), 1900);
    later(() => loadSheet(3), 3400);
  };

  loadSheet(0);

  return () => {
    disposed = true;
    clearTimers();
    sprite.classList.remove('intro-sheet-playing');
    sprite.style.backgroundImage = '';
    preloaders.length = 0;
  };
}

export function useHeaderIntroEngine(
  stageRef: RefObject<HTMLDivElement | null>,
  spriteCanvasRef: RefObject<HTMLCanvasElement | null>,
  smokeCanvasRef: RefObject<HTMLCanvasElement | null>,
  setHasEnded: Setter,
  setEngineDone: Setter
): void {
  useEffect(() => {
    const stage = stageRef.current;
    const sprite = spriteCanvasRef.current;
    const smoke = smokeCanvasRef.current;
    if (!stage || !sprite || !smoke) return;
    return startSpriteEngine(sprite, smoke, setHasEnded, setEngineDone);
  }, [stageRef, spriteCanvasRef, smokeCanvasRef, setHasEnded, setEngineDone]);
}
