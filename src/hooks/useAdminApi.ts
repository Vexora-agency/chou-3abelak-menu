import { useCallback, useRef } from 'react';

/** Shared admin transport: session-cookie fetch + autosave pause flag. */
export function useAdminApi() {
  // Admin authed-fetch (session cookie). Stable identity for effects below.
  const adminFetch = useCallback(async (url: string, init?: RequestInit) => {
    return fetch(url, {
      credentials: 'same-origin',
      ...(init || {}),
      headers: { 'X-Requested-With': 'menu-admin', ...((init && init.headers) || {}) },
    });
  }, []);

  // Auto-save stays paused during restore/import/trash refreshes so they never race.
  const savePaused = useRef(false);

  return { adminFetch, savePaused };
}
