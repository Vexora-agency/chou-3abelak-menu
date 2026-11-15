import { useEffect } from 'react';
import { pauseSmoothScroll, resumeSmoothScroll } from '@/src/lib/motion/smoothScroll';

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
 *    lock stack keyed by sheet id, so closing the inner sheet never
 *    unlocks the body while the outer one is still open.
 *
 * Why a per-sheet STACK and not a counter + one savedY (the old design):
 * on iOS `scrollTo({behavior:'instant'})` is unsupported and throws, so
 * the old fallback ran an ANIMATED restore (html has
 * scroll-behavior:smooth). A same-commit close-one/open-another handoff
 * (item sheet -> cart) then re-captured scrollY mid-animation (~0) and
 * the next unlock jumped the page to the top. Desktop never noticed
 * because 'instant' works there synchronously. The stack fixes this three
 * ways: (a) nested locks inherit the pinned offset instead of reading a
 * meaningless window.scrollY of 0; (b) restore only fires when the stack
 * drains, so interleaved sheets can't clobber each other; (c) restore is
 * made truly instant by briefly overriding the stylesheet's smooth
 * behavior instead of relying on the unsupported 'instant' keyword.
 *
 * Every sheet/modal in the app must use this instead of setting
 * body.style.overflow directly. Pass a stable per-sheet id.
 */
interface LockEntry {
  id: string;
  y: number;
}

const stack: LockEntry[] = [];
let prevOverflow = '';
let prevOverscroll = '';
let prevPosition = '';
let prevTop = '';
let prevWidth = '';

function pinBody(y: number): void {
  const body = document.body;
  prevOverflow = body.style.overflow;
  prevOverscroll = body.style.overscrollBehavior ?? '';
  prevPosition = body.style.position;
  prevTop = body.style.top;
  prevWidth = body.style.width;
  body.style.overflow = 'hidden';
  body.style.overscrollBehavior = 'none';
  // iOS Safari ignores overflow:hidden on body — pin it instead.
  body.style.position = 'fixed';
  body.style.top = `${-y}px`;
  body.style.width = '100%';
}

function unpinBody(): { overflow: string; overscroll: string; position: string; top: string; width: string } {
  const body = document.body;
  const prev = {
    overflow: prevOverflow,
    overscroll: prevOverscroll,
    position: prevPosition,
    top: prevTop,
    width: prevWidth,
  };
  body.style.overflow = prev.overflow;
  body.style.overscrollBehavior = prev.overscroll;
  body.style.position = prev.position;
  body.style.top = prev.top;
  body.style.width = prev.width;
  return prev;
}

/** Truly instant restore on every engine: the smooth stylesheet rule is
 *  suspended for the duration of the synchronous scrollTo. */
function restoreScroll(y: number): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const doc = document.documentElement;
  const prevBehavior = doc.style.scrollBehavior;
  doc.style.scrollBehavior = 'auto';
  try {
    window.scrollTo(0, y);
  } finally {
    doc.style.scrollBehavior = prevBehavior;
  }
}

function lockBody(id: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (stack.some((e) => e.id === id)) return; // already holding — keep the original capture
  // A nested sheet opens while the body is pinned: window.scrollY reads 0
  // there, so inherit the offset the body is actually pinned at.
  const y = stack.length === 0 ? window.scrollY || 0 : stack[stack.length - 1].y;
  stack.push({ id, y });
  if (stack.length === 1) {
    // Pause Lenis before the body is pinned: a wheel tick must never fight
    // the fixed-position lock or leave a stale target behind the overlay.
    pauseSmoothScroll();
    pinBody(y);
  }
}

function unlockBody(id: string): void {
  const idx = stack.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const [entry] = stack.splice(idx, 1);
  if (stack.length > 0) return; // another sheet still open — stay pinned
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  // Dismiss a possibly-open keyboard FIRST: on phones it resizes the
  // viewport mid-unlock, which reads as "jump up then back down".
  try {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && typeof ae.blur === 'function') ae.blur();
  } catch {}
  unpinBody();
  restoreScroll(entry.y);
  // Re-seat Lenis on the restored offset before restarting, so its first
  // animation frame can never snap the page back to the top.
  resumeSmoothScroll(entry.y);
}

/** Lock body scroll while `active`; `id` must be stable per sheet. */
export function useBodyScrollLock(active: boolean, id: string): void {
  useEffect(() => {
    if (!active) return;
    lockBody(id);
    return () => {
      unlockBody(id);
    };
  }, [active, id]);
}
