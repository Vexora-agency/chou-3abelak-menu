import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * React.lazy + one hard reload when a deploy invalidated the chunk URL.
 *
 * Why: production deploys rename every hashed chunk. A phone that loaded
 * the menu BEFORE the deploy and lazy-mounts a chunk AFTER it (exactly the
 * order -> OrdersBell sequence) requests a stale hash. Cloudflare Pages
 * answers the missing asset with the SPA fallback index.html (text/html),
 * and Safari throws `'<url>' is not a valid JavaScript MIME type`. Without
 * this wrapper the rejection reaches the root error boundary = white
 * screen right after a successful order (the order itself already saved).
 *
 * Exactly one reload per tab session (sessionStorage flag): the reload
 * fetches a fresh index.html with the new hashes, so the retry succeeds.
 * A second failure (real network outage, not a deploy) rethrows to the
 * boundary instead of reload-looping forever.
 */
const RELOAD_FLAG = 'chunk-reload-v1';

/** True for stale-chunk failures (deploy race), false for anything else. Pure. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('is not a valid JavaScript MIME type') ||
    msg.includes('Loading chunk')
  );
}

function alreadyReloaded(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(RELOAD_FLAG) === '1';
  } catch {
    return false;
  }
}

function markReloaded(): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(RELOAD_FLAG, '1');
  } catch {}
}

export function lazyWithReload<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() =>
    importer().catch((err: unknown) => {
      if (isChunkLoadError(err) && typeof window !== 'undefined' && !alreadyReloaded()) {
        markReloaded();
        window.location.reload();
        // Never resolves: the reload tears the page down. Return a pending
        // promise so React holds Suspense until unload (no boundary flash).
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    })
  );
}
