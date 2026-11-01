import { useEffect, useRef } from 'react';

/**
 * DOM tamper guard: if DevTools (or any external script) edits the watched
 * node's text, it snaps back to the React-computed value at once.
 *
 * This is a UX/cosmetic guard only — money is enforced server-side
 * (functions/api/orders.js re-derives every price from the live menu and
 * ignores client-sent totals), so a forged display can never become a
 * forged order. The observer just refuses to show the lie.
 *
 * No re-renders, no loops: React's own updates already equal `expected`,
 * so the observer no-ops on them; the flag covers our own restore write.
 */
export function useGuardedText<T extends HTMLElement = HTMLSpanElement>(expected: string) {
  const ref = useRef<T | null>(null);
  const expectedRef = useRef(expected);
  expectedRef.current = expected;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.textContent !== expectedRef.current) {
      try {
        el.textContent = expectedRef.current;
      } catch {}
    }
    let restoring = false;
    const obs = new MutationObserver(() => {
      if (restoring) return;
      const node = ref.current;
      if (!node || node.textContent === expectedRef.current) return;
      restoring = true;
      try {
        node.textContent = expectedRef.current;
      } catch {}
      restoring = false;
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  return ref;
}
