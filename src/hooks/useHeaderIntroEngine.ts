import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

/**
 * Logo intro.
 *
 * Primary: the original 1440×532 logo film, hardware-decoded by a visible
 * <video> and screen-blended over the dark header (the film has a pure-black
 * background, so screen removes it and keeps every spark/smoke pixel). 390 KB
 * VP9 + 135 KB H.264 fallback, no per-frame JavaScript.
 *
 * Fallback: 4 alpha-keyed AVIF sheets drawn by an OffscreenCanvas worker (or a
 * CSS background walk), used only when the video cannot autoplay (iOS Low Power
 * Mode, codec/network failure). The static final logo is the last resort.
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

/** Give the entry bundle + LCP image a head start before the film loads. */
const VIDEO_START_DELAY_MS = 250;
/** No `playing`/ready frame by then → use the sprite fallback. */
const VIDEO_STALL_MS = 3000;

type Setter = Dispatch<SetStateAction<boolean>>;

/**
 * Fallback renderer: the alpha sprite sheets, in a worker when possible.
 * Returns a cleanup function; the visible canvas is the caller's element.
 */
function startSpriteEngine(canvas: HTMLCanvasElement, setHasEnded: Setter, setEngineDone: Setter): () => void {
  // Preferred sprite path: draw the frames in a worker on an OffscreenCanvas.
  // The main thread never runs a frame loop, so React/LCP/image decode cannot
  // stutter the fallback reveal.
  if (typeof Worker !== 'undefined' && 'transferControlToOffscreen' in canvas) {
    let worker: Worker | null = null;
    let safety = 0;
    try {
      const offscreen = canvas.transferControlToOffscreen();
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
          canvas.style.backgroundImage = '';
        } else if (type === 'ended') {
          setHasEnded(true);
        } else if (type === 'done' || type === 'error') {
          window.clearTimeout(safety);
          setHasEnded(true);
          setEngineDone(true);
          worker?.terminate();
        }
      };
      worker.postMessage({ type: 'start', canvas: offscreen, sheets: SHEETS }, [offscreen]);
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
    canvas.classList.remove('intro-sheet-playing');
    // Only four restarts per visit; the forced style flush is irrelevant.
    void canvas.offsetWidth;
    canvas.style.backgroundImage = `url("${url}")`;
    canvas.style.animationDelay = `${-Math.min(CHAPTER_S, Math.max(0, elapsed))}s`;
    canvas.classList.add('intro-sheet-playing');
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
    canvas.classList.remove('intro-sheet-playing');
    canvas.style.backgroundImage = '';
    preloaders.length = 0;
  };
}

export function useHeaderIntroEngine(
  stageRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  setHasEnded: Setter,
  setEngineDone: Setter
): void {
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!stage || !canvas || !video) return;

    let disposed = false;
    let cleanupSprite: (() => void) | null = null;
    let endedSent = false;
    let doneTimer = 0;
    let startTimer = 0;
    let stallTimer = 0;
    let watchdog = 0;
    let lastTime = -1;
    let stuckTicks = 0;

    stage.dataset.mode = 'video';

    const markEnded = (): void => {
      if (endedSent || disposed) return;
      endedSent = true;
      setHasEnded(true);
      doneTimer = window.setTimeout(() => {
        if (!disposed) setEngineDone(true);
      }, UNMOUNT_AFTER_S * 1000);
    };

    const stopVideo = (): void => {
      window.clearTimeout(stallTimer);
      window.clearInterval(watchdog);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.removeEventListener('playing', onPlaying);
      try {
        video.pause();
      } catch {}
    };

    const startSprite = (): void => {
      if (disposed || cleanupSprite) return;
      stopVideo();
      video.preload = 'none';
      stage.dataset.mode = 'sprite';
      // The film already reached its end: the static logo is showing, never
      // restart a second intro behind the fade.
      if (endedSent) {
        setEngineDone(true);
        return;
      }
      cleanupSprite = startSpriteEngine(canvas, setHasEnded, setEngineDone);
    };

    const onTime = (): void => {
      if (disposed) return;
      if (video.currentTime >= END_AT_S) markEnded();
      // Watchdog: autoplay can silently stall on power-saving devices. If the
      // clock does not advance for two 1 s ticks, use the sprite fallback.
      if (!video.paused && video.currentTime > 0 && video.currentTime < DURATION_S) {
        if (video.currentTime === lastTime) stuckTicks += 1;
        else {
          stuckTicks = 0;
          lastTime = video.currentTime;
        }
        if (stuckTicks >= 2) startSprite();
      }
    };

    const onEnded = (): void => {
      markEnded();
    };
    const onError = (): void => {
      startSprite();
    };
    const onPlaying = (): void => {
      window.clearTimeout(stallTimer);
      window.clearInterval(watchdog);
      lastTime = video.currentTime;
      stuckTicks = 0;
      watchdog = window.setInterval(onTime, 1000);
    };

    const begin = (): void => {
      if (disposed || endedSent) return;
      stage.dataset.mode = 'video';
      video.preload = 'auto';
      try {
        video.load();
      } catch {}
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => startSprite());
      }
      stallTimer = window.setTimeout(() => {
        if (disposed || endedSent || cleanupSprite) return;
        if (video.paused || video.readyState < 2) startSprite();
      }, VIDEO_STALL_MS);
    };

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('playing', onPlaying);
    // Let the entry bundle + LCP image start first; the poster covers the gap.
    startTimer = window.setTimeout(begin, VIDEO_START_DELAY_MS);

    return () => {
      disposed = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(stallTimer);
      window.clearTimeout(doneTimer);
      window.clearInterval(watchdog);
      stopVideo();
      cleanupSprite?.();
      try {
        video.pause();
      } catch {}
    };
  }, [stageRef, canvasRef, videoRef, setHasEnded, setEngineDone]);
}
