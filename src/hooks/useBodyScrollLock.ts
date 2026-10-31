import { useEffect } from 'react';

/**
 * Radical scroll fix for bottom sheets on phones.
 *
 * Two real-world problems this solves:
 * 1. iOS Safari ignores `overflow: hidden` on <body> — the page behind a
 *    sheet keeps scrolling (scroll chaining) and touch events get split
 *    between the sheet and the page, which feels like "can't scroll up,
 *    glitchy". Pinning the body with position:fixed is the only reliable
 *    iOS lock; the scroll position is saved and restored on unlock.
 * 2. Nested sheets (cart drawer + location picker inside it) share one
 *    module-level counter, so closing the inner sheet never unlocks the
 *    body while the outer one is still open.
 *
 * Every sheet/modal in the app must use this instead of setting
 * body.style.overflow directly.
 */
let locks = 0;
let savedY = 0;
let prevOverflow = '';
let prevOverscroll = '';
let prevPosition = '';
let prevTop = '';
let prevWidth = '';

function lockBody(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (locks === 0) {
    const body = document.body;
    savedY = window.scrollY || 0;
    prevOverflow = body.style.overflow;
    prevOverscroll = body.style.overscrollBehavior ?? '';
    prevPosition = body.style.position;
    prevTop = body.style.top;
    prevWidth = body.style.width;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    // iOS Safari ignores overflow:hidden on body — pin it instead.
    body.style.position = 'fixed';
    body.style.top = `${-savedY}px`;
    body.style.width = '100%';
  }
  locks += 1;
}

function unlockBody(): void {
  if (locks <= 0) return;
  locks -= 1;
  if (locks === 0 && typeof document !== 'undefined' && typeof window !== 'undefined') {
    // Dismiss a possibly-open keyboard FIRST: on phones it resizes the
    // viewport mid-unlock, which reads as "jump up then back down".
    try {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && typeof ae.blur === 'function') ae.blur();
    } catch {}
    const body = document.body;
    body.style.overflow = prevOverflow;
    body.style.overscrollBehavior = prevOverscroll;
    body.style.position = prevPosition;
    body.style.top = prevTop;
    body.style.width = prevWidth;
    // Instant, never smooth: the page has scroll-behavior:smooth, and an
    // animated restore travels visibly up-then-down on close.
    try {
      window.scrollTo({ top: savedY, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, savedY);
    }
  }
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockBody();
    return () => {
      unlockBody();
    };
  }, [active]);
}
