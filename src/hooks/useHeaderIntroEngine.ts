import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

/**
 * Forced-playback logo reveal: 4 alpha-keyed sprite sheets, 36 frames each,
 * 24 fps → 6.0 s. The sheets are AVIF with a real alpha channel, so the logo
 * floats on the header with no black box and no blend mode.
 *
 * No per-frame JavaScript: a <canvas> (which is never an LCP candidate) carries
 * the sheet as a CSS background, and a step-held background-position animation
 * walks the 4×9 grid at 24 fps. JS only swaps the sheet four times and flips
 * the end state, so the intro costs zero rAF frames during the LCP window.
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

export function useHeaderIntroEngine(
  stageRef: RefObject<HTMLCanvasElement | null>,
  setHasEnded: Dispatch<SetStateAction<boolean>>,
  setEngineDone: Dispatch<SetStateAction<boolean>>
): void {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // The intro always plays (owner decision). If a sheet fails, the static
    // final logo is already underneath and the stage unmounts immediately.
    let disposed = false;
    let started = false;
    let chapter = 0;
    /** Wall-clock instant the current chapter is due to end. */
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

    /** (Re)start the CSS frame walk, optionally already `elapsed` seconds in. */
    const playAnimation = (url: string, elapsed: number): void => {
      stage.classList.remove('intro-sheet-playing');
      // Only four restarts per visit; the forced style flush is irrelevant.
      void stage.offsetWidth;
      stage.style.backgroundImage = `url("${url}")`;
      stage.style.animationDelay = `${-Math.min(CHAPTER_S, Math.max(0, elapsed))}s`;
      stage.classList.add('intro-sheet-playing');
    };

    const scheduleAdvance = (delayMs: number): void => {
      chapterDueAt = performance.now() + delayMs;
      later(advance, delayMs);
    };

    const advance = (): void => {
      if (disposed) return;
      const next = chapter + 1;
      if (next >= SHEETS.length) return;
      // If the sheet is late, start its animation already `late` seconds in
      // so the 6 s timeline (and the static-logo hand-off) stays anchored.
      const late = Math.max(0, performance.now() - chapterDueAt) / 1000;
      if (loaded[next]) switchChapter(next, late);
      else {
        // Hold the current chapter's last frame until the next sheet lands.
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
      // Never race the LCP photo / entry bundle: chapters 1-3 are needed at
      // 1.5 s, 3.0 s and 4.5 s, so low priority is still far ahead of use.
      img.fetchPriority = index === 0 ? 'auto' : 'low';
      img.onload = () => {
        if (disposed) return;
        if (!img.naturalWidth) {
          fail(index);
          return;
        }
        preloaders[index] = img;
        loaded[index] = true;
        if (index === 0) {
          startFirstChapter();
        } else if (pendingNext === index) {
          pendingNext = null;
          switchChapter(index, Math.max(0, performance.now() - chapterDueAt) / 1000);
        }
      };
      img.onerror = () => fail(index);
      img.src = SHEETS[index];
      preloaders[index] = img;
    };

    const fail = (_index: number): void => {
      // Fail safe: the final logo is already rendered underneath.
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
      // Stream the remaining chapters just ahead of their cue, not all at once.
      later(() => loadSheet(1), 350);
      later(() => loadSheet(2), 1900);
      later(() => loadSheet(3), 3400);
    };

    loadSheet(0);

    return () => {
      disposed = true;
      clearTimers();
      stage.classList.remove('intro-sheet-playing');
      stage.style.backgroundImage = '';
      preloaders.length = 0;
    };
  }, [stageRef, setHasEnded, setEngineDone]);
}
