import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * React.lazy + automatic recovery when a deploy invalidated a chunk URL.
 *
 * Production deploys rename every hashed chunk. A tab that loaded the app
 * BEFORE the deploy and lazy-mounts a chunk AFTER it (for example opening
 * /admin) can request a stale hash. The request may 404, return the SPA
 * fallback HTML, or fail at the network edge while the new deployment settles.
 *
 * Recovery is per chunk URL (not one global flag): each distinct stale chunk
 * gets one cache-busting reload. A second failure of the SAME URL rethrows to
 * the error boundary instead of reload-looping; a different chunk from a later
 * deploy can still recover in the same tab session.
 */
const RELOAD_KEY = 'chunk-reload-v2';
const LEGACY_RELOAD_KEY = 'chunk-reload-v1';
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;

interface ReloadAttempt {
  key: string;
  at: number;
}

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

/** Stable identity for the failed module: the URL when present. Pure. */
export function chunkReloadKey(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const match = msg.match(/https?:\/\/[^\s'"]+\.js[^\s'"]*|\/assets\/[^\s'"]+\.js/);
  return match ? match[0] : msg.slice(0, 200) || 'chunk';
}

function readAttempts(): ReloadAttempt[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.sessionStorage.getItem(RELOAD_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((item): item is ReloadAttempt => (
      !!item &&
      typeof item === 'object' &&
      typeof (item as ReloadAttempt).key === 'string' &&
      Number.isFinite((item as ReloadAttempt).at) &&
      now - (item as ReloadAttempt).at < ATTEMPT_TTL_MS
    ));
  } catch {
    return [];
  }
}

function rememberAttempt(key: string, at: number): void {
  try {
    if (typeof window === 'undefined') return;
    const next = [...readAttempts(), { key, at }].slice(-MAX_ATTEMPTS);
    window.sessionStorage.setItem(RELOAD_KEY, JSON.stringify(next));
  } catch {}
}

/**
 * Cache-busting navigation to the same page. A normal reload can still use a
 * stale entry HTML at the edge; the `_r` query forces a fresh document so the
 * new hashed chunk map is picked up. App strips `_r` after boot.
 */
export function reloadFresh(): void {
  try {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('_r', Date.now().toString(36));
    window.location.replace(url.toString());
  } catch {
    try {
      window.location.reload();
    } catch {}
  }
}

/**
 * Reload once for this exact failed chunk. Returns true when a reload was
 * started (the caller should keep the Suspense pending), false when this URL
 * already had its attempt or the error is unrelated.
 */
export function recoverFromChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err) || typeof window === 'undefined') return false;
  // The current page is already a cache-busted reload: do not navigate again
  // even if sessionStorage is unavailable (private-mode fallback).
  try {
    if (new URL(window.location.href).searchParams.has('_r')) return false;
  } catch {}
  const key = chunkReloadKey(err);
  const now = Date.now();
  if (readAttempts().some((item) => item.key === key)) return false;
  rememberAttempt(key, now);
  try {
    // Not needed anymore; remove the old global one-shot flag so a tab that
    // carried it from a previous deploy cannot block this recovery.
    window.sessionStorage.removeItem(LEGACY_RELOAD_KEY);
  } catch {}
  reloadFresh();
  return true;
}

export function lazyWithReload<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() =>
    importer().catch((err: unknown) => {
      if (recoverFromChunkError(err)) {
        // Never resolves: the navigation tears the page down. Keep React in
        // Suspense so the crash boundary does not flash during the reload.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    })
  );
}
