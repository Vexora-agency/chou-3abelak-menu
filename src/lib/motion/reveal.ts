/**
 * Site-wide scroll reveal engine (React Bits "AnimatedContent" behaviour).
 *
 * One IntersectionObserver serves every [data-motion-reveal] element on every
 * page. A MutationObserver picks up nodes mounted later (menu sections, cart
 * drawer, track/admin/invite chunks) so no page needs a bespoke wiring pass.
 *
 * Safety rules:
 * - Elements are visible by default. The runtime only adds [data-fx-init]
 *   once it is ready to observe them, so a JS failure can never blank content.
 * - data-attributes (not classes) carry the state: React re-renders that
 *   rewrite className cannot wipe an in-progress reveal.
 * - `will-change` is dropped after the entrance settles.
 */
const SELECTOR = '[data-motion-reveal]';
const INIT_ATTR = 'data-fx-init';
const IN_ATTR = 'data-fx-in';
const DONE_ATTR = 'data-fx-done';

let observer: IntersectionObserver | null = null;
let mutation: MutationObserver | null = null;
let started = false;
const prepared = new WeakSet<Element>();
const timers = new WeakMap<Element, number>();
let sweepQueued = false;

function finish(el: Element): void {
  el.setAttribute(DONE_ATTR, '');
}

function reveal(el: Element): void {
  if (!el.hasAttribute(IN_ATTR)) el.setAttribute(IN_ATTR, '');
  observer?.unobserve(el);
  const delay = Number((el as HTMLElement).dataset.motionDelay || 0);
  const duration = Number((el as HTMLElement).dataset.motionDuration || 850);
  const prev = timers.get(el);
  if (prev) window.clearTimeout(prev);
  // Slightly after the transition: keeps will-change for the active frames,
  // then releases the compositor layer.
  const to = window.setTimeout(() => finish(el), delay + duration + 120);
  timers.set(el, to);
}

function prepare(el: Element): void {
  if (prepared.has(el)) return;
  prepared.add(el);
  el.setAttribute(INIT_ATTR, '');
  if (!observer) {
    // No IO (very old browser): never hide anything.
    el.setAttribute(IN_ATTR, '');
    el.setAttribute(DONE_ATTR, '');
    return;
  }
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  // Above-the-fold elements enter immediately (double rAF lets the hidden
  // start state paint first, so the entrance is actually visible).
  if (rect.top < vh * 0.96 && rect.bottom > -40) {
    requestAnimationFrame(() => requestAnimationFrame(() => reveal(el)));
    return;
  }
  observer.observe(el);
}

function sweep(root: ParentNode = document): void {
  if (root instanceof Element && root.matches(SELECTOR)) prepare(root);
  root.querySelectorAll?.(SELECTOR).forEach(prepare);
}

function queueSweep(): void {
  if (sweepQueued) return;
  sweepQueued = true;
  requestAnimationFrame(() => {
    sweepQueued = false;
    sweep();
  });
}

function supportsObserver(): boolean {
  return typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function';
}

export function initRevealSystem(): void {
  if (started || typeof document === 'undefined') return;
  started = true;

  if (!supportsObserver()) {
    // Fail open: content is always readable.
    sweep(document);
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) reveal(entry.target);
      }
    },
    // Start a touch before the element is technically in view: the motion is
    // visible on entry instead of finishing by the time it reaches the fold.
    { root: null, rootMargin: '0px 0px -8% 0px', threshold: 0.01 }
  );

  sweep(document);

  if (typeof MutationObserver === 'function') {
    mutation = new MutationObserver((records) => {
      let needSweep = false;
      for (const record of records) {
        if (record.type === 'attributes') {
          const target = record.target;
          if (target instanceof Element) {
            // A re-render re-used a node that lost our state? Re-arm it.
            if (target.matches(SELECTOR) && !target.hasAttribute(INIT_ATTR)) prepare(target);
          }
          continue;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          needSweep = true;
          sweep(node as Element);
        }
      }
      if (needSweep) queueSweep();
    });
    mutation.observe(document.body, {
      childList: true,
      subtree: true,
      // className rewrites are exactly what React does on theme changes.
      attributes: true,
      attributeFilter: ['class', 'data-motion-reveal'],
    });
  }
}

/** Re-arm any element a client-side route replaced. Cheap no-op otherwise. */
export function refreshReveals(): void {
  if (!started) return;
  sweep(document);
}
