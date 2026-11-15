import { getLenis } from './smoothScroll';

/**
 * GSAP + ScrollTrigger layer.
 *
 * Loaded lazily AFTER first paint (idle, 2.5 s ceiling) so the LCP path never
 * waits on GSAP. Everything it powers is decorative and additive:
 * - parallax depth on the header spotlight, footer grain, page auras;
 * - gentle floating accents on standalone pages;
 * - a single ScrollTrigger.update pump driven by Lenis.
 *
 * No element is hidden before GSAP arrives: content is always readable, and a
 * blocked/slow chunk only costs the depth effect, never the page.
 */
type Gsap = typeof import('gsap').gsap;
type ScrollTriggerApi = typeof import('gsap/ScrollTrigger').ScrollTrigger;

let boot: Promise<void> | null = null;
let gsapRef: Gsap | null = null;
let stRef: ScrollTriggerApi | null = null;
let observer: MutationObserver | null = null;
let refreshTimer = 0;
let sweepTimer = 0;
const bound = new WeakSet<Element>();

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function scheduleRefresh(): void {
  if (!stRef) return;
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    try {
      // Drop triggers whose element left the DOM (SPA route swaps: the
      // storefront header/footer unmount when /admin or /track opens).
      stRef?.getAll().forEach((trigger) => {
        const el = trigger.trigger;
        if (el instanceof Element && !document.contains(el)) trigger.kill();
      });
      stRef?.refresh();
    } catch {}
  }, 180);
}

function bindElement(el: HTMLElement): void {
  if (!gsapRef || !stRef || bound.has(el)) return;
  bound.add(el);
  const raw = el.getAttribute('data-gsap-parallax');
  if (raw !== null) {
    const speed = clamp(Number.parseFloat(raw) || 0.1, -0.4, 0.4);
    try {
      gsapRef.fromTo(
        el,
        { yPercent: -speed * 100 },
        {
          yPercent: speed * 100,
          ease: 'none',
          scrollTrigger: {
            trigger: el.parentElement || el,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.7,
            invalidateOnRefresh: true,
          },
        }
      );
    } catch {}
  }

  const floatRaw = el.getAttribute('data-gsap-float');
  if (floatRaw !== null) {
    const amount = clamp(Number.parseFloat(floatRaw) || 8, 2, 32);
    try {
      gsapRef.to(el, {
        y: -amount,
        duration: 3.8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: (el.getAttribute('data-gsap-float-delay') && Number(el.getAttribute('data-gsap-float-delay'))) || 0,
      });
    } catch {}
  }
}

function bindAll(): void {
  if (!gsapRef) return;
  document.querySelectorAll<HTMLElement>('[data-gsap-parallax], [data-gsap-float]').forEach(bindElement);
}

function queueSweep(): void {
  window.clearTimeout(sweepTimer);
  sweepTimer = window.setTimeout(() => {
    bindAll();
    scheduleRefresh();
  }, 140);
}

export function refreshGsapLayer(): void {
  if (!stRef) return;
  bindAll();
  scheduleRefresh();
}

export function initGsapLayer(): Promise<void> {
  if (boot) return boot;
  if (typeof window === 'undefined') return Promise.resolve();

  boot = (async () => {
    try {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      gsap.registerPlugin(ScrollTrigger);
      gsapRef = gsap;
      stRef = ScrollTrigger;
      // iOS URL-bar resizes must not re-trigger a full refresh mid-scroll.
      ScrollTrigger.config({ ignoreMobileResize: true });

      const lenis = getLenis();
      if (lenis) {
        const update = () => ScrollTrigger.update();
        lenis.on('scroll', update);
      }

      bindAll();
      ScrollTrigger.refresh();

      // Late chunks (track / admin / invite) and async menu sections mount
      // their own parallax accents after this point.
      if (typeof MutationObserver === 'function' && document.body) {
        observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node.nodeType !== 1) continue;
              const el = node as HTMLElement;
              if (el.matches?.('[data-gsap-parallax], [data-gsap-float]')) {
                bindElement(el);
              } else if (el.querySelector?.('[data-gsap-parallax], [data-gsap-float]')) {
                queueSweep();
              }
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }

      const onLoad = () => scheduleRefresh();
      window.addEventListener('load', onLoad, { once: true });
      document.fonts?.ready.then(scheduleRefresh).catch(() => {});
    } catch {
      // A blocked/slow GSAP chunk is a no-op: native scroll + CSS reveals
      // already carry the experience.
      gsapRef = null;
      stRef = null;
    }
  })();

  return boot;
}
